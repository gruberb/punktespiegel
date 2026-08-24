import assert from "node:assert/strict";
import test from "node:test";
import { initialAvailableRound, latestAvailableRound, latestImportedRound, latestPlayedSeason } from "./rounds.ts";

test("selects the latest round that has imported data", () => {
  assert.equal(latestAvailableRound({ roundCount: 34, latestRound: 3 }), 3);
  assert.equal(latestAvailableRound({ roundCount: 34, latestRound: 34 }), 34);
});

test("falls back to round one before the first score import", () => {
  assert.equal(latestAvailableRound({ roundCount: 34, latestRound: 0 }), 1);
});

test("keeps an empty season at round zero for season-wide statistics", () => {
  assert.equal(latestImportedRound({ roundCount: 34, latestRound: 0 }), 0);
  assert.equal(latestImportedRound({ roundCount: 34, latestRound: 3 }), 3);
  assert.equal(latestImportedRound({ roundCount: 34, latestRound: 99 }), 34);
});

test("keeps a valid deep-linked round and replaces unavailable rounds", () => {
  const season = { roundCount: 34, latestRound: 3 };
  assert.equal(initialAvailableRound(season, 2), 2);
  assert.equal(initialAvailableRound(season, null), 3);
  assert.equal(initialAvailableRound(season, 34), 3);
});

test("uses the current season when it already has a played matchday", () => {
  const seasons = [
    { startYear: 2025, roundCount: 34, latestRound: 34 },
    { startYear: 2026, roundCount: 34, latestRound: 2 },
  ];

  assert.equal(latestPlayedSeason(seasons)?.startYear, 2026);
  assert.equal(latestAvailableRound(latestPlayedSeason(seasons)!), 2);
});

test("falls back to the previous season when the current season has not started", () => {
  const seasons = [
    { startYear: 2026, roundCount: 34, latestRound: 0 },
    { startYear: 2025, roundCount: 34, latestRound: 34 },
  ];

  assert.equal(latestPlayedSeason(seasons)?.startYear, 2025);
  assert.equal(latestAvailableRound(latestPlayedSeason(seasons)!), 34);
});

test("falls back to the newest season when no season has a played matchday", () => {
  const seasons = [
    { startYear: 2025, roundCount: 34, latestRound: 0 },
    { startYear: 2026, roundCount: 34, latestRound: 0 },
  ];

  assert.equal(latestPlayedSeason(seasons)?.startYear, 2026);
  assert.equal(latestAvailableRound(latestPlayedSeason(seasons)!), 1);
});
