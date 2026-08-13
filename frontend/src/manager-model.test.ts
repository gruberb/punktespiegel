import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { leagueProjectionFactor, recommendManagerSquad } from "./manager-model.ts";
import type { ManagerSeason } from "./manager-model.ts";
import type { Catalog, ManagerMode, ManagerRecommendation, Position } from "./types.ts";

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

const publishedCatalog = JSON.parse(readFileSync(new URL("../public/data/catalog.json", import.meta.url), "utf8")) as Catalog;
for (const league of ["0001", "0002", "0003"]) {
  for (const mode of ["classic", "interactive"] as ManagerMode[]) {
    test(`published ${league} ${mode} recommendation is valid and stable`, () => {
      const artifact = JSON.parse(readFileSync(new URL(`../public/data/recommendations/se-k${league}2026-${mode}.json`, import.meta.url), "utf8")) as {
        schemaVersion: number;
        modelVersion: number;
        source: { seasonId: string };
        recommendation: unknown;
      };
      assert.equal(artifact.source.seasonId, `se-k${league}2026`);
      assert.equal(artifact.schemaVersion, 2);
      assert.equal(artifact.modelVersion, 2);
      const published = artifact.recommendation as ManagerRecommendation;
      assert.equal(new Set(published.players.map((player) => player.id)).size, published.players.length);
      assert.equal(published.players.length, published.rules.squadSize);
      assert.equal(published.players.filter((player) => player.role === "start").length, 11);
      assert.ok(published.spentM <= published.budgetM);
      for (const position of positions) {
        assert.equal(published.players.filter((player) => player.position === position).length, published.rules.positions[position]);
      }
      if (published.rules.maxFromTeam != null) {
        const teamCounts = new Map<string, number>();
        published.players.forEach((player) => teamCounts.set(player.teamId, (teamCounts.get(player.teamId) ?? 0) + 1));
        assert.ok([...teamCounts.values()].every((count) => count <= published.rules.maxFromTeam!));
      }
      const starters = published.players.filter((player) => player.role === "start");
      assert.ok(starters.every((player) => (player.pStart ?? 0) + (player.pSub ?? 0) >= (player.position === "GK" ? 0.5 : 0.18)));
      for (const matchday of published.projectedMatchdays ?? []) {
        assert.ok(matchday.players.every((player) => player.meanPoints <= (player.pStart + player.pSub) * 25 + 0.051));
      }
    });
  }
}

test("published Bundesliga recommendations do not start the externally identified backup goalkeeper", () => {
  const roleSignals = JSON.parse(readFileSync(new URL("../public/data/current-role-signals.json", import.meta.url), "utf8")) as {
    players: Record<string, { role: string }>;
  };
  assert.equal(roleSignals.players["pl-k00051437"]?.role, "starter");
  assert.equal(roleSignals.players["pl-k00064802"]?.role, "squad");
  for (const mode of ["classic", "interactive"] as ManagerMode[]) {
    const artifact = JSON.parse(readFileSync(new URL(`../public/data/recommendations/se-k00012026-${mode}.json`, import.meta.url), "utf8")) as {
      recommendation: ManagerRecommendation;
    };
    assert.notEqual(artifact.recommendation.players.find((player) => player.id === "pl-k00064802")?.role, "start");
  }
});

for (const league of ["0001", "0002", "0003"]) {
  test(`published ${league} Classic-v2 recommendation has exact roster roles and winter constraints`, () => {
    const artifact = JSON.parse(readFileSync(new URL(`../public/data/recommendations/se-k${league}2026-classic.json`, import.meta.url), "utf8")) as {
      schemaVersion: number;
      modelVersion: number;
      recommendation: ManagerRecommendation;
    };
    const recommendation = artifact.recommendation;
    assert.equal(artifact.schemaVersion, 2);
    assert.equal(artifact.modelVersion, 2);
    assert.equal(recommendation.modelVersion, 2);
    assert.equal(recommendation.players.length, 15);
    assert.equal(recommendation.players.filter((player) => player.role === "start").length, 11);
    assert.equal(recommendation.players.filter((player) => player.role === "reserve").length, 4);
    for (const position of positions) {
      assert.equal(recommendation.players.filter((player) => player.position === position && player.role === "reserve").length, 1);
    }
    assert.equal(recommendation.winterPlan?.transferLimit, 3);
    assert.ok((recommendation.winterPlan?.transferCount ?? 4) <= 3);
    assert.equal(recommendation.projectedMatchdays?.length, league === "0003" ? 38 : 34);
    assert.ok(recommendation.projectedMatchdays?.every((matchday) => matchday.players.length === 11));
  });
}

for (const league of ["0001", "0002", "0003"]) {
  test(`published ${league} Interactive-v2 recommendation uses valid round-specific lineups`, () => {
    const artifact = JSON.parse(readFileSync(new URL(`../public/data/recommendations/se-k${league}2026-interactive.json`, import.meta.url), "utf8")) as {
      schemaVersion: number;
      modelVersion: number;
      recommendation: ManagerRecommendation;
    };
    const recommendation = artifact.recommendation;
    assert.equal(artifact.schemaVersion, 2);
    assert.equal(artifact.modelVersion, 2);
    assert.equal(recommendation.modelVersion, 2);
    assert.equal(recommendation.players.length, 22);
    assert.equal(new Set(recommendation.players.map((player) => player.id)).size, 22);
    assert.equal(recommendation.players.filter((player) => player.role === "start").length, 11);
    assert.ok(recommendation.spentM <= recommendation.budgetM);
    const roundCount = league === "0003" ? 38 : 34;
    assert.equal(recommendation.projectedMatchdays?.length, roundCount);
    assert.ok([3, 4].includes(recommendation.winterPlan?.transferLimit ?? 0));
    assert.ok((recommendation.winterPlan?.transferCount ?? 5) <= (recommendation.winterPlan?.transferLimit ?? 0));
    assert.ok((recommendation.winterPlan?.spentM ?? recommendation.budgetM + 1) <= recommendation.budgetM);
    for (const transfer of recommendation.winterPlan?.transfers ?? []) {
      assert.equal(transfer.position, recommendation.players.find((player) => player.id === transfer.sell.id)?.position);
    }
    for (const position of positions) {
      assert.equal(recommendation.players.filter((player) => player.position === position).length, recommendation.rules.positions[position]);
    }
    for (const matchday of recommendation.projectedMatchdays ?? []) {
      assert.equal(matchday.players.length, 11);
      assert.match(matchday.formation, /^[345]-[345]-[123]$/);
      assert.ok(matchday.expectedPoints > 0);
      assert.ok(matchday.players.every((player) => {
        const probability = player.pStart + player.pSub + player.pDnp;
        return Math.abs(probability - 1) < 0.002
          && player.p10Points <= player.medianPoints
          && player.medianPoints <= player.p90Points;
      }));
      const initialIds = new Set(recommendation.players.map((player) => player.id));
      const activeIds = matchday.matchday < (recommendation.winterPlan?.startMatchday ?? roundCount + 1)
        ? initialIds
        : new Set([
            ...[...initialIds].filter((id) => !(recommendation.winterPlan?.transfers.some((transfer) => transfer.sell.id === id) ?? false)),
            ...(recommendation.winterPlan?.transfers.map((transfer) => transfer.buy.id) ?? []),
          ]);
      assert.ok(matchday.players.every((player) => activeIds.has(player.id)));
    }
  });
}
