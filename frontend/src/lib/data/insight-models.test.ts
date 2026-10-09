import assert from "node:assert/strict";
import test from "node:test";
import type { SeasonIndex } from "./contracts";
import type { InsightCard, RoundInsights } from "../../types/models";
import { linkInsights } from "./insight-models.ts";

const matches = [
  { id: "home", round: 1, homeTeamId: "a", awayTeamId: "b" },
  { id: "away", round: 2, homeTeamId: "b", awayTeamId: "a" },
];
const index = { season: { matches, scores: [{ playerId: "p", matchId: "away", teamId: "b" }] } } as SeasonIndex;
const team = (id: string) => ({ kind: "team" as const, id, name: id });
const card = (visual: InsightCard["visual"], subject = team("a")): InsightCard => ({ id: "test", kind: "form", title: "Test", category: "Tabelle", question: "", answer: "", detailLabel: "", detail: "", subject, visual });

test("outcomes match canonical team IDs and round, not array position", () => {
  const insights: RoundInsights = { round: 2, facts: [], cards: [card({ type: "outcomes", label: "", values: ["H"], matches: [{ home: team("b"), away: team("a"), score: "1:0" }] })] };
  const result = linkInsights(insights, index).cards[0].visual;
  assert.equal(result.type === "outcomes" && result.matches?.[0].matchId, "away");
});

test("result rows link the opponent and fixture in the correct home/away direction", () => {
  const visual: InsightCard["visual"] = { type: "results", label: "", summary: "", rows: [{ round: 2, outcome: "N", score: "0:1", opponent: "abbreviation", home: false }] };
  const result = linkInsights({ round: 2, facts: [], cards: [card(visual)] }, index).cards[0].visual;
  assert.equal(result.type === "results" && result.rows[0].matchId, "away");
  assert.equal(result.type === "results" && result.rows[0].opponentId, "b");
});

test("player rows use the score's team, including players who changed clubs", () => {
  const item = card({ type: "roundValues", label: "", unit: "Pkt.", summary: "", rows: [{ round: 2, value: 4, opponent: "A" }] });
  item.subject = { kind: "player", id: "p", name: "Player" };
  const result = linkInsights({ round: 2, facts: [], cards: [item] }, index).cards[0].visual;
  assert.equal(result.type === "roundValues" && result.rows[0].opponentId, "a");
});

test("missing or ambiguous fixtures do not create misleading links", () => {
  const visual: InsightCard["visual"] = { type: "results", label: "", summary: "", rows: [{ round: 3, outcome: "N", score: "0:1", opponent: "B", home: false }] };
  const result = linkInsights({ round: 3, facts: [], cards: [card(visual)] }, index).cards[0].visual;
  assert.equal(result.type === "results" && result.rows[0].matchId, undefined);
  const duplicate = { season: { ...index.season, matches: [...matches, { ...matches[0], id: "duplicate" }] } } as SeasonIndex;
  visual.rows[0].round = 1;
  const ambiguous = linkInsights({ round: 1, facts: [], cards: [card(visual)] }, duplicate).cards[0].visual;
  assert.equal(ambiguous.type === "results" && ambiguous.rows[0].matchId, undefined);
});
