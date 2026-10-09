import { EntityLink } from "./entity-link";
import { LogoTile } from "@gruberb/fun-ui";
import type { BestElevenPlayer, Position } from "../types/models";
import { lastName } from "../utils/format";

export function BestPlayerCard({ player, onClick }: { player: BestElevenPlayer; onClick: () => void }) {
  return <div className="best-player" onClick={onClick}><LogoTile code={player.teamCode} url={player.logoUrl} /><strong><EntityLink kind="player" id={player.id}>{lastName(player.name)}</EntityLink></strong><small><EntityLink kind="team" id={player.teamId}>{player.team}</EntityLink></small><span>{player.points} Pkt.</span></div>;
}

export function groupBestEleven(players: BestElevenPlayer[]) {
  return players.reduce<Record<Position, BestElevenPlayer[]>>((groups, player) => {
    groups[player.position].push(player);
    return groups;
  }, { GK: [], DEF: [], MID: [], FWD: [] });
}
