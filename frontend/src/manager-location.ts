export type ManagerSection = "overview" | "matchdays";

export type ManagerLocation = {
  section: ManagerSection;
  matchday: number | null;
};

export function managerLocationFromSearch(search: string): ManagerLocation {
  const params = new URLSearchParams(search);
  const requestedMatchday = Number(params.get("matchday"));
  return {
    section: params.get("section") === "matchdays" ? "matchdays" : "overview",
    matchday: Number.isInteger(requestedMatchday) && requestedMatchday > 0 ? requestedMatchday : null,
  };
}

export function applyManagerLocation(params: URLSearchParams, location: ManagerLocation) {
  params.set("section", location.section);
  if (location.matchday !== null) params.set("matchday", String(location.matchday));
  else params.delete("matchday");
}
