import type {
  BestEleven,
  Catalog,
  ClubProfile,
  ClubSquadMember,
  Dashboard,
  LikelyEleven,
  Player,
  PlayerCareer,
  PlayerDetail,
  PlayerGame,
  PlayerSeasonSummary,
  Position,
  TeamDetail,
  TeamDetailMatch,
  TeamDetailPlayer,
  TeamMatchContributor,
  TeamPlayerScore,
  TeamScore,
  TopPlayerAnalysis,
  TopPlayers,
} from "./types";
import { buildPlayerNews } from "./news";
import type { NewsArtifact } from "./news";
import { kickerPlayerNewsLink } from "./kicker-links";
import { latestImportedRound } from "./rounds";
import { computeTable, crossTable, formLastN, formPoints, positionsByRound, trendVsRound } from "./standings";
import type { LeagueStandings, LeagueTableRow, LeagueTableTeam, MatchdayContributor, MatchdayFixture } from "./types";
type StaticCatalog = Catalog & { schemaVersion: number; generatedAt: string };

type StaticClubProfiles = {
  schemaVersion: number;
  generatedAt: string;
  leagueCode: string;
  season: number;
  provider: string;
  teams: Record<string, ClubProfile & {
    name: string;
    transfermarktClubId: number;
    unmatchedSquad: { tmName: string; tmId: number }[];
    unmatchedKicker: { playerId: string; name: string }[];
  }>;
};

type StaticPlayerCareers = {
  schemaVersion: number;
  generatedAt: string;
  leagueCode: string;
  season: number;
  provider: string;
  players: Record<string, { tmId: number; tmUrl: string; clubs: PlayerCareer["clubs"]; seasons?: PlayerCareer["seasons"] }>;
};

type StaticRoleSignals = {
  schemaVersion: number;
  generatedAt: string;
  league: string;
  season: number;
  players: Record<string, {
    role: "starter" | "alternative" | "squad";
    sourceUrl: string;
    sourceUpdatedAt: string;
  }>;
  teams: Record<string, {
    ligaInsiderUrl: string;
    transfermarktUrl: string;
    headlines: { source: string; title: string; url: string }[];
  }>;
};

type StaticAvailabilitySignals = {
  schemaVersion: number;
  generatedAt: string;
  season: number;
  leagues: Record<string, {
    provider: string;
    sourceUrl: string;
    players: Record<string, {
      status: "injured" | "rehab" | "suspended" | "not_considered" | "unavailable";
      reason: string | null;
      absentSince: string | null;
      expectedReturn: string | null;
      source: string;
      sourceUrl: string;
      profileUrl: string | null;
    }>;
  }>;
};

type StaticSeason = {
  schemaVersion: number;
  generatedAt: string;
  id: string;
  leagueCode: string;
  leagueName: string;
  startYear: number;
  displayName: string;
  roundCount: number;
  latestRound: number;
  rounds: { id: string; number: number; name: string; startAt: string | null; endAt: string | null; phase: string }[];
  teams: StaticTeam[];
  players: StaticPlayer[];
  matches: StaticMatch[];
  scores: StaticScore[];
};

type StaticTeam = { id: string; name: string; code: string; logoUrl: string | null };
type StaticPlayer = {
  id: string;
  name: string;
  teamId: string;
  position: Position;
  priceM: number;
  active: boolean;
  selectable: boolean;
  photoUrl: string | null;
};
type StaticMatch = {
  id: string;
  round: number;
  homeTeamId: string;
  awayTeamId: string;
  scheduledAt: string | null;
  state: string;
  homeScore: number | null;
  awayScore: number | null;
};
type StaticScore = {
  matchId: string;
  playerId: string;
  teamId: string;
  totalPoints: number;
  grade: number | null;
  goals: number;
  assists: number;
  pointsCleanSheet: number;
  pointsGrade: number;
  pointsGoals: number;
  pointsCards: number;
  pointsAssists: number;
  pointsStarter: number;
  pointsMvp: number;
  pointsJoker: number;
};

type SeasonIndex = {
  season: StaticSeason;
  teams: Map<string, StaticTeam>;
  players: Map<string, StaticPlayer>;
  matches: Map<string, StaticMatch>;
};

type PlayerAccumulator = {
  points: number;
  roundPoints: number;
  gradeTotal: number;
  roundGradeTotal: number;
  gradedMatches: number;
  roundGradedMatches: number;
  goals: number;
  roundGoals: number;
  assists: number;
  roundAssists: number;
  cleanSheets: number;
  roundCleanSheets: number;
  starterPoints: number;
  roundStarterPoints: number;
  cardPoints: number;
  roundCardPoints: number;
  yellowRedCards: number;
  roundYellowRedCards: number;
  redCards: number;
  roundRedCards: number;
  mvpAwards: number;
  roundMvpAwards: number;
  jokerAwards: number;
  roundJokerAwards: number;
  appearances: number;
};

const catalogCache = loadJson<StaticCatalog>(asset("data/catalog.json"));
const newsCache = loadJson<NewsArtifact>(asset("data/news.json")).catch((): NewsArtifact => ({
  schemaVersion: 1,
  generatedAt: "",
  provider: "",
  players: {},
  loadFailed: true,
}));
const roleSignalsCache = loadJson<StaticRoleSignals>(asset("data/current-role-signals.json")).catch(() => null);
const availabilitySignalsCache = loadJson<StaticAvailabilitySignals>(asset("data/current-availability-signals.json")).catch(() => null);
const seasonCache = new Map<string, Promise<SeasonIndex>>();
const clubProfilesCache = new Map<string, Promise<StaticClubProfiles | null>>();
const playerCareersCache = new Map<string, Promise<StaticPlayerCareers | null>>();

function asset(path: string) {
  return `${import.meta.env.BASE_URL}${path}`;
}

async function loadJson<T>(path: string): Promise<T> {
  const response = await fetch(path, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`Datendatei konnte nicht geladen werden (${response.status})`);
  return response.json() as Promise<T>;
}

function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(new DOMException("Abgebrochen", "AbortError"));
  return new Promise((resolve, reject) => {
    const abort = () => reject(new DOMException("Abgebrochen", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

function loadSeason(params: URLSearchParams): Promise<SeasonIndex> {
  const league = params.get("league") ?? "0001";
  const year = params.get("season") ?? String(currentSeasonStartYear());
  const id = `se-k${league}${year}`;
  let pending = seasonCache.get(id);
  if (!pending) {
    pending = loadJson<StaticSeason>(asset(`data/seasons/${id}.json`)).then((season) => {
      if (season.schemaVersion !== 2) throw new Error("Die Datendatei verwendet einen unbekannten Vertrag.");
      return {
        season,
        teams: new Map(season.teams.map((team) => [team.id, team])),
        players: new Map(season.players.map((player) => [player.id, player])),
        matches: new Map(season.matches.map((match) => [match.id, match])),
      };
    });
    seasonCache.set(id, pending);
  }
  return pending;
}

// Profile snapshots are versioned by league and season. The legacy current-
// season filename remains a fallback while older deployments are cached.
function loadClubProfiles(league: string, season: number): Promise<StaticClubProfiles | null> {
  const key = `${league}-${season}`;
  let pending = clubProfilesCache.get(key);
  if (!pending) {
    pending = loadJson<StaticClubProfiles>(asset(`data/club-profiles/${key}.json`))
      .catch(() => loadJson<StaticClubProfiles>(asset(`data/club-profiles/${league}.json`)).catch(() => null));
    clubProfilesCache.set(key, pending);
  }
  return pending;
}

function loadPlayerCareers(league: string, season: number): Promise<StaticPlayerCareers | null> {
  const key = `${league}-${season}`;
  let pending = playerCareersCache.get(key);
  if (!pending) {
    pending = loadJson<StaticPlayerCareers>(asset(`data/player-careers/${key}.json`))
      .catch(() => loadJson<StaticPlayerCareers>(asset(`data/player-careers/${league}.json`)).catch(() => null));
    playerCareersCache.set(key, pending);
  }
  return pending;
}

function currentSeasonStartYear() {
  const today = new Date();
  return today.getUTCMonth() >= 6 ? today.getUTCFullYear() : today.getUTCFullYear() - 1;
}

function selectedRound(params: URLSearchParams, season: StaticSeason) {
  const round = Number(params.get("round") ?? season.latestRound ?? 1);
  if (!Number.isInteger(round) || round < 1 || round > season.roundCount) {
    throw new Error(`Spieltag muss zwischen 1 und ${season.roundCount} liegen.`);
  }
  return round;
}

function emptyAccumulator(): PlayerAccumulator {
  return {
    points: 0,
    roundPoints: 0,
    gradeTotal: 0,
    roundGradeTotal: 0,
    gradedMatches: 0,
    roundGradedMatches: 0,
    goals: 0,
    roundGoals: 0,
    assists: 0,
    roundAssists: 0,
    cleanSheets: 0,
    roundCleanSheets: 0,
    starterPoints: 0,
    roundStarterPoints: 0,
    cardPoints: 0,
    roundCardPoints: 0,
    yellowRedCards: 0,
    roundYellowRedCards: 0,
    redCards: 0,
    roundRedCards: 0,
    mvpAwards: 0,
    roundMvpAwards: 0,
    jokerAwards: 0,
    roundJokerAwards: 0,
    appearances: 0,
  };
}

function summarizePlayers(index: SeasonIndex, round: number): { players: Player[]; appearances: Map<string, number> } {
  const metrics = new Map<string, PlayerAccumulator>();
  for (const score of index.season.scores) {
    const match = index.matches.get(score.matchId);
    if (!match || match.round > round) continue;
    const value = metrics.get(score.playerId) ?? emptyAccumulator();
    const exact = match.round === round;
    value.appearances += 1;
    value.points += score.totalPoints;
    value.goals += score.goals;
    value.assists += score.assists;
    value.cleanSheets += score.pointsCleanSheet > 0 ? 1 : 0;
    value.starterPoints += score.pointsStarter;
    value.cardPoints += score.pointsCards;
    value.yellowRedCards += score.pointsCards === -3 ? 1 : 0;
    value.redCards += score.pointsCards === -6 ? 1 : 0;
    value.mvpAwards += score.pointsMvp > 0 ? 1 : 0;
    value.jokerAwards += score.pointsJoker > 0 ? 1 : 0;
    if (score.grade != null && score.grade > 0) {
      value.gradeTotal += score.grade;
      value.gradedMatches += 1;
    }
    if (exact) {
      value.roundPoints += score.totalPoints;
      value.roundGoals += score.goals;
      value.roundAssists += score.assists;
      value.roundCleanSheets += score.pointsCleanSheet > 0 ? 1 : 0;
      value.roundStarterPoints += score.pointsStarter;
      value.roundCardPoints += score.pointsCards;
      value.roundYellowRedCards += score.pointsCards === -3 ? 1 : 0;
      value.roundRedCards += score.pointsCards === -6 ? 1 : 0;
      value.roundMvpAwards += score.pointsMvp > 0 ? 1 : 0;
      value.roundJokerAwards += score.pointsJoker > 0 ? 1 : 0;
      if (score.grade != null && score.grade > 0) {
        value.roundGradeTotal += score.grade;
        value.roundGradedMatches += 1;
      }
    }
    metrics.set(score.playerId, value);
  }

  const players = index.season.players.filter((player) => player.selectable).map((player): Player => {
    const value = metrics.get(player.id) ?? emptyAccumulator();
    const team = index.teams.get(player.teamId);
    return {
      id: player.id,
      name: player.name,
      team: team?.name ?? "Unbekannter Verein",
      teamCode: team?.code ?? "—",
      logoUrl: team?.logoUrl ?? null,
      photoUrl: player.photoUrl,
      position: player.position,
      priceM: player.priceM,
      roundPoints: value.roundPoints,
      observedPoints: value.points,
      averageGrade: value.gradedMatches ? value.gradeTotal / value.gradedMatches / 100 : null,
      roundGrade: value.roundGradedMatches ? value.roundGradeTotal / value.roundGradedMatches / 100 : null,
      gradedMatches: value.gradedMatches,
      goals: value.goals,
      roundGoals: value.roundGoals,
      assists: value.assists,
      roundAssists: value.roundAssists,
      cleanSheets: value.cleanSheets,
      roundCleanSheets: value.roundCleanSheets,
      starterPoints: value.starterPoints,
      roundStarterPoints: value.roundStarterPoints,
      cardPoints: value.cardPoints,
      roundCardPoints: value.roundCardPoints,
      yellowRedCards: value.yellowRedCards,
      roundYellowRedCards: value.roundYellowRedCards,
      redCards: value.redCards,
      roundRedCards: value.roundRedCards,
      mvpAwards: value.mvpAwards,
      roundMvpAwards: value.roundMvpAwards,
      jokerAwards: value.jokerAwards,
      roundJokerAwards: value.roundJokerAwards,
      value: player.priceM > 0 && player.priceM < 999 ? value.points / player.priceM : null,
    };
  });
  return { players, appearances: new Map([...metrics].map(([id, value]) => [id, value.appearances])) };
}

type LeaderboardMetric = "goals" | "assists" | "cleanSheets" | "starterPoints" | "cardDeductions" | "mvpAwards" | "jokerAwards";

function seasonMetric(player: Player, metric: LeaderboardMetric) {
  if (metric === "cardDeductions") return -player.cardPoints;
  return player[metric];
}

function roundMetric(player: Player, metric: LeaderboardMetric) {
  const key = {
    goals: "roundGoals",
    assists: "roundAssists",
    cleanSheets: "roundCleanSheets",
    starterPoints: "roundStarterPoints",
    cardDeductions: "roundCardPoints",
    mvpAwards: "roundMvpAwards",
    jokerAwards: "roundJokerAwards",
  }[metric] as keyof Player;
  const value = player[key] as number;
  return metric === "cardDeductions" ? -value : value;
}

function buildLeaderboards(players: Player[], exact: boolean): Dashboard["leaderboards"] {
  const points = (player: Player) => exact ? player.roundPoints : player.observedPoints;
  const top = (position: Position | null, limit?: number) => {
    const ranked = players
    .filter((player) => points(player) !== 0 && (!position || player.position === position))
      .sort((left, right) => points(right) - points(left) || left.name.localeCompare(right.name, "de"));
    return limit == null ? ranked : ranked.slice(0, limit);
  };
  const grades = players
    .filter((player) => (exact ? player.roundGrade : player.averageGrade) != null)
    .sort((left, right) => {
      const leftGrade = exact ? left.roundGrade! : left.averageGrade!;
      const rightGrade = exact ? right.roundGrade! : right.averageGrade!;
      return leftGrade - rightGrade || (exact ? right.roundPoints - left.roundPoints : right.gradedMatches - left.gradedMatches);
    });
  const metric = (name: LeaderboardMetric, position: Position | null) => players
    .filter((player) => (exact ? roundMetric(player, name) : seasonMetric(player, name)) > 0 && (!position || player.position === position))
    .sort((left, right) => {
      const difference = (exact ? roundMetric(right, name) : seasonMetric(right, name)) - (exact ? roundMetric(left, name) : seasonMetric(left, name));
      return difference || points(right) - points(left) || left.name.localeCompare(right.name, "de");
    });
  return {
    overall: top(null, exact ? 30 : 10),
    positions: {
      GK: top("GK"),
      DEF: top("DEF"),
      MID: top("MID"),
      FWD: top("FWD"),
    },
    grades,
    goals: metric("goals", null),
    assists: metric("assists", null),
    cleanSheets: metric("cleanSheets", "GK"),
    starterPoints: metric("starterPoints", null),
    cardDeductions: metric("cardDeductions", null),
    mvpAwards: metric("mvpAwards", null),
    jokerAwards: metric("jokerAwards", null),
  };
}

type TeamWindow = { kind: "all" } | { kind: "through" | "exact"; round: number };

function buildTeamScores(index: SeasonIndex, window: TeamWindow): TeamScore[] {
  const byTeam = new Map<string, Map<string, number>>();
  for (const team of index.season.teams) byTeam.set(team.id, new Map());
  for (const score of index.season.scores) {
    const match = index.matches.get(score.matchId);
    if (!match) continue;
    if (window.kind === "through" && match.round > window.round) continue;
    if (window.kind === "exact" && match.round !== window.round) continue;
    const players = byTeam.get(score.teamId);
    if (!players) continue;
    players.set(score.playerId, (players.get(score.playerId) ?? 0) + score.totalPoints);
  }
  const result = index.season.teams.map((team): TeamScore => {
    const playerPoints = byTeam.get(team.id) ?? new Map();
    const players = [...playerPoints].flatMap(([id, points]): TeamPlayerScore[] => {
      const player = index.players.get(id);
      return player ? [{ id, name: player.name, position: player.position, points }] : [];
    });
    const forPosition = (position: Position | null) => players.filter((player) => !position || player.position === position);
    const points = (position: Position | null) => forPosition(position).reduce((sum, player) => sum + player.points, 0);
    const top = (position: Position | null) => forPosition(position)
      .sort((left, right) => right.points - left.points || left.name.localeCompare(right.name, "de"))
      .slice(0, 10);
    return {
      id: team.id,
      name: team.name,
      code: team.code,
      logoUrl: team.logoUrl,
      overall: points(null),
      goalkeeper: points("GK"),
      defence: points("DEF"),
      midfield: points("MID"),
      forward: points("FWD"),
      sampleSize: players.length,
      topPlayers: {
        overall: top(null),
        goalkeeper: top("GK"),
        defence: top("DEF"),
        midfield: top("MID"),
        forward: top("FWD"),
      },
    };
  });
  return result.sort((left, right) => right.overall - left.overall || left.name.localeCompare(right.name, "de"));
}

function leagueStandings(index: SeasonIndex, round: number): LeagueStandings {
  const matches = index.season.matches;
  const teamIds = index.season.teams.map((team) => team.id);
  const teamName = (teamId: string) => index.teams.get(teamId)?.name ?? teamId;
  const toTeam = (teamId: string): LeagueTableTeam => {
    const team = index.teams.get(teamId);
    return { id: teamId, name: team?.name ?? "Unbekannter Verein", code: team?.code ?? "—", logoUrl: team?.logoUrl ?? null };
  };
  const table = computeTable(matches, teamIds, round, teamName);
  const positions = positionsByRound(matches, teamIds, round, teamName);
  const rows = table.map((row): LeagueTableRow => {
    const form = formLastN(matches, row.teamId, round, 5);
    const teamPositions = positions.get(row.teamId) ?? [];
    return {
      team: toTeam(row.teamId),
      rank: row.rank,
      played: row.played,
      wins: row.wins,
      draws: row.draws,
      losses: row.losses,
      goalsFor: row.goalsFor,
      goalsAgainst: row.goalsAgainst,
      goalDifference: row.goalDifference,
      points: row.points,
      trend: trendVsRound(teamPositions, round),
      form: form.map((result) => ({
        round: result.round,
        outcome: result.outcome,
        score: `${result.goalsFor}:${result.goalsAgainst}`,
        home: result.home,
        opponent: toTeam(result.opponentId),
      })),
      formPoints: formPoints(form),
      positions: teamPositions,
    };
  });
  const scoresByMatch = new Map<string, StaticScore[]>();
  for (const score of index.season.scores) {
    const matchScores = scoresByMatch.get(score.matchId);
    if (matchScores) matchScores.push(score);
    else scoresByMatch.set(score.matchId, [score]);
  }
  const fixtures = matches.filter((match) => match.round === round)
    .sort((left, right) => (left.scheduledAt ?? "").localeCompare(right.scheduledAt ?? "") || left.id.localeCompare(right.id))
    .map((match): MatchdayFixture => {
      const matchScores = scoresByMatch.get(match.id) ?? [];
      const contributors = (teamId: string, key: "goals" | "assists"): MatchdayContributor[] => matchScores
        .filter((score) => score.teamId === teamId && score[key] > 0)
        .map((score) => {
          const player = index.players.get(score.playerId);
          return { id: score.playerId, name: player?.name ?? "Unbekannt", photoUrl: player?.photoUrl ?? null, count: score[key] };
        })
        .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name, "de"));
      const side = (teamId: string) => ({ team: toTeam(teamId), goals: contributors(teamId, "goals"), assists: contributors(teamId, "assists") });
      return {
        id: match.id,
        scheduledAt: match.scheduledAt,
        state: match.state,
        homeScore: match.homeScore,
        awayScore: match.awayScore,
        home: side(match.homeTeamId),
        away: side(match.awayTeamId),
      };
    });

  return {
    context: {
      league: index.season.leagueCode,
      leagueName: index.season.leagueName,
      season: index.season.displayName,
      round,
      roundCount: index.season.roundCount,
      playedMatchCount: matches.filter((match) => match.round <= round && match.homeScore != null && match.awayScore != null).length,
    },
    rows,
    fixtures,
    cross: {
      order: rows.map((row) => row.team.id),
      cells: Object.fromEntries(crossTable(matches, round)),
    },
  };
}

function compareNullable(left: number | null, right: number | null, direction: "asc" | "desc") {
  if (left == null && right == null) return 0;
  if (left == null) return 1;
  if (right == null) return -1;
  return direction === "asc" ? left - right : right - left;
}

function sortPlayers(players: Player[], sort: string, direction: "asc" | "desc") {
  const text = (left: string, right: string) => direction === "asc" ? left.localeCompare(right, "de") : right.localeCompare(left, "de");
  return players.sort((left, right) => {
    if (sort === "name") return text(left.name, right.name);
    if (sort === "position") return text(left.position, right.position) || left.name.localeCompare(right.name, "de");
    const value = (player: Player): number | null => {
      if (sort === "price") return player.priceM;
      if (sort === "round") return player.roundPoints;
      if (sort === "grade") return player.averageGrade;
      if (sort === "goals") return player.goals;
      if (sort === "assists") return player.assists;
      if (sort === "value") return player.value;
      if (sort === "roundGrade") return player.roundGrade;
      if (sort === "roundGoals") return player.roundGoals;
      if (sort === "roundAssists") return player.roundAssists;
      return player.observedPoints;
    };
    return compareNullable(value(left), value(right), direction) || left.name.localeCompare(right.name, "de");
  });
}

async function playerDetail(
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

function scoreCountsAsAppearance(score: StaticScore) {
  return (score.grade != null && score.grade > 0)
    || score.totalPoints !== 0
    || score.goals !== 0
    || score.assists !== 0
    || score.pointsCleanSheet !== 0
    || score.pointsGrade !== 0
    || score.pointsGoals !== 0
    || score.pointsCards !== 0
    || score.pointsAssists !== 0
    || score.pointsStarter !== 0
    || score.pointsMvp !== 0
    || score.pointsJoker !== 0;
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

// Once matches have been played, the likely starting eleven is derived from
// actual lineups. Before kickoff, Bundesliga role signals provide a preseason
// fallback so a possible eleven remains useful on the current-season page.
function likelyEleven(index: SeasonIndex, teamId: string, roleSignals: StaticRoleSignals | null, eligiblePlayers: Set<string> | null = null): LikelyEleven | null {
  const starts = new Map<string, number>();
  const points = new Map<string, number>();
  const evaluatedMatches = new Set<string>();
  for (const score of index.season.scores) {
    if (score.teamId !== teamId) continue;
    evaluatedMatches.add(score.matchId);
    points.set(score.playerId, (points.get(score.playerId) ?? 0) + score.totalPoints);
    if (score.pointsStarter > 0) starts.set(score.playerId, (starts.get(score.playerId) ?? 0) + 1);
  }
  const useRoleSnapshot = !starts.size
    && roleSignals?.league === index.season.leagueCode
    && roleSignals.season === index.season.startYear;
  if (!starts.size && !useRoleSnapshot) return null;
  const candidates: LikelyEleven["players"] = useRoleSnapshot
    ? [...index.players.values()].flatMap((player) => {
        const signal = roleSignals.players[player.id];
        if (player.teamId !== teamId || !signal || (eligiblePlayers && !eligiblePlayers.has(player.id))) return [];
        return [{ id: player.id, name: player.name, position: player.position, photoUrl: player.photoUrl, starts: signal.role === "starter" ? 1 : 0, points: 0, role: signal.role }];
      })
    : [...starts].flatMap(([id, count]) => {
        if (eligiblePlayers && !eligiblePlayers.has(id)) return [];
        const player = index.players.get(id);
        return player ? [{ id, name: player.name, position: player.position, photoUrl: player.photoUrl, starts: count, points: points.get(id) ?? 0, role: null }] : [];
      });
  const formations = [[3, 4, 3], [4, 3, 3], [3, 5, 2], [4, 4, 2], [4, 5, 1], [5, 3, 2], [5, 4, 1]] as const;
  let best: { starts: number; formation: string; players: LikelyEleven["players"] } | null = null;
  for (const [defenders, midfielders, forwards] of formations) {
    const counts: [Position, number][] = [["GK", 1], ["DEF", defenders], ["MID", midfielders], ["FWD", forwards]];
    const eleven = counts.flatMap(([position, count]) => candidates.filter((player) => player.position === position)
      .sort((left, right) => {
        const roleWeight = (role: LikelyEleven["players"][number]["role"]) => role === "starter" ? 2 : role === "alternative" ? 1 : 0;
        return right.starts - left.starts || roleWeight(right.role) - roleWeight(left.role) || right.points - left.points || left.name.localeCompare(right.name, "de");
      })
      .slice(0, count));
    if (eleven.length !== 11) continue;
    const total = eleven.reduce((sum, player) => sum + player.starts, 0);
    if (!best || total > best.starts) best = { starts: total, formation: `${defenders}–${midfielders}–${forwards}`, players: eleven };
  }
  if (!best) return null;
  return { formation: best.formation, evaluatedMatches: evaluatedMatches.size, source: useRoleSnapshot ? "roleSnapshot" : "seasonStarts", players: best.players };
}

function teamDetail(index: SeasonIndex, teamId: string, roleSignals: StaticRoleSignals | null, clubProfiles: StaticClubProfiles | null): TeamDetail {
  const team = index.teams.get(teamId);
  if (!team) throw new Error("Mannschaft wurde in dieser Saison nicht gefunden.");
  const snapshot = clubProfiles?.leagueCode === index.season.leagueCode && clubProfiles.season === index.season.startYear
    ? clubProfiles.teams[teamId] ?? null
    : null;
  const points = new Map<string, number>();
  for (const score of index.season.scores) {
    if (score.teamId === teamId) points.set(score.playerId, (points.get(score.playerId) ?? 0) + score.totalPoints);
  }
  const rosterIds = snapshot
    ? new Set([
        ...Object.keys(snapshot.squad),
        ...index.season.players.filter((player) => player.teamId === teamId && player.active).map((player) => player.id),
      ])
    : new Set([...index.season.players.filter((player) => player.teamId === teamId).map((player) => player.id), ...points.keys()]);
  const players = [...rosterIds].flatMap((id): TeamDetailPlayer[] => {
    const player = index.players.get(id);
    return player ? [{ id, name: player.name, position: player.position, points: points.get(id) ?? 0, photoUrl: player.photoUrl }] : [];
  }).sort((left, right) => right.points - left.points || left.name.localeCompare(right.name, "de"));

  const matches = index.season.matches.filter((match) => match.homeTeamId === teamId || match.awayTeamId === teamId).map((match): TeamDetailMatch => {
    const home = match.homeTeamId === teamId;
    const opponent = index.teams.get(home ? match.awayTeamId : match.homeTeamId);
    if (!opponent) throw new Error("Gegner wurde in der Saisondatei nicht gefunden.");
    const scores = index.season.scores.filter((score) => score.matchId === match.id && score.teamId === teamId);
    const byPosition = (position: Position) => scores.filter((score) => index.players.get(score.playerId)?.position === position).reduce((sum, score) => sum + score.totalPoints, 0);
    const contributors = scores.filter((score) => score.totalPoints !== 0).flatMap((score): TeamMatchContributor[] => {
      const player = index.players.get(score.playerId);
      return player ? [{ id: player.id, name: player.name, position: player.position, points: score.totalPoints, photoUrl: player.photoUrl }] : [];
    }).sort((left, right) => right.points - left.points || left.name.localeCompare(right.name, "de"));
    return {
      matchday: match.round,
      scheduledAt: match.scheduledAt,
      opponentId: opponent.id,
      opponent: opponent.name,
      opponentCode: opponent.code,
      opponentLogoUrl: opponent.logoUrl,
      venue: home ? "Home" : "Away",
      homeScore: match.homeScore,
      awayScore: match.awayScore,
      totalPoints: scores.reduce((sum, score) => sum + score.totalPoints, 0),
      goalkeeperPoints: byPosition("GK"),
      defencePoints: byPosition("DEF"),
      midfieldPoints: byPosition("MID"),
      forwardPoints: byPosition("FWD"),
      gradePoints: scores.reduce((sum, score) => sum + score.pointsGrade, 0),
      goalPoints: scores.reduce((sum, score) => sum + score.pointsGoals, 0),
      assistPoints: scores.reduce((sum, score) => sum + score.pointsAssists, 0),
      cleanSheetPoints: scores.reduce((sum, score) => sum + score.pointsCleanSheet, 0),
      starterPoints: scores.reduce((sum, score) => sum + score.pointsStarter, 0),
      cardPoints: scores.reduce((sum, score) => sum + score.pointsCards, 0),
      yellowRedCards: scores.filter((score) => score.pointsCards === -3).length,
      redCards: scores.filter((score) => score.pointsCards === -6).length,
      mvpPoints: scores.reduce((sum, score) => sum + score.pointsMvp, 0),
      jokerPoints: scores.reduce((sum, score) => sum + score.pointsJoker, 0),
      players: contributors,
    };
  }).sort((left, right) => left.matchday - right.matchday);
  const source = roleSignals?.league === index.season.leagueCode && roleSignals.season === index.season.startYear
    ? roleSignals.teams[teamId]
    : null;
  return {
    id: team.id,
    name: team.name,
    code: team.code,
    startYear: index.season.startYear,
    logoUrl: team.logoUrl,
    players,
    matches,
    profile: snapshot ? {
      generatedAt: clubProfiles!.generatedAt,
      provider: clubProfiles!.provider,
      transfermarktUrl: snapshot.transfermarktUrl,
      coach: snapshot.coach,
      captainPlayerId: snapshot.captainPlayerId,
      squad: snapshot.squad,
      arrivals: snapshot.arrivals,
      departures: snapshot.departures,
    } : null,
    likelyEleven: likelyEleven(index, teamId, roleSignals, snapshot ? rosterIds : null),
    externalSources: source ? { generatedAt: roleSignals!.generatedAt, ...source } : null,
  };
}

function bestEleven(index: SeasonIndex, scope: "matchday" | "season", round: number): BestEleven {
  const grouped = new Map<string, { points: number; teamId: string }>();
  for (const score of index.season.scores) {
    const match = index.matches.get(score.matchId);
    if (!match || (scope === "matchday" ? match.round !== round : match.round > round)) continue;
    const value = grouped.get(score.playerId) ?? { points: 0, teamId: scope === "matchday" ? score.teamId : index.players.get(score.playerId)?.teamId ?? score.teamId };
    value.points += score.totalPoints;
    grouped.set(score.playerId, value);
  }
  const candidates = [...grouped].flatMap(([id, score]) => {
    const player = index.players.get(id);
    const team = index.teams.get(score.teamId);
    return player?.selectable && team ? [{ id, name: player.name, team: team.name, teamCode: team.code, logoUrl: team.logoUrl, position: player.position, points: score.points }] : [];
  });
  const formations = [[3, 4, 3], [4, 3, 3], [3, 5, 2], [4, 4, 2], [4, 5, 1], [5, 3, 2], [5, 4, 1]] as const;
  let best: { points: number; formation: string; players: BestEleven["players"] } | null = null;
  for (const [defenders, midfielders, forwards] of formations) {
    const counts: [Position, number][] = [["GK", 1], ["DEF", defenders], ["MID", midfielders], ["FWD", forwards]];
    const eleven = counts.flatMap(([position, count]) => candidates.filter((player) => player.position === position)
      .sort((left, right) => right.points - left.points || left.name.localeCompare(right.name, "de"))
      .slice(0, count));
    if (eleven.length !== 11) continue;
    const points = eleven.reduce((sum, player) => sum + player.points, 0);
    if (!best || points > best.points) best = { points, formation: `${defenders}–${midfielders}–${forwards}`, players: eleven };
  }
  if (!best) throw new Error("Für diese Auswahl lässt sich noch keine vollständige beste Elf berechnen.");
  const order: Record<Position, number> = { FWD: 0, MID: 1, DEF: 2, GK: 3 };
  best.players.sort((left, right) => order[left.position] - order[right.position] || right.points - left.points || left.name.localeCompare(right.name, "de"));
  return { scope, matchday: scope === "matchday" ? round : null, ...best };
}

function topPlayers(index: SeasonIndex, catalog: StaticCatalog): TopPlayers {
  const leagueName = catalog.leagues.find((league) => league.code === index.season.leagueCode)?.name ?? index.season.leagueName;
  const currentRound = Math.max(0, index.season.latestRound);
  const currentPointsById = new Map<string, number>();
  if (currentRound > 0) {
    for (const player of summarizePlayers(index, currentRound).players) currentPointsById.set(player.id, player.observedPoints);
  }

  function historyFor(playerId: string) {
    const candidates = catalog.seasons.flatMap((season) => {
      if (season.startYear >= index.season.startYear || season.dataState !== "complete") return [];
      const membership = season.players.find((player) => player.id === playerId);
      if (!membership || membership.appearances < 1) return [];
      return [{
        startYear: season.startYear,
        season: season.displayName,
        leagueCode: season.leagueCode,
        league: catalog.leagues.find((league) => league.code === season.leagueCode)?.name ?? season.leagueCode,
        points: membership.points,
        appearances: membership.appearances,
        active: membership.active,
      }];
    }).sort((left, right) => left.startYear - right.startYear
      || Number(right.active) - Number(left.active)
      || right.appearances - left.appearances
      || right.points - left.points);
    const byYear = new Map<number, (typeof candidates)[number]>();
    for (const candidate of candidates) if (!byYear.has(candidate.startYear)) byYear.set(candidate.startYear, candidate);
    return [...byYear.values()];
  }

  function analyze(player: StaticPlayer): TopPlayerAnalysis | null {
    const team = index.teams.get(player.teamId);
    if (!team) return null;
    const history = historyFor(player.id);
    const leagueHistory = history.filter((season) => season.leagueCode === index.season.leagueCode);
    const comparison = leagueHistory.length >= 2 ? leagueHistory : history;
    const recent = comparison.slice(-2);
    const trendDelta = recent.length === 2 ? recent[1].points - recent[0].points : null;
    const trend = trendDelta == null ? "new" : trendDelta >= 15 ? "up" : trendDelta <= -15 ? "down" : "steady";
    const averagePoints = history.length
      ? Math.round(history.reduce((sum, season) => sum + season.points, 0) / history.length)
      : null;
    const priorSeason = history.at(-1);
    let growthStreak = 1;
    for (let cursor = comparison.length - 1; cursor > 0 && comparison[cursor].points > comparison[cursor - 1].points; cursor -= 1) growthStreak += 1;

    let signal: string;
    if (!priorSeason) {
      signal = "Neu im Datensatz · keine importierte Vorsaison";
    } else if (priorSeason.leagueCode !== index.season.leagueCode) {
      signal = `Neu in ${leagueName} · ${priorSeason.points} Pkt. in ${priorSeason.league}`;
    } else if (growthStreak >= 3) {
      signal = `${growthStreak} Saisons in Folge verbessert · zuletzt ${trendDelta != null && trendDelta >= 0 ? "+" : ""}${trendDelta ?? 0} Pkt.`;
    } else if (averagePoints != null) {
      const trendLabel = trendDelta == null ? "noch ohne Trend" : trend === "up" ? `zuletzt +${trendDelta}` : trend === "down" ? `zuletzt ${trendDelta}` : `zuletzt ${trendDelta >= 0 ? "+" : ""}${trendDelta}`;
      signal = `${history.length} Saison${history.length === 1 ? "" : "s"} im Archiv · Ø ${averagePoints} · ${trendLabel}`;
    } else {
      signal = "Noch keine abgeschlossene Vergleichssaison";
    }

    return {
      id: player.id,
      name: player.name,
      team: team.name,
      teamCode: team.code,
      logoUrl: team.logoUrl,
      photoUrl: player.photoUrl,
      position: player.position,
      priceM: player.priceM,
      currentPoints: currentRound > 0 ? currentPointsById.get(player.id) ?? 0 : null,
      previousSeason: priorSeason?.season ?? null,
      previousLeague: priorSeason?.league ?? null,
      previousPoints: priorSeason?.points ?? null,
      averagePoints,
      value: averagePoints != null && player.priceM > 0 ? averagePoints / player.priceM : null,
      seasons: history.length,
      trend,
      trendDelta,
      signal,
      history: history.slice(-5).map((season) => ({ season: season.season, league: season.league, points: season.points })),
    };
  }

  const analyzed = index.season.players
    .filter((player) => player.active && player.selectable && player.priceM >= 0 && player.priceM < 999)
    .flatMap((player) => {
      const result = analyze(player);
      return result ? [result] : [];
    });
  const positions = (Object.fromEntries((['GK', 'DEF', 'MID', 'FWD'] as Position[]).map((position) => [
    position,
    analyzed.filter((player) => player.position === position)
      .sort((left, right) => (right.previousPoints ?? -Infinity) - (left.previousPoints ?? -Infinity) || (right.averagePoints ?? -Infinity) - (left.averagePoints ?? -Infinity) || left.name.localeCompare(right.name, "de")),
  ])) as Record<Position, TopPlayerAnalysis[]>);
  const cutoffSeason = catalog.seasons.filter((season) => season.startYear < index.season.startYear && season.dataState === "complete")
    .sort((left, right) => right.startYear - left.startYear)[0]?.displayName ?? null;
  return {
    context: {
      season: index.season.displayName,
      cutoffSeason,
      playerCount: analyzed.length,
      currentRound,
    },
    positions,
  };
}

export const api = {
  catalog: (signal?: AbortSignal) => abortable(catalogCache.then(({ leagues, seasons }) => ({ leagues, seasons })), signal),
  dashboard: (params: URLSearchParams, signal?: AbortSignal) => abortable(loadSeason(params).then((index): Dashboard => {
    const round = selectedRound(params, index.season);
    const { players } = summarizePlayers(index, round);
    return {
      context: { league: index.season.leagueCode, season: index.season.displayName, round, lastSyncedAt: index.season.generatedAt, playerCount: index.season.players.length },
      leaderboards: buildLeaderboards(players, false),
      matchdayLeaderboards: buildLeaderboards(players, true),
      seasonTeams: buildTeamScores(index, { kind: "through", round }),
      matchdayTeams: buildTeamScores(index, { kind: "exact", round }),
    };
  }), signal),
  standings: (params: URLSearchParams, signal?: AbortSignal): Promise<LeagueStandings> => abortable(loadSeason(params).then((index) => leagueStandings(index, selectedRound(params, index.season))), signal),
  players: (params: URLSearchParams, signal?: AbortSignal) => abortable(loadSeason(params).then((index) => {
    const round = latestImportedRound(index.season);
    const query = (params.get("q") ?? "").trim().toLocaleLowerCase("de");
    const position = params.get("position") as Position | null;
    const direction = params.get("direction") === "asc" ? "asc" : "desc";
    const limit = Math.max(1, Math.min(100, Number(params.get("limit") ?? 50)));
    const offset = Math.max(0, Number(params.get("offset") ?? 0));
    const { players } = summarizePlayers(index, round);
    const filtered = sortPlayers(players.filter((player) => !position || player.position === position)
      .filter((player) => !query || player.name.toLocaleLowerCase("de").includes(query) || player.team.toLocaleLowerCase("de").includes(query)), params.get("sort") ?? "points", direction);
    return { items: filtered.slice(offset, offset + limit), nextOffset: offset + limit < filtered.length ? offset + limit : null };
  }), signal),
  player: (playerId: string, params: URLSearchParams, signal?: AbortSignal) => {
    const league = params.get("league") ?? "0001";
    const season = Number(params.get("season") ?? currentSeasonStartYear());
    return abortable(Promise.all([loadSeason(params), catalogCache, newsCache, roleSignalsCache, availabilitySignalsCache, loadClubProfiles(league, season), loadPlayerCareers(league, season)]).then(([index, catalog, news, roleSignals, availabilitySignals, clubProfiles, playerCareers]) => playerDetail(index, playerId, catalog, news, roleSignals, availabilitySignals, clubProfiles, playerCareers)), signal);
  },
  teams: (params: URLSearchParams, signal?: AbortSignal) => abortable(loadSeason(params).then((index) => buildTeamScores(index, { kind: "all" })), signal),
  team: (teamId: string, params: URLSearchParams, signal?: AbortSignal) => {
    const league = params.get("league") ?? "0001";
    const season = Number(params.get("season") ?? currentSeasonStartYear());
    return abortable(Promise.all([loadSeason(params), roleSignalsCache, loadClubProfiles(league, season)]).then(([index, roleSignals, clubProfiles]) => teamDetail(index, teamId, roleSignals, clubProfiles)), signal);
  },
  bestEleven: (params: URLSearchParams, signal?: AbortSignal) => abortable(loadSeason(params).then((index) => bestEleven(index, params.get("scope") === "season" ? "season" : "matchday", selectedRound(params, index.season))), signal),
  topPlayers: (params: URLSearchParams, signal?: AbortSignal): Promise<TopPlayers> => abortable(Promise.all([loadSeason(params), catalogCache]).then(([index, catalog]) => topPlayers(index, catalog)), signal),
};
