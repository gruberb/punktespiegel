import assert from "node:assert/strict";
import test from "node:test";
import { comparePlayerPositions, previousSeasonPointsByPlayer, shortSeasonLabel } from "./player-table.ts";

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
