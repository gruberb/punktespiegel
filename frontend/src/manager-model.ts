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
type BeamState = { selected: Candidate[]; spentCents: number; teamCounts: Map<string, number>; lastCandidateIndex: number; score: number };

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

function shortlist(candidates: Candidate[], count: number) {
  const unique = new Map<string, Candidate>();
  const take = (items: Candidate[], limit: number) => items.slice(0, Math.max(limit, count + 4)).forEach((player) => unique.set(player.id, player));
  take([...candidates].sort((left, right) => right.projectedPoints - left.projectedPoints), 18);
  take([...candidates].sort((left, right) => right.projectedPoints / Math.max(0.05, right.priceM) - left.projectedPoints / Math.max(0.05, left.priceM)), 14);
  take([...candidates].sort((left, right) => left.priceM - right.priceM || right.projectedPoints - left.projectedPoints), 10);
  take([...candidates].sort((left, right) => right.appearancesUsed - left.appearancesUsed || right.projectedPoints - left.projectedPoints), 8);
  return [...unique.values()].sort((left, right) => right.projectedPoints - left.projectedPoints || left.priceM - right.priceM);
}

function formationSelection(players: Candidate[], formationsToCheck: Formation[]) {
  let best: { formation: Formation; starters: Candidate[]; points: number } | null = null;
  for (const formation of formationsToCheck) {
    const starters = positionOrder.flatMap((position) => players.filter((player) => player.position === position)
      .sort((left, right) => right.projectedPoints - left.projectedPoints)
      .slice(0, formation[position]));
    const expectedCount = Object.values(formation).reduce((sum, count) => sum + count, 0);
    if (starters.length !== expectedCount) continue;
    const points = starters.reduce((sum, player) => sum + player.projectedPoints, 0);
    if (!best || points > best.points) best = { formation, starters, points };
  }
  return best;
}

function rosterObjective(players: Candidate[], rules: ManagerRules) {
  const selection = formationSelection(players, rules.formations);
  if (!selection) {
    return positionOrder.reduce((total, position) => {
      const ordered = players.filter((player) => player.position === position).sort((left, right) => right.projectedPoints - left.projectedPoints);
      const formationCounts = rules.formations.map((formation) => formation[position]).sort((left, right) => left - right);
      const likelyStarterCount = formationCounts[Math.floor(formationCounts.length / 2)] ?? 0;
      return total + ordered.reduce((sum, player, index) => sum + player.projectedPoints * (index < likelyStarterCount ? 1 : rules.reserveWeight), 0);
    }, 0);
  }
  const starterIds = new Set(selection?.starters.map((player) => player.id) ?? []);
  const starterPoints = selection.points;
  const reservePoints = players.filter((player) => !starterIds.has(player.id))
    .reduce((sum, player) => sum + player.projectedPoints * rules.reserveWeight * (0.7 + player.projectionWeight * 0.3), 0);
  return starterPoints + reservePoints;
}

function trimBeam(states: BeamState[], width = 1400) {
  states.sort((left, right) => right.score - left.score || left.spentCents - right.spentCents);
  const perCost = new Map<number, number>();
  const result: BeamState[] = [];
  for (const state of states) {
    const bucket = Math.round(state.spentCents / 10);
    const seen = perCost.get(bucket) ?? 0;
    if (seen >= 3) continue;
    perCost.set(bucket, seen + 1);
    result.push(state);
    if (result.length >= width) break;
  }
  return result;
}

function optimizeRoster(candidates: Candidate[], rules: ManagerRules) {
  const budgetCents = Math.round(rules.budgetM * 100);
  const pools = new Map(positionOrder.map((position) => [position, shortlist(candidates.filter((player) => player.position === position), rules.positions[position])]));
  for (const position of positionOrder) {
    if ((pools.get(position)?.length ?? 0) < rules.positions[position]) throw new Error(`Nicht genug verfügbare Spieler für ${position}.`);
  }
  const minimumRemainingCost = (positionIndex: number, selectedInPosition: number, lastCandidateIndex: number) => positionOrder.slice(positionIndex)
    .reduce((total, position, offset) => {
      const needed = rules.positions[position] - (offset === 0 ? selectedInPosition : 0);
      const available = offset === 0 ? (pools.get(position) ?? []).slice(lastCandidateIndex + 1) : (pools.get(position) ?? []);
      const cheapest = [...available].sort((left, right) => left.priceM - right.priceM).slice(0, needed);
      if (cheapest.length < needed) return Number.POSITIVE_INFINITY;
      return total + cheapest.reduce((sum, player) => sum + Math.round(player.priceM * 100), 0);
    }, 0);
  let states: BeamState[] = [{ selected: [], spentCents: 0, teamCounts: new Map(), lastCandidateIndex: -1, score: 0 }];
  for (const [positionIndex, position] of positionOrder.entries()) {
    const pool = pools.get(position) ?? [];
    states = states.map((state) => ({ ...state, lastCandidateIndex: -1 }));
    for (let slot = 0; slot < rules.positions[position]; slot += 1) {
      const expanded: BeamState[] = [];
      for (const state of states) {
        for (let index = state.lastCandidateIndex + 1; index < pool.length; index += 1) {
          const player = pool[index];
          const playerCost = Math.round(player.priceM * 100);
          if (state.spentCents + playerCost + minimumRemainingCost(positionIndex, slot + 1, index) > budgetCents) continue;
          const teamCount = state.teamCounts.get(player.teamId) ?? 0;
          if (rules.maxFromTeam != null && teamCount >= rules.maxFromTeam) continue;
          const teamCounts = new Map(state.teamCounts);
          teamCounts.set(player.teamId, teamCount + 1);
          const selected = [...state.selected, player];
          expanded.push({
            selected,
            spentCents: state.spentCents + playerCost,
            teamCounts,
            lastCandidateIndex: index,
            score: rosterObjective(selected, rules),
          });
        }
      }
      states = trimBeam(expanded);
      if (!states.length) throw new Error("Mit den verfügbaren Marktwerten lässt sich kein gültiger Kader bilden.");
    }
  }
  return states.sort((left, right) => right.score - left.score)[0];
}

function formationLabel(formation: Formation) {
  return `${formation.DEF}-${formation.MID}-${formation.FWD}`;
}

export function recommendManagerSquad(catalog: Catalog, season: ManagerSeason, mode: ManagerMode): ManagerRecommendation {
  const rules = managerRules(mode, season.leagueCode);
  const candidates = buildCandidates(catalog, season, rules);
  const state = optimizeRoster(candidates, rules);
  const selection = formationSelection(state.selected, rules.formations);
  if (!selection) throw new Error("Für den empfohlenen Kader konnte keine gültige Startelf gebildet werden.");
  const starterIds = new Set(selection.starters.map((player) => player.id));
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
  const players = state.selected.map((player): ManagerPickPlayer => ({
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
    role: starterIds.has(player.id) ? "start" : "reserve",
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
    formation: formationLabel(selection.formation),
    projectedStartingPoints: Math.round(selection.points),
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
