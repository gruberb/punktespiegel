import assert from "node:assert/strict";
import test from "node:test";
import { applyManagerLocation, managerLocationFromSearch } from "./manager-location.ts";

test("reads the Fantasy Team section and selected matchday from a deep link", () => {
  assert.deepEqual(managerLocationFromSearch("?view=manager&section=matchdays&matchday=12"), {
    section: "matchdays",
    matchday: 12,
  });
});

test("falls back safely for unknown sections and invalid matchdays", () => {
  assert.deepEqual(managerLocationFromSearch("?view=manager&section=unknown&matchday=-2"), {
    section: "overview",
    matchday: null,
  });
});

test("writes the selected matchday independently of the active section", () => {
  const params = new URLSearchParams({ view: "manager" });
  applyManagerLocation(params, { section: "matchdays", matchday: 7 });
  assert.equal(params.get("section"), "matchdays");
  assert.equal(params.get("matchday"), "7");

  applyManagerLocation(params, { section: "overview", matchday: 7 });
  assert.equal(params.get("section"), "overview");
  assert.equal(params.get("matchday"), "7");
});
