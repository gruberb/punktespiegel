import { LogoTile } from "@gruberb/fun-ui";
import { useCallback } from "react";
import { ErrorState } from "../../components/feedback";
import { useResource } from "../../hooks/use-resource";
import { api } from "../../lib/data/api";

export function PlayerSeasons({ playerId, selectedYear, onSeason, onTeam }: { playerId: string; selectedYear: number; onSeason: (year: number) => void; onTeam: (id: string) => void }) {
  const { data: seasons, error } = useResource(useCallback((signal: AbortSignal) => api.playerHistory(playerId, signal), [playerId]));
  if (error) return <ErrorState message={error} />;
  if (!seasons) return <p role="status">Saisonhistorie wird geladen …</p>;
  return (
          <section className="player-seasons">
            <div className="section-copy"><h3>Punkte nach Saison</h3><p>Verein, Einsätze, Tore und benotete Spiele je Saison im Archiv.</p></div>
            <div className="table-shell player-season-table">
              <table><thead><tr><th>Jahr</th><th>Verein</th><th>Liga</th><th className="fui-num">Einsätze</th><th className="fui-num">Benotet</th><th className="fui-num">Tore</th><th className="fui-num">Vorlagen</th><th className="fui-num">Gesamtpunkte</th></tr></thead>
                <tbody>{seasons.map((season) => (
                  <tr key={season.startYear} className={`clickable-row ${season.startYear === selectedYear ? "selected" : ""}`} tabIndex={0} onClick={() => onSeason(season.startYear)} onKeyDown={(event) => { if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); onSeason(season.startYear); } }}>
                    <td><strong>{season.season}</strong></td>
                    <td><span className="season-team-list">{season.teams.map((team) => <span key={team.id}><LogoTile code={team.code} url={team.logoUrl} /><button className="text-link" onClick={(event) => { event.stopPropagation(); onTeam(team.id); }}>{team.name}</button></span>)}</span></td>
                    <td>{season.league}</td>
                    <td className="fui-num">{season.appearances}</td>
                    <td className="fui-num">{season.gradedAppearances}</td>
                    <td className="fui-num">{season.goals}</td>
                    <td className="fui-num">{season.assists}</td>
                    <td className="fui-num fui-data-table__primary">{season.points}</td>
                  </tr>
                ))}</tbody>
                {seasons.length > 1 && <tfoot><tr>
                  <td colSpan={3}><strong>Gesamt im Archiv</strong></td>
                  <td className="fui-num">{seasons.reduce((sum, season) => sum + season.appearances, 0)}</td>
                  <td className="fui-num">{seasons.reduce((sum, season) => sum + season.gradedAppearances, 0)}</td>
                  <td className="fui-num">{seasons.reduce((sum, season) => sum + season.goals, 0)}</td>
                  <td className="fui-num">{seasons.reduce((sum, season) => sum + season.assists, 0)}</td>
                  <td className="fui-num fui-data-table__primary">{seasons.reduce((sum, season) => sum + season.points, 0)}</td>
                </tr></tfoot>}
              </table>
            </div>
          </section>
  );
}
