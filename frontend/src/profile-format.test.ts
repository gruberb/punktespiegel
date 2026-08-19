import assert from "node:assert/strict";
import test from "node:test";
import { formatJoined } from "./profile-format.ts";

const now = new Date("2026-08-19T12:00:00Z");

test("measures club tenure at the end of a historical season", () => {
  assert.equal(formatJoined("2023-08-12", 2025, now), "08/2023 · 2 Jahre");
});

test("measures club tenure at today during the current season", () => {
  assert.equal(formatJoined("2023-08-12", 2026, now), "08/2023 · 3 Jahre");
});

test("formats date-only values independently of the local timezone", () => {
  assert.match(formatJoined("2023-09-01", 2023, now), /^09\/2023/);
});
