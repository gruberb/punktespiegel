import assert from "node:assert/strict";
import test from "node:test";
import { computeTable, crossTable, formLastN, formPoints, positionsByRound, trendVsRound } from "./standings.ts";
import type { StandingsMatch } from "./standings.ts";

const teamIds = ["a", "b", "c", "d"];
const names: Record<string, string> = { a: "Aue", b: "Bochum", c: "Chemnitz", d: "Dresden" };
const teamName = (teamId: string) => names[teamId];

function match(round: number, home: string, away: string, homeScore: number | null, awayScore: number | null): StandingsMatch {
  return { round, homeTeamId: home, awayTeamId: away, scheduledAt: `2025-0${round}-01T15:30:00+00:00`, homeScore, awayScore };
}

const matches: StandingsMatch[] = [
  match(1, "a", "b", 2, 0),
  match(1, "c", "d", 1, 1),
  match(2, "b", "c", 0, 1),
  match(2, "d", "a", null, null),
  match(3, "a", "c", 0, 3),
  match(3, "b", "d", 2, 1),
];

test("accumulates wins, draws, losses and points from played matches only", () => {
  const table = computeTable(matches, teamIds, 3, teamName);
  const rowFor = (teamId: string) => table.find((row) => row.teamId === teamId)!;
  assert.deepEqual(
    { played: rowFor("a").played, points: rowFor("a").points, wins: rowFor("a").wins, losses: rowFor("a").losses },
    { played: 2, points: 3, wins: 1, losses: 1 },
  );
  assert.equal(rowFor("d").played, 2);
  assert.equal(rowFor("c").points, 7);
});

test("ranks by points, then goal difference, then goals scored, then name", () => {
  const table = computeTable(matches, teamIds, 3, teamName);
  assert.deepEqual(table.map((row) => row.teamId), ["c", "a", "b", "d"]);
  const tieBreak = computeTable([
    match(1, "a", "b", 2, 2),
    match(2, "c", "d", 1, 1),
  ], teamIds, 2, teamName);
  assert.deepEqual(tieBreak.map((row) => row.teamId), ["a", "b", "c", "d"]);
});

test("goal difference beats goals scored only when points are level", () => {
  const table = computeTable([
    match(1, "a", "c", 4, 3),
    match(1, "b", "d", 2, 0),
  ], teamIds, 1, teamName);
  assert.deepEqual(table.map((row) => row.teamId), ["b", "a", "c", "d"]);
});

test("positions by round track the table after every matchday", () => {
  const positions = positionsByRound(matches, teamIds, 3, teamName);
  assert.deepEqual(positions.get("a"), [1, 2, 2]);
  assert.deepEqual(positions.get("c"), [2, 1, 1]);
  assert.equal(positions.get("d")!.length, 3);
});

test("form window returns the last played matches with outcomes", () => {
  const form = formLastN(matches, "a", 3, 5);
  assert.deepEqual(form.map((result) => result.outcome), ["S", "N"]);
  assert.deepEqual(form.map((result) => result.round), [1, 3]);
  assert.equal(formPoints(form), 3);
  assert.equal(formLastN(matches, "a", 3, 1).length, 1);
});

test("trend compares the rank five rounds earlier and clamps at the season start", () => {
  const positions = [10, 8, 7, 5, 4, 3, 2];
  assert.equal(trendVsRound(positions, 7), 6);
  assert.equal(trendVsRound(positions, 2), 2);
  assert.equal(trendVsRound(positions, 1), null);
});

test("cross table reveals played pairings up to the cutoff and keeps later ones scheduled", () => {
  const cells = crossTable(matches, 2);
  assert.deepEqual(cells.get("a|b"), { round: 1, scheduledAt: "2025-01-01T15:30:00+00:00", homeScore: 2, awayScore: 0 });
  assert.equal(cells.get("d|a")!.homeScore, null);
  assert.equal(cells.get("a|c")!.homeScore, null);
  assert.equal(cells.get("a|c")!.round, 3);
});
