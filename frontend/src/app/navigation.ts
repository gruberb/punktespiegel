import { viewFromPathname } from "../lib/navigation/routes";
import type { Filters, View } from "../lib/navigation/scope";
import { infoViews } from "../lib/navigation/scope";
import type { Catalog } from "../types/models";

export type ViewLocation = { view: View; filters: Filters; playerId: string | null; teamId: string | null; matchId: string | null; scrollY: number };

export function initialFilters(): Filters {
  const params = new URLSearchParams(window.location.search);
  const league = params.get("league") ?? "0001";
  const requestedRound = Number(params.get("round") ?? "1");
  const maximumRound = league === "0003" ? 38 : 34;
  const round = Number.isInteger(requestedRound) ? Math.min(Math.max(requestedRound, 1), maximumRound) : 1;
  return { league, season: params.get("season") ?? "2026", round: String(round) };
}

export function requestedInitialRound() {
  const params = new URLSearchParams(window.location.search);
  return params.has("round") ? Number(params.get("round")) : null;
}

export function initialView(): View {
  const params = new URLSearchParams(window.location.search);
  const playerId = params.get("player");
  const teamId = params.get("team");
  const pathView = viewFromPathname(window.location.pathname, playerId, teamId);
  const legacyView = params.get("view");
  const value = pathView === "overview" && legacyView ? legacyView : pathView ?? legacyView;
  if (value === "player" && !params.get("player")) return "players";
  if (value === "team" && !params.get("team")) return "teams";
  if (value === "match" && !params.get("match")) return "overview";
  if (value === "top") return "players";
  if (value === "history") return "table";
  return (["overview", "matchday", "table", "players", "player", "teams", "team", "match", ...infoViews] as View[]).includes(value as View)
    ? (value as View)
    : "overview";
}

export function seasonsForLeague(catalog: Catalog | null, league: string) {
  return (catalog?.seasons.filter((season) => season.leagueCode === league) ?? [])
    .sort((left, right) => right.startYear - left.startYear);
}

export function seasonsForTeam(catalog: Catalog | null, teamId: string | null) {
  if (!teamId) return [];
  return (catalog?.seasons.filter((season) => season.teamIds.includes(teamId)) ?? [])
    .sort((left, right) => right.startYear - left.startYear);
}

export function playerSeasonMembership(season: Catalog["seasons"][number], playerId: string) {
  return season.players.find((player) => player.id === playerId);
}

export function seasonsForPlayer(catalog: Catalog | null, playerId: string | null) {
  if (!playerId) return [];
  const candidates = (catalog?.seasons.filter((season) => playerSeasonMembership(season, playerId)) ?? [])
    .sort((left, right) => {
      if (left.startYear !== right.startYear) return right.startYear - left.startYear;
      const leftPlayer = playerSeasonMembership(left, playerId)!;
      const rightPlayer = playerSeasonMembership(right, playerId)!;
      return Number(rightPlayer.active) - Number(leftPlayer.active)
        || rightPlayer.appearances - leftPlayer.appearances
        || rightPlayer.points - leftPlayer.points
        || left.leagueCode.localeCompare(right.leagueCode);
    });
  const years = new Set<number>();
  return candidates.filter((season) => {
    if (years.has(season.startYear)) return false;
    years.add(season.startYear);
    return true;
  });
}

export function viewBackLabel(view: View) {
  return ({
    overview: "zum Überblick",
    matchday: "zum Spieltag",
    players: "zu den Spielern",
    player: "zum Spielerprofil",
    teams: "zu den Mannschaften",
    team: "zur Mannschaft",
    match: "zum Spiel",
    table: "zu den Tabellen",
    about: "zu Über Punktespiegel",
    methodology: "zu Daten & Methodik",
    sources: "zu den Quellen",
    faq: "zu den häufigen Fragen",
  } satisfies Record<View, string>)[view];
}
