import { LogoTile, Popover, usePopoverHover } from "@gruberb/fun-ui";

export type PopoverTeam = { name: string; code: string; logoUrl: string | null };

export function MatchPopover({ hover, title, status, home, away, score }: { hover: ReturnType<typeof usePopoverHover<HTMLElement>>; title: string; status: string; home: PopoverTeam; away: PopoverTeam; score: string | null }) {
  return (
    <Popover anchorRef={hover.ref} open={hover.open} id={hover.id} preferredWidth={320}>
      <div className="fui-popover__header"><strong className="fui-popover__title">{title}</strong><span className="fui-popover__meta">{status}</span></div>
      <div className="form-popover-match">
        <span className="form-popover-team home"><strong title={home.name}>{home.code}</strong><LogoTile code={home.code} url={home.logoUrl} /></span>
        <span className={`fixture-score ${score ? "" : "fixture-score-open"}`}>{score ? score.replace(":", " : ") : "– : –"}</span>
        <span className="form-popover-team"><LogoTile code={away.code} url={away.logoUrl} /><strong title={away.name}>{away.code}</strong></span>
      </div>
    </Popover>
  );
}
