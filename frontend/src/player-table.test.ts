import assert from "node:assert/strict";
import test from "node:test";
import { analyzePlayerHistory, comparePlayerPositions, defaultPlayerSort, previousSeasonPointsByPlayer, shortSeasonLabel, sortPlayers } from "./player-table.ts";
import type { PlayerTableRow } from "./types";

const season = (startYear: number, players: { id: string; points: number }[]) => ({
  id: String(startYear),
  leagueCode: "0001",
  startYear,
  displayName: `${startYear}/${String(startYear + 1).slice(-2)}`,
  roundCount: 34,
  latestRound: 34,
  dataState: "complete",
  teamIds: [],
  players: players.map((player) => ({ ...player, active: true, appearances: 1 })),
});

test("sorts positions in football order", () => {
  const positions = ["FWD", "MID", "GK", "DEF"] as const;
  assert.deepEqual([...positions].sort((left, right) => comparePlayerPositions(left, right, "asc")), ["GK", "DEF", "MID", "FWD"]);
});

test("collects points from the immediately preceding archived season", () => {
  const result = previousSeasonPointsByPlayer({ seasons: [
    season(2024, [{ id: "one", points: 20 }]),
    season(2025, [{ id: "one", points: 100 }, { id: "two", points: 40 }]),
    { ...season(2025, [{ id: "one", points: 15 }]), id: "2025-other", leagueCode: "0002" },
  ] }, 2026);
  assert.equal(result.available, true);
  assert.equal(result.points.get("one"), 115);
  assert.equal(result.points.get("two"), 40);
});

test("reports no previous-season column for the first archived year", () => {
  const result = previousSeasonPointsByPlayer({ seasons: [season(2022, [])] }, 2022);
  assert.equal(result.available, false);
  assert.equal(result.points.size, 0);
});

test("uses a compact season label in table headings", () => {
  assert.equal(shortSeasonLabel("2025/26"), "25/26");
});

test("history uses completed prior seasons and keeps players without history", () => {
  const catalog = {
    leagues: [{ code: "0001", name: "Bundesliga" }],
    seasons: [
      season(2023, [{ id: "one", points: 40 }]),
      season(2024, [{ id: "one", points: 80 }]),
      season(2025, [{ id: "one", points: 120 }]),
      { ...season(2025, [{ id: "one", points: 10 }]), leagueCode: "0002", players: [{ id: "one", points: 10, appearances: 2, active: false }] },
      season(2026, [{ id: "one", points: 999 }]),
    ],
  };
  const analysis = analyzePlayerHistory(catalog, { id: "one", priceM: 2 }, "0001", 2026);
  assert.equal(analysis.averagePoints, 80);
  assert.equal(analysis.value, 40);
  assert.equal(analysis.trendDelta, 40);
  assert.match(analysis.signal, /3 Saisons in Folge verbessert/);
  assert.deepEqual(analysis.history.map((entry) => entry.points), [40, 80, 120]);
  const newcomer = analyzePlayerHistory(catalog, { id: "new", priceM: 2 }, "0001", 2026);
  assert.equal(newcomer.averagePoints, null);
  assert.deepEqual(newcomer.history, []);
});

test("both column modes use season points after kickoff, with distinct value metrics and missing history last", () => {
  const rows = [
    { name: "A", observedPoints: -2, previousSeasonPoints: 80, value: 1, analysis: { averagePoints: 80, value: 40 } },
    { name: "B", observedPoints: 10, previousSeasonPoints: 40, value: 5, analysis: { averagePoints: 40, value: 20 } },
    { name: "C", observedPoints: 0, previousSeasonPoints: null, value: 0, analysis: { averagePoints: null, value: null } },
  ] as PlayerTableRow[];
  const names = (sorted: PlayerTableRow[]) => sorted.map((player) => player.name);
  assert.deepEqual(names(sortPlayers(rows, defaultPlayerSort(true), "desc")), ["B", "C", "A"]);
  assert.deepEqual(names(sortPlayers(rows, defaultPlayerSort(false), "desc")), ["A", "B", "C"]);
  assert.deepEqual(names(sortPlayers(rows, "value", "desc")), ["B", "A", "C"]);
  assert.deepEqual(names(sortPlayers(rows, "historicalValue", "desc")), ["A", "B", "C"]);
  assert.deepEqual(names(sortPlayers(rows, "average", "asc")), ["B", "A", "C"]);
  assert.deepEqual(names(rows), ["A", "B", "C"]);
});
