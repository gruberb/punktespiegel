import assert from "node:assert/strict";
import test from "node:test";
import { buildPlayerNews, buildSquadNews, canonicalNewsUrl, clubFeedStatus, newsAttribution, newsHealthStatus } from "./news.ts";
import type { NewsArtifact, NewsFeedHealth } from "./news.ts";
import type { ManagerPickPlayer, NewsArticle } from "./types.ts";

function article(url: string, publishedAt: string, title = url): NewsArticle {
  return { source: "kicker", domain: "kicker.de", title, url, publishedAt };
}

function artifact(overrides: Partial<NewsArtifact> = {}): NewsArtifact {
  return {
    schemaVersion: 1,
    generatedAt: "2026-08-14T12:00:00Z",
    provider: "Direkte RSS-Feeds",
    players: {},
    ...overrides,
  };
}

function feed(status: NewsFeedHealth["status"], teamId: string | null = null): NewsFeedHealth {
  return {
    id: `feed-${status}-${teamId ?? "none"}`, kind: "team", source: "kicker", domain: "kicker.de",
    url: "https://www.kicker.de/news/fussball/rssfeed", teamId, status, httpStatus: status === "ok" ? 200 : null,
    fetchedAt: "2026-08-14T12:00:00Z", itemCount: 1, acceptedItemCount: status === "ok" ? 1 : 0,
    error: status === "error" ? "request failed" : null,
  };
}

function pick(id: string, name: string, teamId: string, team: string): ManagerPickPlayer {
  return {
    id, name, teamId, team, teamCode: "TST", logoUrl: null, photoUrl: null, position: "MID",
    priceM: 1, projectedPoints: 1, currentPoints: 0, confidence: "medium", seasonsUsed: 1,
    appearancesUsed: 1, promotionAdjusted: false, role: "start",
  };
}

test("keeps schema-v1 player news working, sorted, deduplicated and capped", () => {
  const items = Array.from({ length: 17 }, (_, index) => article(
    `https://www.kicker.de/item-${index}/artikel${index === 0 ? "#omrss" : ""}`,
    `2026-08-${String(index + 1).padStart(2, "0")}T10:00:00Z`,
  ));
  items.push(article("https://www.kicker.de/item-0/artikel", "2026-08-01T09:00:00Z"));
  const news = buildPlayerNews(artifact({ players: { player: items } }), "player", "team", new Date("2026-08-14T13:00:00Z"));

  assert.equal(news.status, "healthy");
  assert.equal(news.clubFeedStatus, "unknown");
  assert.equal(news.articles.length, 15);
  assert.ok(news.articles.every((item) => item.relation === "automatic"));
  assert.equal(news.articles[0].publishedAt, "2026-08-17T10:00:00Z");
  assert.equal(new Set(news.articles.map((item) => canonicalNewsUrl(item.url))).size, 15);
  assert.deepEqual(news.clubArticles, []);
});

test("distinguishes a healthy zero result from stale and failed ingestion", () => {
  const current = artifact({ teams: { team: [] } });
  assert.equal(newsHealthStatus(current, new Date("2026-08-14T13:00:00Z")), "healthy");
  assert.equal(buildPlayerNews(current, "missing", "team", new Date("2026-08-14T13:00:00Z")).articles.length, 0);
  assert.equal(newsHealthStatus(current, new Date("2026-08-16T13:00:00Z")), "stale");
  assert.equal(newsHealthStatus(artifact({ generatedAt: "", loadFailed: true })), "failed");
  assert.equal(newsHealthStatus(artifact({ schemaVersion: 2, feeds: [feed("unmapped")] }), new Date("2026-08-14T13:00:00Z")), "failed");
});

test("does not treat catalog discovery as a successful content feed", () => {
  const catalog = { ...feed("ok"), id: "catalog", kind: "catalog" as const };
  assert.equal(newsHealthStatus(artifact({ schemaVersion: 2, feeds: [catalog] }), new Date("2026-08-14T13:00:00Z")), "failed");
  assert.equal(newsHealthStatus(artifact({ schemaVersion: 2, feeds: [catalog, feed("error", "club")] }), new Date("2026-08-14T13:00:00Z")), "failed");
  assert.equal(newsHealthStatus(artifact({ schemaVersion: 2, feeds: [catalog, feed("ok", "club")] }), new Date("2026-08-14T13:00:00Z")), "healthy");
});

test("derives per-club feed availability only from schema-v2 feed health", () => {
  assert.equal(clubFeedStatus(artifact(), "club"), "unknown");
  assert.equal(clubFeedStatus(artifact({ schemaVersion: 2, feeds: [feed("ok", "club")] }), "club"), "ok");
  assert.equal(clubFeedStatus(artifact({ schemaVersion: 2, feeds: [feed("error", "club")] }), "club"), "error");
  assert.equal(clubFeedStatus(artifact({ schemaVersion: 2, feeds: [feed("ok", "other")] }), "club"), "unavailable");
});

test("uses club news as player fallback and deduplicates the squad feed by URL", () => {
  const sharedPlayerArticle = article("https://www.kicker.de/shared/artikel#omrss", "2026-08-14T11:00:00Z", "Shared");
  const sharedTeamArticle = { ...article("https://www.kicker.de/shared/artikel", "2026-08-14T11:00:00Z", "Shared"), relation: "team" as const };
  const clubOnlyArticle = { ...article("https://www.kicker.de/club/artikel", "2026-08-14T10:00:00Z", "Club"), relation: "team" as const };
  const source = artifact({
    schemaVersion: 2,
    feeds: [feed("ok", "club")],
    players: { one: [sharedPlayerArticle], two: [] },
    teams: { club: [sharedTeamArticle, clubOnlyArticle] },
  });

  const fallback = buildPlayerNews(source, "two", "club", new Date("2026-08-14T13:00:00Z"));
  assert.deepEqual(fallback.articles, []);
  assert.equal(fallback.clubArticles.length, 2);
  assert.equal(fallback.clubFeedStatus, "ok");

  const squad = buildSquadNews(source, [pick("one", "Ada Eins", "club", "Testverein"), pick("two", "Berta Zwei", "club", "Testverein")], new Date("2026-08-14T13:00:00Z"));
  assert.equal(squad.articles.length, 2);
  assert.equal(squad.articles[0].relation, "player");
  assert.deepEqual(squad.articles[0].relatedPlayers, ["Ada Eins"]);
  assert.deepEqual(squad.articles[0].relatedTeams, ["Testverein"]);
});

test("fills remaining player-news slots with labelled club context", () => {
  const direct = Array.from({ length: 14 }, (_, index) => article(`https://example.test/player-${index}`, `2026-08-14T${String(index).padStart(2, "0")}:00:00Z`));
  const duplicates = direct.map((item, index) => ({ ...item, publishedAt: `2026-08-15T${String(index).padStart(2, "0")}:00:00Z` }));
  const club = [...duplicates, ...Array.from({ length: 3 }, (_, index) => article(`https://example.test/club-${index}`, `2026-08-14T${String(index + 14).padStart(2, "0")}:00:00Z`))];
  const news = buildPlayerNews(artifact({ players: { player: direct }, teams: { team: club } }), "player", "team", new Date("2026-08-14T13:00:00Z"));

  assert.equal(news.articles.length, 14);
  assert.equal(news.clubArticles.length, 1);
  assert.equal(news.clubArticles[0].relation, "team");
  assert.match(news.clubArticles[0].url, /club-/);
});

test("reserves squad slots for direct mentions despite newer team-feed volume", () => {
  const direct = article("https://example.test/direct", "2026-08-01T10:00:00Z", "Direct mention");
  const teamArticles = Array.from({ length: 30 }, (_, index) => article(`https://example.test/team-${index}`, `2026-08-14T${String(index % 24).padStart(2, "0")}:00:00Z`));
  const source = artifact({ schemaVersion: 2, players: { one: [direct] }, teams: { club: teamArticles } });
  const squad = buildSquadNews(source, [pick("one", "Ada Eins", "club", "Testverein")], new Date("2026-08-14T13:00:00Z"));

  assert.equal(squad.articles.length, 15);
  assert.ok(squad.articles.some((item) => item.url === direct.url && item.relation === "player"));
  assert.equal(squad.articles.filter((item) => item.relation === "team").length, 14);
});

test("uses the exact visible kicker attribution", () => {
  assert.equal(newsAttribution(article("https://www.kicker.de/example/artikel", "2026-08-14T10:00:00Z")), "Quelle: www.kicker.de");
  assert.equal(newsAttribution({ ...article("https://example.test", "2026-08-14T10:00:00Z"), source: "Sportschau", domain: "sportschau.de" }), "Quelle: sportschau.de");
});
