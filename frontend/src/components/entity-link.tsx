import { createContext, useContext } from "react";
import type { ReactNode } from "react";
import { hrefForView } from "../lib/navigation/routes";
import type { Filters } from "../lib/navigation/scope";

type EntityNavigation = { filters: Filters; onPlayer: (id: string) => void; onTeam: (id: string) => void };
export const EntityNavigationContext = createContext<EntityNavigation | null>(null);

export function EntityLink({ kind, id, children }: { kind: "player" | "team"; id: string; children: ReactNode }) {
  const navigation = useContext(EntityNavigationContext);
  if (!navigation) throw new Error("EntityLink requires EntityNavigationContext.");
  const params = new URLSearchParams(navigation.filters);
  params.set(kind, id);
  return <a className="text-link" href={hrefForView(kind, params)} onKeyDown={(event) => event.stopPropagation()} onClick={(event) => {
    event.stopPropagation();
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    (kind === "player" ? navigation.onPlayer : navigation.onTeam)(id);
  }}>{children}</a>;
}
