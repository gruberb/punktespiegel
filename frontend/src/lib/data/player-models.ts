import type { PlayerDetail, PlayerGame, PlayerSeasonSummary } from "../../types/models";
import type { SeasonIndex, StaticAvailabilitySignals, StaticCatalog, StaticClubProfiles, StaticPlayerCareers, StaticRoleSignals, StaticSeason } from "./contracts";
import { kickerPlayerNewsLink } from "./kicker-links";
import type { NewsArtifact } from "./news";
import { buildPlayerNews } from "./news";
import { scoreCountsAsAppearance } from "./scoring";
import { loadSeason } from "./snapshots";

export async function playerDetail(
  index: SeasonIndex,
  playerId: string,
  catalog: StaticCatalog,
  news: NewsArtifact,
  roleSignals: StaticRoleSignals | null,
  availabilitySignals: StaticAvailabilitySignals | null,
  clubProfiles: StaticClubProfiles | null,
  playerCareers: StaticPlayerCareers | null,
): Promise<PlayerDetail> {
  const player = index.players.get(playerId);
  if (!player) throw new Error("Spieler wurde in dieser Saison nicht gefunden.");
  const team = index.teams.get(player.teamId);
  if (!team) throw new Error("Verein des Spielers wurde nicht gefunden.");
  const kickerNews = kickerPlayerNewsLink(player.id, player.name);
  const games = index.season.scores.filter((score) => score.playerId === playerId).flatMap((score): PlayerGame[] => {
    const match = index.matches.get(score.matchId);
    if (!match) return [];
    const home = match.homeTeamId === score.teamId;
    const opponent = index.teams.get(home ? match.awayTeamId : match.homeTeamId);
    if (!opponent) return [];
    return [{
      matchday: match.round,
      scheduledAt: match.scheduledAt,
      opponentId: opponent.id,
      opponent: opponent.name,
      opponentCode: opponent.code,
      opponentLogoUrl: opponent.logoUrl,
      venue: home ? "Home" : "Away",
      homeScore: match.homeScore,
      awayScore: match.awayScore,
      points: score.totalPoints,
      grade: score.grade == null ? null : score.grade / 100,
      goals: score.goals,
      assists: score.assists,
      pointsCleanSheet: score.pointsCleanSheet,
      pointsGrade: score.pointsGrade,
      pointsGoals: score.pointsGoals,
      pointsCards: score.pointsCards,
      pointsAssists: score.pointsAssists,
      pointsStarter: score.pointsStarter,
      pointsMvp: score.pointsMvp,
      pointsJoker: score.pointsJoker,
    }];
  }).sort((left, right) => left.matchday - right.matchday);
  const seasonPoints = games.reduce((sum, game) => sum + game.points, 0);
  const seasons = await playerSeasonHistory(catalog, playerId);
  const availability = availabilitySignals?.season === index.season.startYear
    ? availabilitySignals.leagues[index.season.leagueCode]?.players[playerId]
    : null;
  const currentSnapshot = clubProfiles?.leagueCode === index.season.leagueCode && clubProfiles.season === index.season.startYear ? clubProfiles : null;
  const bio = currentSnapshot?.teams[player.teamId]?.squad[playerId] ?? null;
  const careerEntry = playerCareers?.leagueCode === index.season.leagueCode && playerCareers.season === index.season.startYear
    ? playerCareers.players[playerId] ?? null
    : null;
  return {
    id: player.id,
    name: player.name,
    teamId: team.id,
    team: team.name,
    teamCode: team.code,
    league: index.season.leagueName,
    season: index.season.displayName,
    startYear: index.season.startYear,
    logoUrl: team.logoUrl,
    photoUrl: player.photoUrl,
    kickerUrl: kickerProfileUrl(index.season, player.name, team.name),
    kickerNewsUrl: kickerNews.url,
    kickerNewsDirect: kickerNews.direct,
    transfermarktUrl: bio?.tmUrl ?? `https://www.transfermarkt.de/schnellsuche/ergebnis/schnellsuche?query=${encodeURIComponent(player.name)}`,
    ligaInsiderUrl: roleSignals?.league === index.season.leagueCode && roleSignals.season === index.season.startYear
      ? roleSignals.players[player.id]?.sourceUrl ?? null
      : null,
    position: player.position,
    priceM: player.priceM,
    seasonPoints,
    value: player.priceM > 0 && player.priceM < 999 ? seasonPoints / player.priceM : null,
    bio,
    career: careerEntry ? {
      generatedAt: playerCareers!.generatedAt,
      provider: playerCareers!.provider,
      tmId: careerEntry.tmId,
      tmUrl: careerEntry.tmUrl,
      clubs: careerEntry.clubs,
      seasons: careerEntry.seasons ?? [],
    } : null,
    seasons,
    games,
    news: buildPlayerNews(news, player.id, team.id),
    availability: availability ? {
      status: availability.status,
      reason: availability.reason,
      absentSince: availability.absentSince,
      expectedReturn: availability.expectedReturn,
      source: availability.source,
      sourceUrl: availability.sourceUrl,
      generatedAt: availabilitySignals!.generatedAt,
    } : null,
  };
}

async function playerSeasonHistory(catalog: StaticCatalog, playerId: string): Promise<PlayerSeasonSummary[]> {
  const candidates = catalog.seasons.flatMap((season) => {
    const membership = season.players.find((player) => player.id === playerId);
    if (!membership) return [];
    return [{
      startYear: season.startYear,
      season: season.displayName,
      leagueCode: season.leagueCode,
      league: catalog.leagues.find((league) => league.code === season.leagueCode)?.name ?? season.leagueCode,
      points: membership.points,
      active: membership.active,
      appearances: membership.appearances,
    }];
  }).sort((left, right) => right.startYear - left.startYear
    || Number(right.active) - Number(left.active)
    || right.appearances - left.appearances
    || right.points - left.points
    || left.leagueCode.localeCompare(right.leagueCode));
  const years = new Set<number>();
  return Promise.all(candidates.filter((season) => {
    if (years.has(season.startYear)) return false;
    years.add(season.startYear);
    return true;
  }).map(async (season) => {
    const params = new URLSearchParams({ league: season.leagueCode, season: String(season.startYear) });
    const index = await loadSeason(params);
    const appearanceScores = index.season.scores.filter((score) => score.playerId === playerId && scoreCountsAsAppearance(score));
    const teamCounts = new Map<string, number>();
    for (const score of appearanceScores) teamCounts.set(score.teamId, (teamCounts.get(score.teamId) ?? 0) + 1);
    const fallbackTeamId = index.players.get(playerId)?.teamId;
    if (!teamCounts.size && fallbackTeamId) teamCounts.set(fallbackTeamId, 0);
    const teams = [...teamCounts].flatMap(([teamId, count]) => {
      const team = index.teams.get(teamId);
      return team ? [{ ...team, count }] : [];
    }).sort((left, right) => right.count - left.count || left.name.localeCompare(right.name, "de"))
      .map(({ count: _count, ...team }) => team);
    return {
      startYear: season.startYear,
      season: season.season,
      league: season.league,
      teams,
      appearances: appearanceScores.length,
      gradedAppearances: index.season.scores.filter((score) => score.playerId === playerId && score.grade != null && score.grade > 0).length,
      points: season.points,
      goals: appearanceScores.reduce((sum, score) => sum + score.goals, 0),
      assists: appearanceScores.reduce((sum, score) => sum + score.assists, 0),
    };
  }));
}

function kickerProfileUrl(season: StaticSeason, playerName: string, teamName: string) {
  const league = ({ "0001": "bundesliga", "0002": "2-bundesliga", "0003": "3-liga" } as Record<string, string>)[season.leagueCode]
    ?? profileSlug(season.leagueName);
  const seasonSlug = season.displayName.replace("/", "-");
  return `https://www.kicker.de/${profileSlug(playerName)}/spieler/${league}/${seasonSlug}/${profileSlug(teamName)}`;
}

function profileSlug(value: string) {
  return value.toLocaleLowerCase("de")
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
