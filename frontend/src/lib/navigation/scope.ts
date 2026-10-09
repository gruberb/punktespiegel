import type { RouteView } from "./routes";
import { hrefForView } from "./routes";

export type InfoView = "about" | "methodology" | "sources" | "faq";

export type View = RouteView;

export type NavView = Exclude<View, "player" | "team" | "match">;

export type Filters = { league: string; season: string; round: string };

export const infoViews: InfoView[] = ["about", "methodology", "sources", "faq"];

export function isInfoView(view: View): view is InfoView {
  return infoViews.includes(view as InfoView);
}

export function scopeQuery(filters: Filters, includeRound = true) {
  const params = new URLSearchParams({ league: filters.league, season: filters.season });
  if (includeRound) params.set("round", filters.round);
  return params;
}

export function viewHref(view: NavView, filters: Filters) {
  const params = isInfoView(view) ? new URLSearchParams() : scopeQuery(filters, view === "table");
  return hrefForView(view, params);
}
