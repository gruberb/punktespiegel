import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { JSDOM } from "jsdom";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

const dom = new JSDOM('<div id="root"></div>', { url: "http://localhost/" });
for (const key of ["window", "document", "HTMLElement", "Element", "Node", "localStorage", "history", "location"]) globalThis[key] = dom.window[key];
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
window.scrollTo = () => {};
window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
globalThis.ResizeObserver = class { observe() {} disconnect() {} };
globalThis.fetch = async () => ({ ok: true, json: async () => ({ leagues: [], seasons: [], players: {} }) });
const { api } = await import("../src/lib/data/api.ts");
const { PlayerDetailView } = await import("../src/features/players/player-detail-view.tsx");
const { InsightCards } = await import("../src/features/standings/insights.tsx");
const { EntityLink, EntityNavigationContext } = await import("../src/components/entity-link.tsx");
const { default: App } = await import("../src/app/app.tsx");
const originalApi = { ...api };
let root;
const container = document.getElementById("root");
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
async function render(element) { root ??= createRoot(container); await act(async () => { root.render(element); }); }
async function click(element, init = {}) { assert.ok(element, "click target exists"); await act(async () => { element.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true, ...init })); }); }
afterEach(async () => { if (root) await act(async () => root.unmount()); root = null; Object.assign(api, originalApi); localStorage.clear(); history.replaceState({}, "", "/"); });
const filters = { league: "0001", season: "2026", round: "4" };
const detail = (year) => ({ id: "p", name: "Player", teamId: "t", team: `Team ${year}`, teamCode: "T", position: "GK", photoUrl: null, logoUrl: null, kickerUrl: "https://example.com", league: "Liga", season: `${year}/${year + 1}`, startYear: year, seasonPoints: year, priceM: 1, value: 1, games: [] });
const historyRows = [2026, 2025, 2024].map((year) => ({ startYear: year, season: String(year), teams: [], league: "Liga", appearances: 1, gradedAppearances: 1, goals: 0, assists: 0, points: year }));

test("season changes preserve header, tabs and history; stale responses and local failures do not replace them", async () => {
  const loads = new Map([2026, 2025, 2024].map((year) => [year, deferred()]));
  let historyCalls = 0;
  api.playerSeason = (_id, params) => loads.get(Number(params.get("season"))).promise;
  api.playerHistory = async () => { historyCalls++; return historyRows; };
  api.playerProfile = () => new Promise(() => {});
  const view = (year) => React.createElement(PlayerDetailView, { key: "p", filters: { ...filters, season: String(year) }, playerId: "p", backLabel: "Zurück", onBack() {}, onTeam() {}, onSeason() {}, onMatch() {} });
  await render(view(2026));
  await act(async () => loads.get(2026).resolve(detail(2026)));
  assert.match(container.textContent, /Player/);
  const header = container.querySelector("header");
  const table = container.querySelector(".player-season-table");
  const tabs = container.querySelector('[role="tablist"]');
  await render(view(2025));
  assert.equal(container.querySelector("header"), header);
  assert.equal(container.querySelector(".player-season-table"), table);
  assert.equal(container.querySelector('[role="tablist"]'), tabs);
  assert.match(container.textContent, /Saisonverlauf wird geladen/);
  await render(view(2024));
  await act(async () => loads.get(2025).resolve(detail(2025)));
  assert.doesNotMatch(container.textContent, /Team 2025/);
  await act(async () => loads.get(2024).reject(new Error("Saison fehlt")));
  assert.match(container.textContent, /Saison fehlt/);
  assert.equal(container.querySelector(".player-season-table"), table);
  assert.equal(historyCalls, 1);
  assert.equal(container.querySelector(".game-table"), null);
});

test("a failed history request does not block games or the profile header", async () => {
  api.playerSeason = async () => detail(2026);
  api.playerHistory = async () => { throw new Error("Archiv fehlt"); };
  api.playerProfile = () => new Promise(() => {});
  await render(React.createElement(PlayerDetailView, { filters, playerId: "p", onBack() {}, onTeam() {}, onSeason() {}, onMatch() {} }));
  assert.match(container.textContent, /Archiv fehlt/);
  assert.match(container.textContent, /Player/);
  assert.ok(container.querySelector(".game-table"));
});

test("insight names and outcome squares open their exact entities", async () => {
  const selected = [];
  const subject = { kind: "player", id: "p", name: "Player" };
  const cards = [{ id: "points", title: "Punkte", category: "Spieler", question: "Wer?", answer: "PLAYER · 56", detailLabel: "Note", detail: "2", subject, visual: { type: "outcomes", label: "Spiele", values: ["H"], matches: [{ matchId: "m42", home: { kind: "team", id: "a", name: "A" }, away: { kind: "team", id: "b", name: "B" }, score: "3:1" }] } }];
  await render(React.createElement(InsightCards, { cards, onPlayer: (id) => selected.push(id), onTeam: (id) => selected.push(id), onMatch: (id) => selected.push(id) }));
  await click([...container.querySelectorAll("button")].find((button) => button.textContent === "PLAYER · 56"));
  await click(container.querySelector('.insight-outcomes [role="button"]'));
  assert.deepEqual(selected, ["p", "m42"]);
});

test("entity links preserve scope and stop parent navigation", async () => {
  const calls = [];
  await render(React.createElement(EntityNavigationContext, { value: { filters, onPlayer: (id) => calls.push(id), onTeam: (id) => calls.push(id) } }, React.createElement("div", { onClick: () => calls.push("parent") }, React.createElement(EntityLink, { kind: "team", id: "team-1" }, "Team"))));
  const link = container.querySelector("a");
  assert.equal(link.getAttribute("href"), "/mannschaften?league=0001&season=2026&round=4&team=team-1");
  await click(link);
  assert.deepEqual(calls, ["team-1"]);
});

test("sidebar collapse persists across remounts and retains accessible navigation labels", async () => {
  api.catalog = () => new Promise(() => {});
  await render(React.createElement(App));
  await click(container.querySelector('[aria-label="Seitenleiste einklappen"]'));
  assert.ok(container.querySelector(".sidebar-collapsed"));
  assert.equal(localStorage.getItem("punktespiegel.sidebarCollapsed"), "true");
  assert.ok(container.querySelector(".fui-app-shell__nav").textContent.includes("Spieler"));
  await act(async () => root.unmount()); root = null;
  await render(React.createElement(App));
  assert.equal(container.querySelector(".sidebar-toggle").getAttribute("aria-expanded"), "false");
  await click(container.querySelector(".sidebar-toggle"));
  assert.equal(container.querySelector(".sidebar-collapsed"), null);
});

test("form chips open a match without triggering the enclosing team row", async () => {
  const { FormTableCard } = await import("../src/features/standings/form-table.tsx");
  const calls = [];
  const home = { id: "a", name: "Home", code: "H", logoUrl: null };
  const away = { id: "b", name: "Away", code: "A", logoUrl: null };
  const standings = { context: { round: 1, leagueName: "Liga" }, rows: [{ team: home, rank: 1, played: 1, wins: 1, draws: 0, losses: 0, goalsFor: 2, goalsAgainst: 0, goalDifference: 2, points: 3, trend: null, formPoints: 3, positions: [1], form: [{ round: 1, outcome: "S", score: "2:0", home: true, opponent: away }] }], cross: { cells: { "a|b": { matchId: "fixture" } } } };
  await render(React.createElement(FormTableCard, { standings, league: "0001", onTeam: (id) => calls.push(id), onMatch: (id) => calls.push(id) }));
  await click(container.querySelector('.form-cell [role="button"]'));
  assert.deepEqual(calls, ["fixture"]);
});

test("switching players never shows the previous player's retained header", async () => {
  api.playerSeason = async () => detail(2026);
  api.playerHistory = async () => historyRows;
  api.playerProfile = () => new Promise(() => {});
  const props = { filters, onBack() {}, onTeam() {}, onSeason() {}, onMatch() {} };
  await render(React.createElement(PlayerDetailView, { ...props, key: "p", playerId: "p" }));
  assert.match(container.textContent, /Player/);
  api.playerSeason = () => new Promise(() => {});
  await render(React.createElement(PlayerDetailView, { ...props, key: "other", playerId: "other" }));
  assert.equal(container.querySelector("header"), null);
});

test("the season API does not request profile supplements or archive seasons", async () => {
  const requested = [];
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    requested.push(url);
    return { ok: true, json: async () => ({ schemaVersion: 2, leagueCode: "0001", leagueName: "Liga", startYear: 2019, displayName: "2019/20", players: [{ id: "p", name: "Player", teamId: "t", priceM: 1 }], teams: [{ id: "t", name: "Team" }], scores: [], matches: [] }) };
  };
  try {
    const result = await originalApi.playerSeason("p", new URLSearchParams({ league: "0001", season: "2019" }));
    assert.equal(result.name, "Player");
    assert.deepEqual(requested, ["/data/seasons/se-k00012019.json"]);
  } finally { globalThis.fetch = savedFetch; }
});

test("a failed shared season download can be retried", async () => {
  const savedFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    if (calls === 1) return { ok: false, status: 503 };
    return { ok: true, json: async () => ({ schemaVersion: 2, players: [{ id: "p", teamId: "t", priceM: 1 }], teams: [{ id: "t", name: "Team" }], scores: [], matches: [], leagueCode: "0001", displayName: "2018/19" }) };
  };
  const params = new URLSearchParams({ league: "0001", season: "2018" });
  try {
    await assert.rejects(originalApi.teams(params), /503/);
    await originalApi.teams(params);
    assert.equal(calls, 2);
  } finally { globalThis.fetch = savedFetch; }
});

test("hover cards allow keyboard access to team links without activating the match", async () => {
  const calls = [];
  const cards = [{ id: "goals", title: "Tore", category: "Spiele", question: "", answer: "3", detailLabel: "", detail: "", visual: { type: "outcomes", label: "", values: ["H"], matches: [{ matchId: "match", home: { id: "home", kind: "team", name: "Home", short: "Home" }, away: { id: "away", kind: "team", name: "Away", short: "Away" }, score: "2:1" }] } }];
  await render(React.createElement(InsightCards, { cards, onTeam: (id) => calls.push(id), onPlayer() {}, onMatch: (id) => calls.push(id) }));
  const square = container.querySelector('.insight-outcomes [role="button"]');
  await act(async () => square.focus());
  assert.ok(document.querySelector('.interactive-hover-card'));
  await act(async () => square.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true })));
  assert.equal(document.activeElement.textContent, "Home");
  await click(document.activeElement);
  assert.deepEqual(calls, ["home"]);
  await act(async () => document.activeElement.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
  assert.equal(document.querySelector('.interactive-hover-card'), null);
  assert.equal(document.activeElement, square);
});

test("ranking rows expose separate player and team links with readable labels", async () => {
  const { PlayerRanking } = await import("../src/features/rankings/player-ranking.tsx");
  const calls = [];
  const player = { id: "p", name: "Player Name", teamId: "t", team: "Team Name", teamCode: "T", position: "GK", observedPoints: 5, photoUrl: null, logoUrl: null };
  await render(React.createElement(EntityNavigationContext, { value: { filters, onPlayer: (id) => calls.push(id), onTeam: (id) => calls.push(id) } }, React.createElement(PlayerRanking, { players: [player], metric: "points", onPlayer: (id) => calls.push(id) })));
  assert.doesNotMatch(container.textContent, /EntityLink|\$/);
  const links = [...container.querySelectorAll("a")];
  await click(links.find((link) => link.textContent === "Team Name"));
  assert.deepEqual(calls, ["t"]);
});

const { ResourcePanel } = await import("../src/components/resource-panel.tsx");
const { TeamDetailView } = await import("../src/features/teams/team-detail-view.tsx");
const { MatchDetailView } = await import("../src/features/matches/match-detail-view.tsx");
const { RankingsView } = await import("../src/features/rankings/rankings-view.tsx");

test("resource boundaries retain DOM but disable stale content, recover, and clear changed identities", async () => {
  const panel = (resource, identity = "a") => React.createElement(ResourcePanel, { resource, identity, label: "Section" }, data => React.createElement("button", null, data));
  await render(panel({ data: "old", loading: false, error: null }));
  const button = container.querySelector("button");
  await render(panel({ data: null, loading: true, error: null }));
  assert.equal(container.querySelector("button"), button);
  assert.ok(button.closest("[inert]"));
  assert.equal(container.querySelector("section").getAttribute("aria-busy"), "true");
  await render(panel({ data: null, loading: false, error: "failed" }));
  assert.match(container.textContent, /failed/);
  assert.ok(button.closest("[inert]"));
  await render(panel({ data: "new", loading: false, error: null }));
  assert.equal(container.querySelector("button"), button);
  assert.equal(button.closest("[inert]"), null);
  assert.equal(button.textContent, "new");
  await render(panel({ data: null, loading: true, error: null }, "b"));
  assert.equal(container.querySelector("button"), null);
  await render(panel({ data: "b", loading: false, error: null }, "b"));
  await render(panel({ data: null, loading: false, error: null }, "b"));
  assert.equal(container.querySelector("button"), null);
});

test("team games render before club supplements; errors and season changes preserve tabs", async () => {
  const next = deferred();
  api.teamSeason = async (_id, params) => params.get("season") === "2026" ? { id: "t", name: "Team ready", code: "T", players: [], matches: [] } : next.promise;
  api.teamProfile = async () => { throw new Error("Club supplement unavailable"); };
  const view = season => React.createElement(TeamDetailView, { teamId: "t", filters: { ...filters, season }, backLabel: "Back", onBack() {}, onTeam() {}, onPlayer() {}, onMatch() {} });
  await render(view("2026"));
  assert.match(container.textContent, /Team ready/);
  assert.match(container.textContent, /Jedes Spiel im Detail/);
  assert.match(container.textContent, /Club supplement unavailable/);
  const tabs = container.querySelector('[role="tablist"]');
  const header = container.querySelector(".team-profile");
  await render(view("2025"));
  assert.equal(container.querySelector('[role="tablist"]'), tabs);
  assert.equal(container.querySelector(".team-profile"), header);
  assert.ok(header.closest("[inert]"));
  await act(async () => next.reject(new Error("Season unavailable")));
  assert.match(container.textContent, /Season unavailable/);
  assert.equal(container.querySelector('[role="tablist"]'), tabs);
});

test("rankings failure does not prevent the independent best eleven", async () => {
  api.dashboard = async () => { throw new Error("Rankings unavailable"); };
  api.bestEleven = async () => ({ points: 42, formation: "4-4-2", players: [] });
  await render(React.createElement(RankingsView, { scope: "through", eleven: { league: "0001", season: "2026", round: 4 }, onView() {}, onPlayer() {}, onTeam() {} }));
  assert.match(container.textContent, /Rankings unavailable/);
  assert.match(container.textContent, /42/);
  assert.ok(container.querySelector(".best-pitch"));
});

test("match failures leave the back navigation available", async () => {
  api.match = async () => { throw new Error("Report unavailable"); };
  let backs = 0;
  await render(React.createElement(MatchDetailView, { filters, matchId: "m", backLabel: "Back", onBack() { backs++; }, onPlayer() {}, onTeam() {}, onMatch() {} }));
  assert.match(container.textContent, /Report unavailable/);
  await click(container.querySelector(".back-button"));
  assert.equal(backs, 1);
});

const { MatchdayView } = await import("../src/features/matchday/matchday-view.tsx");
const { TeamsView } = await import("../src/features/teams/teams-view.tsx");

test("matchday results failure leaves filters and best eleven available", async () => {
  api.standings = async () => { throw new Error("Fixtures unavailable"); };
  api.dashboard = () => new Promise(() => {});
  api.bestEleven = async () => ({ points: 77, formation: "4-4-2", players: [] });
  await render(React.createElement(MatchdayView, { filters, leagues: [{code:"0001",name:"Liga"}], seasons: [{ startYear: 2026, displayName: "2026/27", latestRound: 4 }], onFilter() {}, onPlayer() {}, onMatch() {} }));
  assert.match(container.textContent, /Fixtures unavailable/);
  assert.match(container.textContent, /77/);
  assert.ok(container.querySelector('select[aria-label="Saison"]'));
  assert.ok(container.querySelector(".best-pitch"));
});

test("team table remains mounted across a delayed season change", async () => {
  const next = deferred();
  api.teams = (_params) => _params.get("season") === "2026" ? Promise.resolve([]) : next.promise;
  const view = season => React.createElement(TeamsView, { filters: {...filters, season}, onTeam() {} });
  await render(view("2026"));
  const table = container.querySelector("table");
  assert.ok(table);
  await render(view("2025"));
  assert.equal(container.querySelector("table"), table);
  assert.ok(table.closest("[inert]"));
  await act(async () => next.resolve([]));
  assert.equal(container.querySelector("table"), table);
  assert.equal(table.closest("[inert]"), null);
});
