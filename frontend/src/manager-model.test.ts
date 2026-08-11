import assert from "node:assert/strict";
import test from "node:test";
import { leagueProjectionFactor, recommendManagerSquad } from "./manager-model.ts";
import type { Catalog, Position } from "./types.ts";

const positions: Position[] = ["GK", "DEF", "MID", "FWD"];
const teams = Array.from({ length: 10 }, (_, index) => ({ id: `team-${index}`, name: `Team ${index}`, code: `T${index}`, logoUrl: null }));
const players = positions.flatMap((position, positionIndex) => Array.from({ length: 12 }, (_, index) => ({
  id: `${position}-${index}`,
  name: `${position} Player ${index}`,
  teamId: teams[(index + positionIndex) % teams.length].id,
  position,
  priceM: 0.15 + index * 0.03,
  active: true,
  selectable: true,
  photoUrl: null,
})));
const historicalPlayers = players.map((player, index) => ({ id: player.id, active: true, appearances: 28 + index % 7, points: 80 + index * 3 }));
const catalog: Catalog = {
  leagues: [{ code: "0002", name: "2. Bundesliga" }],
  seasons: [2022, 2023, 2024, 2025, 2026].map((startYear) => ({
    id: `se-k0002${startYear}`,
    leagueCode: "0002",
    startYear,
    displayName: `${startYear}/${String(startYear + 1).slice(-2)}`,
    roundCount: 34,
    latestRound: startYear === 2026 ? 1 : 34,
    dataState: startYear === 2026 ? "current" : "complete",
    teamIds: teams.map((team) => team.id),
    players: historicalPlayers,
  })),
};
const season = {
  generatedAt: "2026-08-11T12:00:00Z",
  leagueCode: "0002",
  leagueName: "2. Bundesliga",
  startYear: 2026,
  displayName: "2026/27",
  roundCount: 34,
  latestRound: 1,
  teams,
  matches: [],
  scores: [],
  players,
};

test("classic recommendation respects budget, position counts and club limit", () => {
  const result = recommendManagerSquad(catalog, season, "classic");
  assert.equal(result.players.length, 15);
  assert.ok(result.spentM <= 7.5);
  assert.equal(result.players.filter((player) => player.role === "start").length, 11);
  for (const position of positions) {
    assert.equal(result.players.filter((player) => player.position === position).length, result.rules.positions[position]);
  }
  const teamCounts = new Map<string, number>();
  result.players.forEach((player) => teamCounts.set(player.teamId, (teamCounts.get(player.teamId) ?? 0) + 1));
  assert.ok([...teamCounts.values()].every((count) => count <= 3));
  assert.equal(result.currentStartingPoints, 0);
  assert.equal(result.matchdays.length, 1);
  assert.equal(result.matchdays[0].totalPoints, 0);
  assert.deepEqual(result.matchdays[0].positionPoints, { GK: 0, DEF: 0, MID: 0, FWD: 0 });
  assert.equal(result.matchdays[0].players.length, 11);
  assert.ok(result.players.every((player) => player.currentPoints === 0));
});

test("interactive recommendation produces a valid 22-player squad and formation", () => {
  const result = recommendManagerSquad(catalog, season, "interactive");
  assert.equal(result.players.length, 22);
  assert.ok(result.spentM <= 10);
  assert.equal(result.players.filter((player) => player.role === "start").length, 11);
  assert.match(result.formation, /^[345]-[345]-[123]$/);
});

test("discounts historical points when a player moves into a higher league", () => {
  assert.equal(leagueProjectionFactor("0001", "0001", "MID"), 1);
  assert.equal(leagueProjectionFactor("0002", "0001", "MID"), 0.53);
  assert.equal(leagueProjectionFactor("0003", "0002", "FWD"), 0.73);
  assert.ok(leagueProjectionFactor("0003", "0001", "DEF") < leagueProjectionFactor("0002", "0001", "DEF"));
  assert.equal(leagueProjectionFactor("0001", "0002", "MID"), 1);
});

test("tracks actual points for the recommended starting eleven by matchday", () => {
  const trackedSeason = {
    ...season,
    latestRound: 2,
    matches: [{ id: "match-1", round: 1 }, { id: "match-2", round: 2 }],
    scores: players.flatMap((player) => [
      { matchId: "match-1", playerId: player.id, totalPoints: 2 },
      { matchId: "match-2", playerId: player.id, totalPoints: 3 },
    ]),
  };
  const result = recommendManagerSquad(catalog, trackedSeason, "classic");
  assert.equal(result.matchdays.length, 2);
  assert.equal(result.matchdays[0].totalPoints, 22);
  assert.equal(result.matchdays[1].totalPoints, 33);
  assert.equal(result.matchdays[0].players.length, 11);
  assert.equal(result.currentStartingPoints, 55);
  assert.ok(result.players.every((player) => player.currentPoints === 5));
});
