import type { BestEleven, Dashboard, Player, Position, TeamPlayerScore, TeamScore } from "../../types/models";
import type { SeasonIndex, StaticScore, StaticSeason } from "./contracts";

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

export function selectedRound(params: URLSearchParams, season: StaticSeason) {
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

export function summarizePlayers(index: SeasonIndex, round: number): { players: Player[]; appearances: Map<string, number> } {
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
      previousSeasonPoints: null,
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

export function buildLeaderboards(players: Player[], exact: boolean): Dashboard["leaderboards"] {
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

export function buildTeamScores(index: SeasonIndex, window: TeamWindow): TeamScore[] {
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

export function bestEleven(index: SeasonIndex, scope: "matchday" | "season", round: number): BestEleven {
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

export function scoreCountsAsAppearance(score: StaticScore) {
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
