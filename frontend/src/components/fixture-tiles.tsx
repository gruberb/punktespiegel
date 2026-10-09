import { EntityLink } from "./entity-link";
import { LogoTile, MatchTiles } from "@gruberb/fun-ui";
import type { LeagueTableTeam } from "../types/models";

export type TileMatch = { id: string; scheduledAt: string | null; home: LeagueTableTeam; away: LeagueTableTeam; homeScore: number | null; awayScore: number | null };

// Compact tiles that wrap instead of scrolling sideways; every matchday fits
// on one screen and each tile opens its match report.
export function FixtureTiles({ matches, currentId, onMatch }: { matches: TileMatch[]; currentId?: string; onMatch: (id: string) => void }) {
  return (
    <MatchTiles>
      {matches.map((match) => {
        const played = match.homeScore != null && match.awayScore != null;
        const label = `${match.home.name} ${played ? `${match.homeScore}:${match.awayScore}` : "gegen"} ${match.away.name}: Spielbericht öffnen`;
        return <li key={match.id}><div className="fui-match-tile" aria-current={match.id === currentId ? "true" : undefined}>
          <button className="text-link fui-match-tile__time" onClick={() => onMatch(match.id)} aria-label={label}>{formatTileSlot(match.scheduledAt)}</button>
          {(["home", "away"] as const).map((side) => {
            const team = match[side];
            const score = side === "home" ? match.homeScore : match.awayScore;
            const opponentScore = side === "home" ? match.awayScore : match.homeScore;
            return <span key={side} className={`fui-match-tile__team${score != null && opponentScore != null && score > opponentScore ? " is-winner" : ""}`}>
              <LogoTile code={team.code} url={team.logoUrl} />
              <EntityLink kind="team" id={team.id}>{team.code}</EntityLink>
              <b><button className="text-link" onClick={() => onMatch(match.id)} aria-label={label}>{played ? score : "–"}</button></b>
            </span>;
          })}
        </div></li>;
      })}
    </MatchTiles>
  );
}

function formatTileSlot(value: string | null) {
  if (!value) return "Termin offen";
  return new Intl.DateTimeFormat("de-DE", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value)).replace(",", "");
}
