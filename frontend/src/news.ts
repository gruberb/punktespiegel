import type {
  ClubFeedStatus,
  ManagerPickPlayer,
  NewsArticle,
  NewsFeedSummary,
  NewsHealthStatus,
  NewsRelation,
  PlayerNews,
  SquadNews,
  SquadNewsArticle,
} from "./types";

export type NewsFeedHealth = {
  id: string;
  kind: "catalog" | "league" | "general" | "team" | "api";
  source: string;
  domain: string;
  url: string;
  teamId: string | null;
  status: "ok" | "error" | "unmapped";
  httpStatus: number | null;
  fetchedAt: string;
  itemCount: number;
  acceptedItemCount: number;
  error: string | null;
};

export type NewsArtifact = {
  schemaVersion: number;
  generatedAt: string;
  provider: string;
  sources?: string[];
  feeds?: NewsFeedHealth[];
  players: Record<string, NewsArticle[]>;
  teams?: Record<string, NewsArticle[]>;
  loadFailed?: boolean;
};

const staleAfterMilliseconds = 36 * 60 * 60 * 1000;
const trackingParameters = new Set(["at_campaign", "at_medium", "cmpid", "fbclid", "gclid"]);

function articleTimestamp(article: NewsArticle) {
  const timestamp = Date.parse(article.publishedAt);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export function canonicalNewsUrl(value: string) {
  try {
    const url = new URL(value);
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (key.toLocaleLowerCase("en").startsWith("utm_") || trackingParameters.has(key.toLocaleLowerCase("en"))) {
        url.searchParams.delete(key);
      }
    }
    url.searchParams.sort();
    return url.toString();
  } catch {
    return value.split("#", 1)[0];
  }
}

export function newestUniqueArticles(articles: NewsArticle[], limit = 15) {
  const seen = new Set<string>();
  return [...articles]
    .sort((left, right) => articleTimestamp(right) - articleTimestamp(left))
    .filter((article) => {
      const key = canonicalNewsUrl(article.url);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit);
}

export function summarizeNewsFeeds(feeds: NewsFeedHealth[] | undefined): NewsFeedSummary {
  const summary: NewsFeedSummary = { total: 0, ok: 0, error: 0, unmapped: 0 };
  for (const feed of feeds ?? []) {
    summary.total += 1;
    summary[feed.status] += 1;
  }
  return summary;
}

export function newsHealthStatus(artifact: NewsArtifact, now = new Date()): NewsHealthStatus {
  if (artifact.loadFailed) return "failed";
  if (artifact.feeds && !artifact.feeds.some((feed) => feed.kind !== "catalog" && feed.status === "ok")) return "failed";
  const generatedAt = Date.parse(artifact.generatedAt);
  if (!Number.isFinite(generatedAt)) return artifact.feeds?.some((feed) => feed.kind !== "catalog" && feed.status === "ok") ? "healthy" : "failed";
  return now.getTime() - generatedAt > staleAfterMilliseconds ? "stale" : "healthy";
}

export function clubFeedStatus(artifact: NewsArtifact, teamId: string): ClubFeedStatus {
  if (artifact.schemaVersion < 2 || !artifact.feeds) return "unknown";
  const feeds = artifact.feeds.filter((feed) => feed.kind === "team" && feed.teamId === teamId);
  if (feeds.some((feed) => feed.status === "ok")) return "ok";
  if (feeds.some((feed) => feed.status === "error")) return "error";
  return "unavailable";
}

export function buildPlayerNews(artifact: NewsArtifact, playerId: string, teamId: string, now = new Date()): PlayerNews {
  const playerRelation: NewsRelation = artifact.schemaVersion >= 2 ? "player" : "automatic";
  const articles = newestUniqueArticles(artifact.players[playerId] ?? [], 15)
    .map((article) => ({ ...article, relation: playerRelation }));
  const articleUrls = new Set(articles.map((article) => canonicalNewsUrl(article.url)));
  const clubCandidates = (artifact.teams?.[teamId] ?? [])
    .filter((article) => !articleUrls.has(canonicalNewsUrl(article.url)));
  const clubArticles = newestUniqueArticles(clubCandidates, Math.max(0, 15 - articles.length))
    .map((article) => ({ ...article, relation: "team" as const }));
  return {
    generatedAt: artifact.generatedAt || null,
    provider: artifact.provider || null,
    status: newsHealthStatus(artifact, now),
    feedSummary: summarizeNewsFeeds(artifact.feeds),
    clubFeedStatus: clubFeedStatus(artifact, teamId),
    articles,
    clubArticles,
  };
}

type MutableSquadNewsArticle = SquadNewsArticle & {
  relatedPlayers: string[];
  relatedTeams: string[];
};

export function buildSquadNews(artifact: NewsArtifact, players: ManagerPickPlayer[], now = new Date(), limit = 15): SquadNews {
  const byUrl = new Map<string, MutableSquadNewsArticle>();
  const teams = new Map(players.map((player) => [player.teamId, player.team]));
  const playerRelation: NewsRelation = artifact.schemaVersion >= 2 ? "player" : "automatic";

  const addArticle = (article: NewsArticle, relation: NewsRelation, playerName?: string, teamName?: string) => {
    const key = canonicalNewsUrl(article.url);
    const current = byUrl.get(key);
    if (current) {
      if (relationPriority(relation) > relationPriority(current.relation)) current.relation = relation;
      if (playerName && !current.relatedPlayers.includes(playerName)) current.relatedPlayers.push(playerName);
      if (teamName && !current.relatedTeams.includes(teamName)) current.relatedTeams.push(teamName);
      return;
    }
    byUrl.set(key, {
      ...article,
      relation,
      relatedPlayers: playerName ? [playerName] : [],
      relatedTeams: teamName ? [teamName] : [],
    });
  };

  for (const player of players) {
    for (const article of artifact.players[player.id] ?? []) addArticle(article, playerRelation, player.name, player.team);
  }
  for (const [teamId, teamName] of teams) {
    for (const article of artifact.teams?.[teamId] ?? []) addArticle(article, "team", undefined, teamName);
  }

  const newestFirst = (left: SquadNewsArticle, right: SquadNewsArticle) => articleTimestamp(right) - articleTimestamp(left)
    || relationPriority(right.relation) - relationPriority(left.relation);
  const articlesByRelation = [...byUrl.values()].sort(newestFirst);
  const directArticles = articlesByRelation.filter((article) => article.relation !== "team").slice(0, limit);
  const teamArticles = articlesByRelation.filter((article) => article.relation === "team").slice(0, Math.max(0, limit - directArticles.length));
  const articles = [...directArticles, ...teamArticles].sort(newestFirst);
  return {
    generatedAt: artifact.generatedAt || null,
    provider: artifact.provider || null,
    status: newsHealthStatus(artifact, now),
    feedSummary: summarizeNewsFeeds(artifact.feeds),
    articles,
  };
}

function relationPriority(relation: NewsRelation) {
  return relation === "player" ? 2 : relation === "automatic" ? 1 : 0;
}

function isKickerArticle(article: NewsArticle) {
  const domain = article.domain.replace(/^www\./i, "");
  return domain === "kicker.de" || domain.endsWith(".kicker.de") || article.source.toLocaleLowerCase("de") === "kicker";
}

export function newsAttribution(article: NewsArticle) {
  return `Quelle: ${isKickerArticle(article) ? "www.kicker.de" : article.domain || article.source}`;
}

export function newsSourceLabel(article: NewsArticle) {
  return isKickerArticle(article) ? null : article.source;
}
