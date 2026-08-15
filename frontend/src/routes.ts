export type RouteView =
  | "overview"
  | "players"
  | "player"
  | "teams"
  | "team"
  | "history"
  | "top"
  | "manager"
  | "about"
  | "methodology"
  | "sources"
  | "faq";

const routePaths: Record<RouteView, string> = {
  overview: "/",
  players: "/spieler",
  player: "/spieler",
  teams: "/mannschaften",
  team: "/mannschaften",
  history: "/historie",
  top: "/topspieler",
  manager: "/fantasy-team",
  about: "/ueber",
  methodology: "/daten-methodik",
  sources: "/quellen",
  faq: "/faq",
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
  return (Object.entries(routePaths) as [RouteView, string][])
    .find(([view, path]) => view !== "player" && view !== "team" && path === normalized)?.[0] ?? null;
}
