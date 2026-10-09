import { Portrait, Tag } from "@gruberb/fun-ui";
import type { Position } from "../types/models";
import { lastName } from "../utils/format";

export const positionName: Record<Position, string> = {
  GK: "Torwart",
  DEF: "Abwehr",
  MID: "Mittelfeld",
  FWD: "Sturm",
};

const positionSeries = { GK: 1, DEF: 2, MID: 3, FWD: 4 } as const;

export function PlayerPortrait({ name, url, teamCode, teamLogoUrl, large = false }: { name: string; url: string | null; teamCode: string; teamLogoUrl: string | null; large?: boolean }) {
  return <Portrait label={`Foto von ${name}`} url={url} fallbackCode={teamCode} fallbackUrl={teamLogoUrl} size={large ? "lg" : "md"} />;
}

export function PositionTag({ position }: { position: Position }) {
  return <Tag series={positionSeries[position]}>{positionName[position]}</Tag>;
}

export function PlayerName({ name }: { name: string }) {
  const short = lastName(name);
  if (short === name) return <strong>{name}</strong>;
  return <strong title={name}><span className="player-name-full">{name}</span><span className="player-name-short">{short}</span></strong>;
}
