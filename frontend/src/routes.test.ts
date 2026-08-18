import assert from "node:assert/strict";
import test from "node:test";
import { hrefForView, pathForView, viewFromPathname } from "./routes.ts";

test("maps primary views to stable clean paths", () => {
  assert.equal(pathForView("teams"), "/mannschaften");
  assert.equal(pathForView("players"), "/spieler");
  assert.equal(pathForView("methodology"), "/daten-methodik");
});

test("reads clean paths with or without a trailing slash", () => {
  assert.equal(viewFromPathname("/topspieler", null, null), "top");
  assert.equal(viewFromPathname("/topspieler/", null, null), "top");
  assert.equal(viewFromPathname("/tabelle", null, null), "table");
  assert.equal(viewFromPathname("/unknown", null, null), null);
});

test("keeps resolving the retired Historie path to the Tabelle", () => {
  assert.equal(viewFromPathname("/historie", null, null), "table");
  assert.equal(viewFromPathname("/historie/", null, null), "table");
  assert.equal(pathForView("table"), "/tabelle");
});

test("keeps resolving the retired Fantasy-Team path to the Mannschaften", () => {
  assert.equal(viewFromPathname("/fantasy-team", null, null), "teams");
  assert.equal(viewFromPathname("/fantasy-team/", null, null), "teams");
});

test("uses the shared collection path for player and team details", () => {
  assert.equal(viewFromPathname("/spieler", null, null), "players");
  assert.equal(viewFromPathname("/spieler", "pl-1", null), "player");
  assert.equal(viewFromPathname("/mannschaften", null, "tm-1"), "team");
});

test("builds a clean href with filter parameters", () => {
  assert.equal(
    hrefForView("teams", new URLSearchParams({ league: "0002", season: "2026" })),
    "/mannschaften?league=0002&season=2026",
  );
});
