import type { Catalog, Position } from "./types";

const positionOrder: Record<Position, number> = { GK: 0, DEF: 1, MID: 2, FWD: 3 };

export function comparePlayerPositions(left: Position, right: Position, direction: "asc" | "desc") {
  const difference = positionOrder[left] - positionOrder[right];
  return direction === "asc" ? difference : -difference;
}

export function previousSeasonPointsByPlayer(catalog: Pick<Catalog, "seasons">, startYear: number) {
  const previousSeasons = catalog.seasons.filter((season) => season.startYear === startYear - 1);
  const points = new Map<string, number>();
  for (const season of previousSeasons) {
    for (const player of season.players) points.set(player.id, (points.get(player.id) ?? 0) + player.points);
  }
  return { available: previousSeasons.length > 0, points };
}

export function shortSeasonLabel(displayName: string) {
  const [start, end] = displayName.split("/");
  return end ? `${start.slice(-2)}/${end.slice(-2)}` : displayName;
}
