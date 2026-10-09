import type { PlayerDetail } from "../../types/models";
import { formatDate, formatSeason } from "../../utils/format";

export function PlayerCareerSection({ career }: { career: NonNullable<PlayerDetail["career"]> }) {
  const clubs = [...career.clubs].sort((left, right) => right.appearances - left.appearances || left.name.localeCompare(right.name, "de"));
  const seasons = [...career.seasons].sort((left, right) => right.seasonStartYear - left.seasonStartYear
    || left.name.localeCompare(right.name, "de")
    || left.competition.localeCompare(right.competition, "de"));
  const totals = clubs.reduce((result, club) => ({
    appearances: result.appearances + club.appearances,
    goals: result.goals + club.goals,
    assists: result.assists + club.assists,
  }), { appearances: 0, goals: 0, assists: 0 });
  const rows = seasons.length > 0 ? seasons : clubs.map((club) => ({
    ...club,
    seasonStartYear: null,
    competitionId: "",
    competition: "Alle Wettbewerbe",
    competitionUrl: null,
  }));
  return (
    <section className="player-career" aria-label="Karrierestationen">
      <div className="section-copy news-heading">
        <div><h3>Leistungsdaten nach Verein</h3><p>Einsätze, Tore und Vorlagen je Verein, Saison und Wettbewerb.</p></div>
        <div className="news-actions"><span>{career.provider} · Stand {formatDate(career.generatedAt)}</span><a href={career.tmUrl} target="_blank" rel="noreferrer">Profil öffnen ↗</a></div>
      </div>
      <div className="table-shell career-table">
        <table>
          <thead><tr><th>Verein</th><th>Saison</th><th>Wettbewerb</th><th className="fui-num">Einsätze</th><th className="fui-num">Tore</th><th className="fui-num">Vorlagen</th></tr></thead>
          <tbody>{rows.map((row) => (
            <tr key={`${row.clubId}-${row.seasonStartYear ?? "all"}-${row.competitionId}`}>
              <td><strong>{row.tmUrl ? <a href={row.tmUrl} target="_blank" rel="noreferrer">{row.name} ↗</a> : row.name}</strong></td>
              <td>{row.seasonStartYear == null ? "Gesamt" : formatSeason(row.seasonStartYear)}</td>
              <td>{row.competitionUrl ? <a href={row.competitionUrl} target="_blank" rel="noreferrer">{row.competition} ↗</a> : row.competition}</td>
              <td className="fui-num">{row.appearances}</td>
              <td className="fui-num">{row.goals}</td>
              <td className="fui-num">{row.assists}</td>
            </tr>
          ))}</tbody>
          <tfoot><tr><td colSpan={3}><strong>Gesamt</strong></td><td className="fui-num">{totals.appearances}</td><td className="fui-num">{totals.goals}</td><td className="fui-num">{totals.assists}</td></tr></tfoot>
        </table>
      </div>
    </section>
  );
}
