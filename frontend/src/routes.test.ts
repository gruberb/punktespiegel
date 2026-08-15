import assert from "node:assert/strict";
import test from "node:test";
import { hrefForView, pathForView, viewFromPathname } from "./routes.ts";

test("maps primary views to stable clean paths", () => {
  assert.equal(pathForView("manager"), "/fantasy-team");
  assert.equal(pathForView("players"), "/spieler");
  assert.equal(pathForView("methodology"), "/daten-methodik");
});

test("reads clean paths with or without a trailing slash", () => {
  assert.equal(viewFromPathname("/fantasy-team", null, null), "manager");
  assert.equal(viewFromPathname("/fantasy-team/", null, null), "manager");
  assert.equal(viewFromPathname("/unknown", null, null), null);
});

test("uses the shared collection path for player and team details", () => {
  assert.equal(viewFromPathname("/spieler", null, null), "players");
  assert.equal(viewFromPathname("/spieler", "pl-1", null), "player");
  assert.equal(viewFromPathname("/mannschaften", null, "tm-1"), "team");
});

test("builds a clean href with filter parameters", () => {
  assert.equal(
    hrefForView("manager", new URLSearchParams({ league: "0002", season: "2026", section: "matchdays", matchday: "3" })),
    "/fantasy-team?league=0002&season=2026&section=matchdays&matchday=3",
  );
});
