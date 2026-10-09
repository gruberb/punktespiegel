import { HoverCard, useHoverCard } from "./hover-card";
import { LogoTile } from "@gruberb/fun-ui";

export type PopoverTeam = { id?: string; name: string; code: string; logoUrl: string | null };

export function MatchPopover({ hover, title, status, home, away, score, onMatch, onTeam }: { hover: ReturnType<typeof useHoverCard<HTMLElement>>; title: string; status: string; home: PopoverTeam; away: PopoverTeam; score: string | null; onMatch?: () => void; onTeam?: (id: string) => void }) {
  return (
    <HoverCard hover={hover} label={title} preferredWidth={320}>
      <div className="fui-popover__header"><strong className="fui-popover__title">{title}</strong><span className="fui-popover__meta">{status}</span></div>
      <div className="form-popover-match">
        <span className="form-popover-team home"><strong title={home.name}>{home.id && onTeam ? <button className="text-link" onClick={(event) => { event.stopPropagation(); onTeam(home.id!); }}>{home.code}</button> : home.code}</strong><LogoTile code={home.code} url={home.logoUrl} /></span>
        <span className={`fixture-score ${score ? "" : "fixture-score-open"}`}>{onMatch ? <button className="text-link" aria-label="Spielbericht öffnen" onClick={(event) => { event.stopPropagation(); onMatch(); }}>{score ? score.replace(":", " : ") : "– : –"}</button> : score ? score.replace(":", " : ") : "– : –"}</span>
        <span className="form-popover-team"><LogoTile code={away.code} url={away.logoUrl} /><strong title={away.name}>{away.id && onTeam ? <button className="text-link" onClick={(event) => { event.stopPropagation(); onTeam(away.id!); }}>{away.code}</button> : away.code}</strong></span>
      </div>
    </HoverCard>
  );
}
