import { SimpleCardHead } from "@gruberb/fun-ui";
import { useCallback } from "react";
import { BestPlayerCard, groupBestEleven } from "./best-eleven";
import { ResourcePanel } from "./resource-panel";
import { useResource } from "../hooks/use-resource";
import { api } from "../lib/data/api";
import type { Position } from "../types/models";

export function OverviewBestEleven({ league, season, round, scope, onPlayer }: { league: string; season: string; round: number; scope: "season" | "matchday"; onPlayer: (id: string) => void }) {

  const resource = useResource(useCallback(
    (signal: AbortSignal) => api.bestEleven(new URLSearchParams({ league, season, round: String(round), scope }), signal),
    [league, season, round, scope],
  ));

  return (
    <article className="dashboard-card overview-eleven-card">
      <SimpleCardHead title={scope === "season" ? `Beste Elf · bis Spieltag ${round}` : `Beste Elf · Spieltag ${round}`} />
      <ResourcePanel resource={resource} label="Beste Elf">{eleven => {
        const grouped = groupBestEleven(eleven.players);
        return <>
        <p className="overview-eleven-summary"><strong>{eleven.points}</strong> Punkte · Formation {eleven.formation} · {scope === "season" ? "beste Elf der Saison" : `beste Elf von Spieltag ${round}`}</p>
        <div className="best-pitch compact-pitch">
          {(["FWD", "MID", "DEF", "GK"] as Position[]).map((position) => <div className="best-row" key={position}>
            {grouped[position].map((player) => <BestPlayerCard key={player.id} player={player} onClick={() => onPlayer(player.id)} />)}
          </div>)}
        </div>
      </>; }}</ResourcePanel>
    </article>
  );
}
