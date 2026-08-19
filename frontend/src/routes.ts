export type RouteView =
  | "overview"
  | "table"
  | "players"
  | "player"
  | "teams"
  | "team"
  | "top"
  | "about"
  | "methodology"
  | "sources"
  | "faq";

const routePaths: Record<RouteView, string> = {
  overview: "/",
  table: "/tabelle",
  players: "/spieler",
  player: "/spieler",
  teams: "/mannschaften",
  team: "/mannschaften",
  top: "/topspieler",
  about: "/ueber",
  methodology: "/daten-methodik",
  sources: "/quellen",
  faq: "/faq",
};

// The Historie page was folded into the Tabellen, Spieler and Überblick views;
// old links and the crawled /historie path keep resolving to the Tabellen page.
// The Fantasy-Team page was removed with the shift to a stats-first product;
// its crawled path resolves to the Mannschaften overview.
const legacyPaths: Record<string, RouteView> = {
  "/historie": "table",
  "/fantasy-team": "teams",
};

function normalizedPathname(pathname: string) {
  const normalized = `/${pathname.split("/").filter(Boolean).join("/")}`;
  return normalized === "/" ? normalized : normalized.replace(/\/$/, "");
}

export function pathForView(view: RouteView) {
  return routePaths[view];
}

export function hrefForView(view: RouteView, params: URLSearchParams) {
  const query = params.toString();
  return `${pathForView(view)}${query ? `?${query}` : ""}`;
}

export function viewFromPathname(pathname: string, playerId: string | null, teamId: string | null): RouteView | null {
  const normalized = normalizedPathname(pathname);
  if (normalized === "/") return "overview";
  if (normalized === "/spieler") return playerId ? "player" : "players";
  if (normalized === "/mannschaften") return teamId ? "team" : "teams";
  if (legacyPaths[normalized]) return legacyPaths[normalized];
  return (Object.entries(routePaths) as [RouteView, string][])
    .find(([view, path]) => view !== "player" && view !== "team" && path === normalized)?.[0] ?? null;
}
