import type {
  BestEleven,
  Catalog,
  Dashboard,
  HistoricalPlayer,
  History,
  Player,
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
} from "./types";

type StaticCatalog = Catalog & { schemaVersion: number; generatedAt: string };

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
const seasonCache = new Map<string, Promise<SeasonIndex>>();

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
  const top = (position: Position | null, limit: number) => players
    .filter((player) => points(player) !== 0 && (!position || player.position === position))
    .sort((left, right) => points(right) - points(left) || left.name.localeCompare(right.name, "de"))
    .slice(0, limit);
  const grades = players
    .filter((player) => (exact ? player.roundGrade : player.averageGrade) != null)
    .sort((left, right) => {
      const leftGrade = exact ? left.roundGrade! : left.averageGrade!;
      const rightGrade = exact ? right.roundGrade! : right.averageGrade!;
      return leftGrade - rightGrade || (exact ? right.roundPoints - left.roundPoints : right.gradedMatches - left.gradedMatches);
    })
    .slice(0, exact ? 30 : 8);
  const metric = (name: LeaderboardMetric, position: Position | null, limit: number) => players
    .filter((player) => (exact ? roundMetric(player, name) : seasonMetric(player, name)) > 0 && (!position || player.position === position))
    .sort((left, right) => {
      const difference = (exact ? roundMetric(right, name) : seasonMetric(right, name)) - (exact ? roundMetric(left, name) : seasonMetric(left, name));
      return difference || points(right) - points(left) || left.name.localeCompare(right.name, "de");
    })
    .slice(0, limit);
  return {
    overall: top(null, exact ? 30 : 8),
    positions: {
      GK: top("GK", exact ? 30 : 20),
      DEF: top("DEF", exact ? 30 : 20),
      MID: top("MID", exact ? 30 : 20),
      FWD: top("FWD", exact ? 30 : 20),
    },
    grades,
    goals: metric("goals", null, exact ? 30 : 8),
    assists: metric("assists", null, exact ? 30 : 8),
    cleanSheets: metric("cleanSheets", "GK", exact ? 30 : 20),
    starterPoints: metric("starterPoints", null, exact ? 30 : 20),
    cardDeductions: metric("cardDeductions", null, exact ? 30 : 20),
    mvpAwards: metric("mvpAwards", null, exact ? 30 : 20),
    jokerAwards: metric("jokerAwards", null, exact ? 30 : 20),
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

function history(index: SeasonIndex): History {
  const { players, appearances } = summarizePlayers(index, index.season.roundCount);
  const historical = players.filter((player) => (appearances.get(player.id) ?? 0) > 0).map((player): HistoricalPlayer => ({
    id: player.id,
    name: player.name,
    team: player.team,
    teamCode: player.teamCode,
    logoUrl: player.logoUrl,
    photoUrl: player.photoUrl,
    position: player.position,
    points: player.observedPoints,
    averageGrade: player.averageGrade,
    gradedMatches: player.gradedMatches,
    goals: player.goals,
    assists: player.assists,
  }));
  const points = (position: Position | null) => historical
    .filter((player) => !position || player.position === position)
    .sort((left, right) => right.points - left.points || left.name.localeCompare(right.name, "de"))
    .slice(0, 30);
  const metrics = (metric: "goals" | "assists") => historical
    .filter((player) => player[metric] > 0)
    .sort((left, right) => right[metric] - left[metric] || right.points - left.points)
    .slice(0, 30);
  return { leaderboards: {
    overall: points(null),
    positions: { GK: points("GK"), DEF: points("DEF"), MID: points("MID"), FWD: points("FWD") },
    grades: historical.filter((player) => player.averageGrade != null)
      .sort((left, right) => left.averageGrade! - right.averageGrade! || right.gradedMatches - left.gradedMatches)
      .slice(0, 30),
    goals: metrics("goals"),
    assists: metrics("assists"),
  } };
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
      return player.observedPoints;
    };
    return compareNullable(value(left), value(right), direction) || left.name.localeCompare(right.name, "de");
  });
}

function playerDetail(index: SeasonIndex, playerId: string, catalog: StaticCatalog): PlayerDetail {
  const player = index.players.get(playerId);
  if (!player) throw new Error("Spieler wurde in dieser Saison nicht gefunden.");
  const team = index.teams.get(player.teamId);
  if (!team) throw new Error("Verein des Spielers wurde nicht gefunden.");
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
  const seasons = playerSeasonHistory(catalog, playerId);
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
    transfermarktUrl: `https://www.transfermarkt.de/schnellsuche/ergebnis/schnellsuche?query=${encodeURIComponent(player.name)}`,
    position: player.position,
    priceM: player.priceM,
    seasonPoints,
    value: player.priceM > 0 && player.priceM < 999 ? seasonPoints / player.priceM : null,
    seasons,
    games,
  };
}

function playerSeasonHistory(catalog: StaticCatalog, playerId: string): PlayerSeasonSummary[] {
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
  return candidates.filter((season) => {
    if (years.has(season.startYear)) return false;
    years.add(season.startYear);
    return true;
  }).map((season) => ({
    startYear: season.startYear,
    season: season.season,
    league: season.league,
    points: season.points,
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

function teamDetail(index: SeasonIndex, teamId: string): TeamDetail {
  const team = index.teams.get(teamId);
  if (!team) throw new Error("Mannschaft wurde in dieser Saison nicht gefunden.");
  const points = new Map<string, number>();
  for (const score of index.season.scores) {
    if (score.teamId === teamId) points.set(score.playerId, (points.get(score.playerId) ?? 0) + score.totalPoints);
  }
  const rosterIds = new Set([...index.season.players.filter((player) => player.teamId === teamId).map((player) => player.id), ...points.keys()]);
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
  return { id: team.id, name: team.name, code: team.code, logoUrl: team.logoUrl, players, matches };
}

function bestEleven(index: SeasonIndex, scope: "matchday" | "season", round: number): BestEleven {
  const grouped = new Map<string, { points: number; teamId: string }>();
  for (const score of index.season.scores) {
    const match = index.matches.get(score.matchId);
    if (!match || (scope === "matchday" && match.round !== round)) continue;
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
  history: (params: URLSearchParams, signal?: AbortSignal) => abortable(loadSeason(params).then(history), signal),
  players: (params: URLSearchParams, signal?: AbortSignal) => abortable(loadSeason(params).then((index) => {
    const round = selectedRound(params, index.season);
    const query = (params.get("q") ?? "").trim().toLocaleLowerCase("de");
    const position = params.get("position") as Position | null;
    const direction = params.get("direction") === "asc" ? "asc" : "desc";
    const limit = Math.max(1, Math.min(100, Number(params.get("limit") ?? 50)));
    const offset = Math.max(0, Number(params.get("offset") ?? 0));
    const { players } = summarizePlayers(index, round);
    const filtered = sortPlayers(players.filter((player) => player.observedPoints !== 0)
      .filter((player) => !position || player.position === position)
      .filter((player) => !query || player.name.toLocaleLowerCase("de").includes(query) || player.team.toLocaleLowerCase("de").includes(query)), params.get("sort") ?? "points", direction);
    return { items: filtered.slice(offset, offset + limit), nextOffset: offset + limit < filtered.length ? offset + limit : null };
  }), signal),
  player: (playerId: string, params: URLSearchParams, signal?: AbortSignal) => abortable(Promise.all([loadSeason(params), catalogCache]).then(([index, catalog]) => playerDetail(index, playerId, catalog)), signal),
  teams: (params: URLSearchParams, signal?: AbortSignal) => abortable(loadSeason(params).then((index) => buildTeamScores(index, { kind: "all" })), signal),
  team: (teamId: string, params: URLSearchParams, signal?: AbortSignal) => abortable(loadSeason(params).then((index) => teamDetail(index, teamId)), signal),
  bestEleven: (params: URLSearchParams, signal?: AbortSignal) => abortable(loadSeason(params).then((index) => bestEleven(index, params.get("scope") === "season" ? "season" : "matchday", selectedRound(params, index.season))), signal),
};
