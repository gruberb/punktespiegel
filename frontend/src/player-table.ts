import type { Catalog, Player, PlayerHistory, PlayerTableRow, Position } from "./types";

const positionOrder: Record<Position, number> = { GK: 0, DEF: 1, MID: 2, FWD: 3 };

export function comparePlayerPositions(left: Position, right: Position, direction: "asc" | "desc") {
  const difference = positionOrder[left] - positionOrder[right];
  return direction === "asc" ? difference : -difference;
}

export function previousSeasonPointsByPlayer(catalog: Pick<Catalog, "seasons">, startYear: number) {
  const previousSeasons = catalog.seasons.filter((season) => season.startYear === startYear - 1);
  const points = new Map<string, number>();
  for (const season of previousSeasons) {
    for (const player of season.players) points.set(player.id, (points.get(player.id) ?? 0) + player.points);
  }
  return { available: previousSeasons.length > 0, points };
}

export function shortSeasonLabel(displayName: string) {
  const [start, end] = displayName.split("/");
  return end ? `${start.slice(-2)}/${end.slice(-2)}` : displayName;
}

export function analyzePlayerHistory(catalog: Catalog, player: Pick<Player, "id" | "priceM">, leagueCode: string, startYear: number): PlayerHistory {
  const leagueName = catalog.leagues.find((league) => league.code === leagueCode)?.name ?? leagueCode;
  const candidates = catalog.seasons.flatMap((season) => {
    if (season.startYear >= startYear || season.dataState !== "complete") return [];
    const membership = season.players.find((entry) => entry.id === player.id);
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
  const history = [...byYear.values()];
  const leagueHistory = history.filter((season) => season.leagueCode === leagueCode);
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
  } else if (priorSeason.leagueCode !== leagueCode) {
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
    averagePoints,
    value: averagePoints != null && player.priceM > 0 && player.priceM < 999 ? averagePoints / player.priceM : null,
    trendDelta,
    signal,
    history: history.slice(-5).map((season) => ({ season: season.season, league: season.league, points: season.points })),
  };
}

export type PlayerSort = "name" | "position" | "price" | "points" | "previousPoints" | "grade" | "goals" | "assists" | "value" | "average" | "historicalValue" | "trend";

export function defaultPlayerSort(hasSeasonPoints: boolean): PlayerSort {
  return hasSeasonPoints ? "points" : "previousPoints";
}

function compareNullable(left: number | null, right: number | null, direction: "asc" | "desc") {
  if (left == null && right == null) return 0;
  if (left == null) return 1;
  if (right == null) return -1;
  return direction === "asc" ? left - right : right - left;
}

export function sortPlayers(players: PlayerTableRow[], sort: PlayerSort, direction: "asc" | "desc") {
  const text = (left: string, right: string) => direction === "asc" ? left.localeCompare(right, "de") : right.localeCompare(left, "de");
  return [...players].sort((left, right) => {
    if (sort === "name") return text(left.name, right.name);
    if (sort === "position") return comparePlayerPositions(left.position, right.position, direction) || left.name.localeCompare(right.name, "de");
    const value = (player: PlayerTableRow): number | null => {
      if (sort === "price") return player.priceM;
      if (sort === "previousPoints") return player.previousSeasonPoints;
      if (sort === "grade") return player.averageGrade;
      if (sort === "goals") return player.goals;
      if (sort === "assists") return player.assists;
      if (sort === "value") return player.value;
      if (sort === "average") return player.analysis.averagePoints;
      if (sort === "historicalValue") return player.analysis.value;
      if (sort === "trend") return player.analysis.trendDelta;
      return player.observedPoints;
    };
    return compareNullable(value(left), value(right), direction) || left.name.localeCompare(right.name, "de");
  });
}
