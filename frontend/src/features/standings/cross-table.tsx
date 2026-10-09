import { useHoverCard } from "../../components/hover-card";
import { LogoTile } from "@gruberb/fun-ui";
import type { RefObject } from "react";
import { useState } from "react";
import { MatchPopover } from "../../components/match-popover";
import type { LeagueStandings, LeagueTableTeam } from "../../types/models";
import { formatDateWithYear } from "../../utils/format";

export function CrossTableCard({ standings, onTeam, onMatch }: { standings: LeagueStandings; onTeam: (id: string) => void; onMatch: (id: string) => void }) {
  const teams = standings.rows.map((row) => row.team);
  // Row and column of the hovered cell, so the reader can trace both teams.
  const [active, setActive] = useState<{ home: string; away: string } | null>(null);
  return (
    <section className="tabelle-block">
      <div className="section-copy cross-copy">
        <div><p className="fui-kicker">Direktvergleich</p><h2>Kreuztabelle</h2></div>
        <div className="cross-legend"><span><i className="cross-swatch cross-cell-s" />Heimsieg</span><span><i className="cross-swatch cross-cell-u" />Unentschieden</span><span><i className="cross-swatch cross-cell-n" />Auswärtssieg</span></div>
      </div>
      <div className="detail-section cross-card">
        <div className="cross-scroll">
          <table className="cross-table" onMouseLeave={() => setActive(null)}>
            <thead>
              <tr>
                <th className="cross-corner">Heim \ Ausw.</th>
                {teams.map((team) => <th key={team.id} title={team.name} className={active?.away === team.id ? "is-active" : undefined}><button className="text-link" onClick={() => onTeam(team.id)} aria-label={`${team.name}: Mannschaftsprofil öffnen`}><LogoTile code={team.code} url={team.logoUrl} /></button></th>)}
              </tr>
            </thead>
            <tbody>
              {teams.map((home) => (
                <tr key={home.id}>
                  <th scope="row" className={active?.home === home.id ? "is-active" : undefined}><button className="cross-row-head" onClick={() => onTeam(home.id)} title={`${home.name}: Mannschaftsprofil öffnen`}><LogoTile code={home.code} url={home.logoUrl} /><span>{home.code}</span></button></th>
                  {teams.map((away) => home.id === away.id
                    ? <td key={away.id} className="cross-self" onMouseEnter={() => setActive(null)} />
                    : <CrossCell key={away.id} home={home} away={away} cell={standings.cross.cells[`${home.id}|${away.id}`]} onActive={setActive} onMatch={onMatch} onTeam={onTeam} />)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function CrossCell({ home, away, cell, onActive, onMatch, onTeam }: {
  home: LeagueTableTeam;
  away: LeagueTableTeam;
  cell: LeagueStandings["cross"]["cells"][string] | undefined;
  onActive: (pair: { home: string; away: string } | null) => void;
  onMatch: (id: string) => void;
  onTeam: (id: string) => void;
}) {
  const hover = useHoverCard<HTMLElement>(() => onActive({ home: home.id, away: away.id }));
  const played = cell != null && cell.homeScore != null && cell.awayScore != null;
  const outcome = !played ? null : cell.homeScore! > cell.awayScore! ? "s" : cell.homeScore! < cell.awayScore! ? "n" : "u";
  const result = played ? `${cell.homeScore}:${cell.awayScore}` : null;
  const status = !cell ? "Keine Partie angesetzt" : played ? (outcome === "s" ? "Heimsieg" : outcome === "n" ? "Auswärtssieg" : "Unentschieden") : "Noch offen";
  const date = cell?.scheduledAt ? formatDateWithYear(cell.scheduledAt) : null;
  return (
    <td
      ref={hover.ref as RefObject<HTMLTableCellElement>}
      className={outcome ? `cross-cell-${outcome}` : "cross-open"}
      tabIndex={0}
      aria-label={`${home.name} gegen ${away.name}: ${result ?? status}${cell ? `, Spieltag ${cell.round}` : ""}`}
      {...hover.handlers}
      onClick={cell ? () => onMatch(cell.matchId) : undefined}
      onKeyDown={cell ? (event) => { if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); onMatch(cell.matchId); } } : undefined}
    >
      {result ?? "–"}
      <MatchPopover hover={hover} title={cell ? `Spieltag ${cell.round}` : "Direktvergleich"} status={`${status}${date ? ` · ${date}` : ""}`} home={home} away={away} score={result} onTeam={onTeam} onMatch={cell ? () => onMatch(cell.matchId) : undefined} />
    </td>
  );
}
