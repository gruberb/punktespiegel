import { LogoTile } from "@gruberb/fun-ui";
import type { BestElevenPlayer, Position } from "../types/models";
import { lastName } from "../utils/format";

export function BestPlayerCard({ player, onClick }: { player: BestElevenPlayer; onClick: () => void }) {
  return <button className="best-player" onClick={onClick}><LogoTile code={player.teamCode} url={player.logoUrl} /><strong>{lastName(player.name)}</strong><small>{player.team}</small><span>{player.points} Pkt.</span></button>;
}

export function groupBestEleven(players: BestElevenPlayer[]) {
  return players.reduce<Record<Position, BestElevenPlayer[]>>((groups, player) => {
    groups[player.position].push(player);
    return groups;
  }, { GK: [], DEF: [], MID: [], FWD: [] });
}
