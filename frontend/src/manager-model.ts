import type {
  Catalog,
  ManagerMode,
  ManagerPickPlayer,
  ManagerRecommendation,
  Position,
  ProjectionConfidence,
} from "./types";

export type ManagerSeason = {
  generatedAt: string;
  leagueCode: string;
  leagueName: string;
  startYear: number;
  displayName: string;
  roundCount: number;
  latestRound: number;
  teams: { id: string; name: string; code: string; logoUrl: string | null }[];
  matches: { id: string; round: number }[];
  scores: { matchId: string; playerId: string; totalPoints: number }[];
  players: {
    id: string;
    name: string;
    teamId: string;
    position: Position;
    priceM: number;
    active: boolean;
    selectable: boolean;
    photoUrl: string | null;
  }[];
};

type Formation = Record<Position, number>;
type ManagerRules = {
  budgetM: number;
  positions: Record<Position, number>;
  maxFromTeam: number | null;
  formations: Formation[];
  reserveWeight: number;
};

type Candidate = Omit<ManagerPickPlayer, "role" | "currentPoints"> & { projectionWeight: number };
type SquadRole = "start" | "reserve";
type PlanPick = { player: Candidate; role: SquadRole };
type PlanPath = { pick: PlanPick; previous: PlanPath | null };
type PlanOption = {
  spentCents: number;
  score: number;
  startingPoints: number;
  path: PlanPath | null;
};
type OptimizedRoster = PlanOption & { formation: Formation; picks: PlanPick[] };

const positionOrder: Position[] = ["GK", "DEF", "MID", "FWD"];
const formations: Formation[] = [
  { GK: 1, DEF: 3, MID: 4, FWD: 3 },
  { GK: 1, DEF: 3, MID: 5, FWD: 2 },
  { GK: 1, DEF: 4, MID: 3, FWD: 3 },
  { GK: 1, DEF: 4, MID: 4, FWD: 2 },
  { GK: 1, DEF: 4, MID: 5, FWD: 1 },
  { GK: 1, DEF: 5, MID: 3, FWD: 2 },
  { GK: 1, DEF: 5, MID: 4, FWD: 1 },
];

const budgets: Record<ManagerMode, Record<string, number>> = {
  classic: { "0001": 30, "0002": 7.5, "0003": 4 },
  interactive: { "0001": 42.5, "0002": 10, "0003": 6 },
};

const leagueLevels: Record<string, number> = { "0001": 1, "0002": 2, "0003": 3 };
const promotionFactors: Record<string, Record<Position, number>> = {
  "0001": { GK: 0.70, DEF: 0.56, MID: 0.53, FWD: 0.55 },
  "0002": { GK: 0.80, DEF: 0.72, MID: 0.65, FWD: 0.73 },
};

export function leagueProjectionFactor(fromLeague: string, toLeague: string, position: Position) {
  const fromLevel = leagueLevels[fromLeague];
  const toLevel = leagueLevels[toLeague];
  if (fromLevel == null || toLevel == null || fromLevel <= toLevel) return 1;
  let factor = 1;
  for (let targetLevel = fromLevel - 1; targetLevel >= toLevel; targetLevel -= 1) {
    const targetLeague = Object.entries(leagueLevels).find(([, level]) => level === targetLevel)?.[0];
    factor *= targetLeague ? promotionFactors[targetLeague]?.[position] ?? 0.65 : 0.65;
  }
  return factor;
}

export function managerRules(mode: ManagerMode, league: string): ManagerRules {
  const budgetM = budgets[mode][league];
  if (budgetM == null) throw new Error("Für diese Liga sind keine Manager-Regeln hinterlegt.");
  return mode === "classic"
    ? {
        budgetM,
        positions: { GK: 2, DEF: 5, MID: 5, FWD: 3 },
        maxFromTeam: 3,
        formations: [{ GK: 1, DEF: 4, MID: 4, FWD: 2 }],
        reserveWeight: 0.05,
      }
    : {
        budgetM,
        positions: { GK: 3, DEF: 7, MID: 7, FWD: 5 },
        maxFromTeam: null,
        formations,
        reserveWeight: 0.03,
      };
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}

function median(values: number[]) {
  if (!values.length) return 0;
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
}

function pricePrior(priceM: number, prices: number[], baseline: number) {
  const ordered = [...prices].sort((left, right) => left - right);
  const lower = ordered[Math.floor((ordered.length - 1) * 0.1)] ?? 0;
  const upper = ordered[Math.floor((ordered.length - 1) * 0.9)] ?? Math.max(lower + 0.1, priceM);
  const percentile = clamp((priceM - lower) / Math.max(0.1, upper - lower), 0, 1);
  return baseline * (0.72 + 0.68 * Math.sqrt(percentile));
}

function candidateHistory(catalog: Catalog, season: ManagerSeason, playerId: string, position: Position) {
  const observations = catalog.seasons.flatMap((historical) => {
    const age = season.startYear - historical.startYear;
    if (age < 0 || age > 4) return [];
    const membership = historical.players.find((player) => player.id === playerId);
    if (!membership || membership.appearances < 1) return [];
    const recency = [1, 0.82, 0.64, 0.48, 0.34][age];
    const sample = Math.min(1, membership.appearances / 12);
    const currentSeasonFactor = age === 0 ? 0.25 + 0.75 * Math.min(1, historical.latestRound / 8) : 1;
    const leagueFactor = historical.leagueCode === season.leagueCode ? 1 : 0.86;
    const projectionFactor = leagueProjectionFactor(historical.leagueCode, season.leagueCode, position);
    const availability = 0.55 + 0.45 * Math.min(1, membership.appearances / Math.max(1, historical.latestRound));
    const projected = membership.points / membership.appearances * season.roundCount * availability * projectionFactor;
    return [{ projected, weight: recency * sample * currentSeasonFactor * leagueFactor, appearances: membership.appearances, projectionFactor }];
  });
  const totalWeight = observations.reduce((sum, item) => sum + item.weight, 0);
  return {
    estimate: totalWeight > 0 ? observations.reduce((sum, item) => sum + item.projected * item.weight, 0) / totalWeight : null,
    seasons: observations.length,
    appearances: observations.reduce((sum, item) => sum + item.appearances, 0),
    promotionAdjusted: observations.some((item) => item.projectionFactor < 1) && observations.every((item) => item.projectionFactor < 1),
  };
}

function buildCandidates(catalog: Catalog, season: ManagerSeason, rules: ManagerRules): Candidate[] {
  const teams = new Map(season.teams.map((team) => [team.id, team]));
  const raw = season.players.filter((player) => player.selectable && player.priceM >= 0 && player.priceM < 999 && player.priceM <= rules.budgetM)
    .flatMap((player) => {
      const team = teams.get(player.teamId);
      if (!team) return [];
      return [{ player, team, history: candidateHistory(catalog, season, player.id, player.position) }];
    });
  const positionBaselines = new Map<Position, number>();
  const positionPrices = new Map<Position, number[]>();
  for (const position of positionOrder) {
    const positionPlayers = raw.filter((item) => item.player.position === position);
    positionBaselines.set(position, median(positionPlayers.flatMap((item) => item.history.estimate == null ? [] : [item.history.estimate])) || 85);
    positionPrices.set(position, positionPlayers.map((item) => item.player.priceM));
  }
  return raw.map(({ player, team, history }) => {
    const prior = pricePrior(player.priceM, positionPrices.get(player.position) ?? [], positionBaselines.get(player.position) ?? 85);
    const projectionWeight = history.estimate == null ? 0 : clamp(history.appearances / 55 + history.seasons * 0.09, 0.12, 0.88);
    const projectedPoints = Math.max(0, (history.estimate ?? prior) * projectionWeight + prior * (1 - projectionWeight));
    const confidence: ProjectionConfidence = !history.promotionAdjusted && history.appearances >= 45 && history.seasons >= 2
      ? "high"
      : history.appearances >= 15 || history.seasons >= 2
        ? "medium"
        : "low";
    return {
      id: player.id,
      name: player.name,
      teamId: team.id,
      team: team.name,
      teamCode: team.code,
      logoUrl: team.logoUrl,
      photoUrl: player.photoUrl,
      position: player.position,
      priceM: player.priceM,
      projectedPoints,
      confidence,
      seasonsUsed: history.seasons,
      appearancesUsed: history.appearances,
      promotionAdjusted: history.promotionAdjusted,
      projectionWeight,
    };
  });
}

export function managerCandidateProjections(catalog: Catalog, season: ManagerSeason, mode: ManagerMode) {
  const rules = managerRules(mode, season.leagueCode);
  return buildCandidates(catalog, season, rules).map((candidate) => ({
    id: candidate.id,
    projectedPoints: candidate.projectedPoints,
  }));
}

const emptyPlan = (): PlanOption => ({ spentCents: 0, score: 0, startingPoints: 0, path: null });

function comparePlan(left: PlanOption, right: PlanOption) {
  const scoreDifference = left.score - right.score;
  if (Math.abs(scoreDifference) > 1e-9) return scoreDifference;
  const starterDifference = left.startingPoints - right.startingPoints;
  if (Math.abs(starterDifference) > 1e-9) return starterDifference;
  return right.spentCents - left.spentCents;
}

function reserveScore(player: Candidate, rules: ManagerRules) {
  return player.projectedPoints * rules.reserveWeight * (0.7 + player.projectionWeight * 0.3);
}

function addPick(option: PlanOption, player: Candidate, role: SquadRole, rules: ManagerRules): PlanOption {
  const starterPoints = role === "start" ? player.projectedPoints : 0;
  const reservePoints = role === "reserve" ? reserveScore(player, rules) : 0;
  return {
    spentCents: option.spentCents + Math.round(player.priceM * 100),
    score: option.score + starterPoints + reservePoints,
    startingPoints: option.startingPoints + starterPoints,
    path: { pick: { player, role }, previous: option.path },
  };
}

function combinePlans(left: PlanOption, right: PlanOption): PlanOption {
  let path = left.path;
  const rightPicks: PlanPick[] = [];
  for (let node = right.path; node; node = node.previous) rightPicks.push(node.pick);
  for (let index = rightPicks.length - 1; index >= 0; index -= 1) path = { pick: rightPicks[index], previous: path };
  return {
    spentCents: left.spentCents + right.spentCents,
    score: left.score + right.score,
    startingPoints: left.startingPoints + right.startingPoints,
    path,
  };
}

function planPicks(path: PlanPath | null) {
  const picks: PlanPick[] = [];
  for (let node = path; node; node = node.previous) picks.push(node.pick);
  return picks.reverse();
}

function paretoFrontier(options: PlanOption[], budgetCents: number) {
  const bestAtCost = new Map<number, PlanOption>();
  for (const option of options) {
    if (option.spentCents > budgetCents) continue;
    const existing = bestAtCost.get(option.spentCents);
    if (!existing || comparePlan(option, existing) > 0) bestAtCost.set(option.spentCents, option);
  }
  const ordered = [...bestAtCost.values()].sort((left, right) => left.spentCents - right.spentCents || comparePlan(right, left));
  const frontier: PlanOption[] = [];
  let best: PlanOption | null = null;
  for (const option of ordered) {
    if (best && comparePlan(option, best) <= 0) continue;
    frontier.push(option);
    best = option;
  }
  return frontier;
}

function mergeFrontier(target: Map<number, PlanOption[]>, countCode: number, additions: PlanOption[], budgetCents: number) {
  target.set(countCode, paretoFrontier([...(target.get(countCode) ?? []), ...additions], budgetCents));
}

function optimizePosition(
  candidates: Candidate[],
  starterCount: number,
  reserveCount: number,
  rules: ManagerRules,
  budgetCents: number,
  trackedTeams: Map<string, number>,
  teamLimit: number,
) {
  const reserveBase = reserveCount + 1;
  const teamBase = teamLimit + 1;
  const teamStateCount = teamBase ** trackedTeams.size;
  let states = new Map<number, PlanOption[]>([[0, [emptyPlan()]]]);
  for (const player of candidates) {
    const next = new Map([...states].map(([code, options]) => [code, [...options]]));
    for (const [code, options] of states) {
      const roleCode = Math.floor(code / teamStateCount);
      const teamCode = code % teamStateCount;
      const starters = Math.floor(roleCode / reserveBase);
      const reserves = roleCode % reserveBase;
      const trackedTeam = trackedTeams.get(player.teamId);
      const teamMultiplier = trackedTeam == null ? 0 : teamBase ** trackedTeam;
      if (trackedTeam != null && Math.floor(teamCode / teamMultiplier) % teamBase >= teamLimit) continue;
      if (starters < starterCount && reserves === 0) {
        mergeFrontier(next, code + reserveBase * teamStateCount + teamMultiplier, options.map((option) => addPick(option, player, "start", rules)), budgetCents);
      }
      if (starters === starterCount && reserves < reserveCount) {
        mergeFrontier(next, code + teamStateCount + teamMultiplier, options.map((option) => addPick(option, player, "reserve", rules)), budgetCents);
      }
    }
    states = next;
  }
  const targetRoleCode = starterCount * reserveBase + reserveCount;
  const result = new Map<number, PlanOption[]>();
  for (const [code, options] of states) {
    if (Math.floor(code / teamStateCount) !== targetRoleCode) continue;
    result.set(code % teamStateCount, options);
  }
  return result;
}

function teamCodesFit(left: number, right: number, trackedTeamCount: number, teamLimit: number) {
  const base = teamLimit + 1;
  for (let index = 0; index < trackedTeamCount; index += 1) {
    const multiplier = base ** index;
    if (Math.floor(left / multiplier) % base + Math.floor(right / multiplier) % base > teamLimit) return false;
  }
  return true;
}

function optimizeTrackedTeams(
  candidates: Candidate[],
  rules: ManagerRules,
  formation: Formation,
  budgetCents: number,
  trackedTeamIds: string[],
) {
  const teamLimit = rules.maxFromTeam ?? Object.values(rules.positions).reduce((sum, count) => sum + count, 0);
  const trackedTeams = new Map(trackedTeamIds.map((teamId, index) => [teamId, index]));
  let combined = new Map<number, PlanOption[]>([[0, [emptyPlan()]]]);
  for (const position of positionOrder) {
    const pool = candidates.filter((player) => player.position === position)
      .sort((left, right) => right.projectedPoints - left.projectedPoints || reserveScore(left, rules) - reserveScore(right, rules));
    const reserveCount = rules.positions[position] - formation[position];
    const positionPlans = optimizePosition(pool, formation[position], reserveCount, rules, budgetCents, trackedTeams, teamLimit);
    const next = new Map<number, PlanOption[]>();
    for (const [currentTeamCode, currentPlans] of combined) {
      for (const [positionTeamCode, plans] of positionPlans) {
        if (!teamCodesFit(currentTeamCode, positionTeamCode, trackedTeams.size, teamLimit)) continue;
        const additions: PlanOption[] = [];
        for (const current of currentPlans) {
          for (const positionPlan of plans) {
            if (current.spentCents + positionPlan.spentCents > budgetCents) break;
            additions.push(combinePlans(current, positionPlan));
          }
        }
        if (additions.length) mergeFrontier(next, currentTeamCode + positionTeamCode, additions, budgetCents);
      }
    }
    combined = next;
  }
  return [...combined.values()].flat().reduce<PlanOption | null>((best, option) => !best || comparePlan(option, best) > 0 ? option : best, null);
}

function optimizeFormation(candidates: Candidate[], rules: ManagerRules, formation: Formation, budgetCents: number) {
  const trackedTeamIds: string[] = [];
  while (true) {
    const option = optimizeTrackedTeams(candidates, rules, formation, budgetCents, trackedTeamIds);
    if (!option || rules.maxFromTeam == null) return option;
    const teamCounts = new Map<string, number>();
    for (const pick of planPicks(option.path)) teamCounts.set(pick.player.teamId, (teamCounts.get(pick.player.teamId) ?? 0) + 1);
    const newViolations = [...teamCounts]
      .filter(([teamId, count]) => count > rules.maxFromTeam! && !trackedTeamIds.includes(teamId))
      .map(([teamId]) => teamId);
    if (!newViolations.length) return option;
    trackedTeamIds.push(...newViolations);
  }
}

function optimizeRoster(candidates: Candidate[], rules: ManagerRules): OptimizedRoster {
  const budgetCents = Math.round(rules.budgetM * 100);
  for (const position of positionOrder) {
    if (candidates.filter((player) => player.position === position).length < rules.positions[position]) {
      throw new Error(`Nicht genug verfügbare Spieler für ${position}.`);
    }
  }
  let best: OptimizedRoster | null = null;
  for (const formation of rules.formations) {
    const option = optimizeFormation(candidates, rules, formation, budgetCents);
    if (!option) continue;
    const optimized = { ...option, formation, picks: planPicks(option.path) };
    if (!best || comparePlan(optimized, best) > 0) best = optimized;
  }
  if (!best) throw new Error("Mit den verfügbaren Marktwerten lässt sich kein gültiger Kader bilden.");
  return best;
}

function formationLabel(formation: Formation) {
  return `${formation.DEF}-${formation.MID}-${formation.FWD}`;
}

export function recommendManagerSquad(catalog: Catalog, season: ManagerSeason, mode: ManagerMode): ManagerRecommendation {
  const rules = managerRules(mode, season.leagueCode);
  const candidates = buildCandidates(catalog, season, rules);
  const state = optimizeRoster(candidates, rules);
  const matchRounds = new Map(season.matches.map((match) => [match.id, match.round]));
  const pointsByRoundAndPlayer = new Map<string, number>();
  const currentPointsByPlayer = new Map<string, number>();
  for (const score of season.scores) {
    const round = matchRounds.get(score.matchId);
    if (round == null || round < 1 || round > season.latestRound) continue;
    const key = `${round}:${score.playerId}`;
    pointsByRoundAndPlayer.set(key, (pointsByRoundAndPlayer.get(key) ?? 0) + score.totalPoints);
    currentPointsByPlayer.set(score.playerId, (currentPointsByPlayer.get(score.playerId) ?? 0) + score.totalPoints);
  }
  const players = state.picks.map(({ player, role }): ManagerPickPlayer => ({
    id: player.id,
    name: player.name,
    teamId: player.teamId,
    team: player.team,
    teamCode: player.teamCode,
    logoUrl: player.logoUrl,
    photoUrl: player.photoUrl,
    position: player.position,
    priceM: player.priceM,
    projectedPoints: Math.round(player.projectedPoints),
    currentPoints: currentPointsByPlayer.get(player.id) ?? 0,
    confidence: player.confidence,
    seasonsUsed: player.seasonsUsed,
    appearancesUsed: player.appearancesUsed,
    promotionAdjusted: player.promotionAdjusted,
    role,
  })).sort((left, right) => positionOrder.indexOf(left.position) - positionOrder.indexOf(right.position)
    || Number(right.role === "start") - Number(left.role === "start")
    || right.projectedPoints - left.projectedPoints);
  const starters = players.filter((player) => player.role === "start");
  const matchdays = Array.from({ length: season.latestRound }, (_, index) => {
    const matchday = index + 1;
    const matchdayPlayers = starters.map((player) => ({
      id: player.id,
      name: player.name,
      team: player.team,
      teamCode: player.teamCode,
      logoUrl: player.logoUrl,
      photoUrl: player.photoUrl,
      position: player.position,
      points: pointsByRoundAndPlayer.get(`${matchday}:${player.id}`) ?? 0,
    })).sort((left, right) => positionOrder.indexOf(left.position) - positionOrder.indexOf(right.position)
      || right.points - left.points
      || left.name.localeCompare(right.name, "de"));
    const positionPoints = Object.fromEntries(positionOrder.map((position) => [
      position,
      matchdayPlayers.filter((player) => player.position === position).reduce((sum, player) => sum + player.points, 0),
    ])) as Record<Position, number>;
    return {
      matchday,
      totalPoints: matchdayPlayers.reduce((sum, player) => sum + player.points, 0),
      positionPoints,
      players: matchdayPlayers,
    };
  });
  const spentM = state.spentCents / 100;
  return {
    league: season.leagueCode,
    leagueName: season.leagueName,
    season: season.displayName,
    mode,
    budgetM: rules.budgetM,
    spentM,
    remainingM: Math.round((rules.budgetM - spentM) * 100) / 100,
    formation: formationLabel(state.formation),
    projectedStartingPoints: Math.round(state.startingPoints),
    currentStartingPoints: matchdays.reduce((sum, matchday) => sum + matchday.totalPoints, 0),
    matchdays,
    generatedAt: season.generatedAt,
    rules: {
      squadSize: Object.values(rules.positions).reduce((sum, count) => sum + count, 0),
      positions: rules.positions,
      maxFromTeam: rules.maxFromTeam,
    },
    players,
  };
}
