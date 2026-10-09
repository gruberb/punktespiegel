import { LogoTile, MatchTile, MatchTiles } from "@gruberb/fun-ui";
import type { LeagueTableTeam } from "../types/models";

export type TileMatch = { id: string; scheduledAt: string | null; home: LeagueTableTeam; away: LeagueTableTeam; homeScore: number | null; awayScore: number | null };

// Compact tiles that wrap instead of scrolling sideways; every matchday fits
// on one screen and each tile opens its match report.
export function FixtureTiles({ matches, currentId, onMatch }: { matches: TileMatch[]; currentId?: string; onMatch: (id: string) => void }) {
  return (
    <MatchTiles>
      {matches.map((match) => {
        const played = match.homeScore != null && match.awayScore != null;
        return <MatchTile
          key={match.id}
          time={formatTileSlot(match.scheduledAt)}
          home={{ name: match.home.name, label: match.home.code, logo: <LogoTile code={match.home.code} url={match.home.logoUrl} />, score: match.homeScore }}
          away={{ name: match.away.name, label: match.away.code, logo: <LogoTile code={match.away.code} url={match.away.logoUrl} />, score: match.awayScore }}
          current={match.id === currentId}
          onSelect={() => onMatch(match.id)}
          ariaLabel={`${match.home.name} ${played ? `${match.homeScore}:${match.awayScore}` : "gegen"} ${match.away.name}: Spielbericht öffnen`}
        />;
      })}
    </MatchTiles>
  );
}

function formatTileSlot(value: string | null) {
  if (!value) return "Termin offen";
  return new Intl.DateTimeFormat("de-DE", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value)).replace(",", "");
}
