import { LogoTile, Segmented } from "@gruberb/fun-ui";
import { useCallback, useEffect, useState } from "react";
import { ErrorState, LoadingState } from "../../components/feedback";
import { PlayerPortrait, positionName } from "../../components/player-identity";
import { useResource } from "../../hooks/use-resource";
import { api } from "../../lib/data/api";
import type { Filters } from "../../lib/navigation/scope";
import type { PlayerDetail, PlayerGame } from "../../types/models";
import { formatDate, formatEur, formatMarketValue, formatPlayerValue, formatSignedPoints, formatVenue } from "../../utils/format";
import { PlayerBioSection } from "./player-bio";
import { PlayerCareerSection } from "./player-career";
import { PlayerNewsSection } from "./player-news";

const availabilityStatusName: Record<NonNullable<PlayerDetail["availability"]>["status"], string> = {
  injured: "Verletzt",
  rehab: "Aufbautraining",
  suspended: "Gesperrt",
  not_considered: "Nicht berücksichtigt",
  unavailable: "Nicht verfügbar",
};

export function PlayerDetailView({ filters, playerId, backLabel, onBack, onTeam, onSeason }: { filters: Filters; playerId: string; backLabel: string; onBack: () => void; onTeam: (id: string) => void; onSeason: (year: number) => void }) {
  const [activeTab, setActiveTab] = useState<"profile" | "points">("points");
  useEffect(() => setActiveTab("points"), [playerId]);
  const { data: detail, error, loading } = useResource(useCallback(
    (signal: AbortSignal) => api.player(playerId, new URLSearchParams({ league: filters.league, season: filters.season }), signal),
    [filters.league, filters.season, playerId],
  ));
  if (error) return <ErrorState message={error} />;
  if (loading || !detail) return <LoadingState />;
  return (
    <section className="detail-section player-detail-section">
      <button className="back-button" onClick={onBack}>← {backLabel}</button>
      <header className="player-profile fui-grid-paper">
        <PlayerPortrait name={detail.name} url={detail.photoUrl} teamCode={detail.teamCode} teamLogoUrl={detail.logoUrl} large />
        <div className="profile-copy"><p className="fui-kicker">{positionName[detail.position]}</p><h2>{detail.name}</h2><div className="profile-context"><button className="profile-team-link" onClick={() => onTeam(detail.teamId)}>{detail.team}</button><span>{detail.league} · {detail.season}</span></div><div className="profile-links"><a href={detail.kickerUrl} target="_blank" rel="noreferrer">kicker-Profil ↗</a>{detail.ligaInsiderUrl && <a href={detail.ligaInsiderUrl} target="_blank" rel="noreferrer">LigaInsider ↗</a>}<a href={detail.transfermarktUrl} target="_blank" rel="noreferrer">Transfermarkt ↗</a></div></div>
        <div className="profile-stats">
          <span><strong>{detail.seasonPoints}</strong><small>Saisonpunkte</small></span>
          {detail.bio?.marketValue?.eur != null
            ? <span><strong>{formatEur(detail.bio.marketValue.eur)}</strong><small>Marktwert · Transfermarkt</small></span>
            : <span><strong>{formatMarketValue(detail.priceM)}</strong><small>Marktwert · kicker</small></span>}
          <span><strong>{formatPlayerValue(detail.value)}</strong><small>Wert · Pkt. / Mio. €</small></span>
        </div>
      </header>
      <Segmented role="tablist" className="profile-tabs" ariaLabel="Spielerprofil-Bereiche" value={activeTab} onChange={(value) => setActiveTab(value as typeof activeTab)} options={[
        { value: "points", label: "Punkte & Spiele", id: "player-points-tab", controls: "player-points-panel" },
        { value: "profile", label: "Profil & Karriere", id: "player-profile-tab", controls: "player-profile-panel" },
      ]} />
      {activeTab === "profile" && (
        <div className="player-tab-panel" id="player-profile-panel" role="tabpanel" aria-labelledby="player-profile-tab">
          {detail.bio && <PlayerBioSection bio={detail.bio} seasonStartYear={detail.startYear} />}
          {detail.availability && (
            <aside className={`availability-alert ${detail.availability.status}`}>
              <div><p className="fui-kicker">Aktueller Verfügbarkeitsstatus</p><strong>{availabilityStatusName[detail.availability.status]}{detail.availability.reason ? ` · ${detail.availability.reason}` : ""}</strong><small>{detail.availability.absentSince ? `Fehlt seit ${detail.availability.absentSince}. ` : ""}{detail.availability.expectedReturn ? `Erwartete Rückkehr: ${formatDate(detail.availability.expectedReturn)}.` : "Kein bestätigtes Rückkehrdatum."}</small></div>
              <a href={detail.availability.sourceUrl} target="_blank" rel="noreferrer">{detail.availability.source} · Stand {formatDate(detail.availability.generatedAt)} ↗</a>
            </aside>
          )}
          <PlayerNewsSection news={detail.news} kickerNewsUrl={detail.kickerNewsUrl} kickerNewsDirect={detail.kickerNewsDirect} />
          {detail.career && (detail.career.clubs.length > 0 || detail.career.seasons.length > 0) && <PlayerCareerSection career={detail.career} />}
        </div>
      )}
      {activeTab === "points" && (
        <div className="player-tab-panel" id="player-points-panel" role="tabpanel" aria-labelledby="player-points-tab">
          <section className="player-seasons">
            <div className="section-copy"><h3>Punkte nach Saison</h3><p>Verein, Einsätze, Tore und benotete Spiele je Saison im Archiv.</p></div>
            <div className="table-shell player-season-table">
              <table><thead><tr><th>Jahr</th><th>Verein</th><th>Liga</th><th className="fui-num">Einsätze</th><th className="fui-num">Benotet</th><th className="fui-num">Tore</th><th className="fui-num">Vorlagen</th><th className="fui-num">Gesamtpunkte</th></tr></thead>
                <tbody>{detail.seasons.map((season) => (
                  <tr key={season.startYear} className={`clickable-row ${season.startYear === detail.startYear ? "selected" : ""}`} tabIndex={0} onClick={() => onSeason(season.startYear)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") onSeason(season.startYear); }}>
                    <td><strong>{season.season}</strong></td>
                    <td><span className="season-team-list">{season.teams.map((team) => <span key={team.id}><LogoTile code={team.code} url={team.logoUrl} /><strong>{team.name}</strong></span>)}</span></td>
                    <td>{season.league}</td>
                    <td className="fui-num">{season.appearances}</td>
                    <td className="fui-num">{season.gradedAppearances}</td>
                    <td className="fui-num">{season.goals}</td>
                    <td className="fui-num">{season.assists}</td>
                    <td className="fui-num fui-data-table__primary">{season.points}</td>
                  </tr>
                ))}</tbody>
                {detail.seasons.length > 1 && <tfoot><tr>
                  <td colSpan={3}><strong>Gesamt im Archiv</strong></td>
                  <td className="fui-num">{detail.seasons.reduce((sum, season) => sum + season.appearances, 0)}</td>
                  <td className="fui-num">{detail.seasons.reduce((sum, season) => sum + season.gradedAppearances, 0)}</td>
                  <td className="fui-num">{detail.seasons.reduce((sum, season) => sum + season.goals, 0)}</td>
                  <td className="fui-num">{detail.seasons.reduce((sum, season) => sum + season.assists, 0)}</td>
                  <td className="fui-num fui-data-table__primary">{detail.seasons.reduce((sum, season) => sum + season.points, 0)}</td>
                </tr></tfoot>}
              </table>
            </div>
          </section>
          <div className="section-copy"><p className="fui-kicker">Saisonverlauf</p><h3>Jeder Einsatz und jede Punkteaktion</h3></div>
          <div className="table-shell game-table">
            <table><thead><tr><th>Spieltag</th><th>Datum</th><th>Gegner</th><th>Ergebnis</th><th className="fui-num">Punkte</th><th className="fui-num">Note</th><th className="fui-num">Tore</th><th className="fui-num">Vorlagen</th><th className="fui-num">Zu null</th><th className="fui-num">Startelf</th><th className="fui-num">Karten</th><th className="fui-num">SdS</th><th className="fui-num">Joker</th></tr></thead>
              <tbody>{detail.games.map((game) => <GameRow key={game.matchday} game={game} onTeam={onTeam} />)}</tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}

function GameRow({ game, onTeam }: { game: PlayerGame; onTeam: (id: string) => void }) {
  const result = game.homeScore == null || game.awayScore == null ? "—" : `${game.homeScore}–${game.awayScore}`;
  return (
    <tr>
      <td><strong>{game.matchday}</strong></td>
      <td>{formatDate(game.scheduledAt)}</td>
      <td><button className="opponent" onClick={() => onTeam(game.opponentId)}><LogoTile code={game.opponentCode} url={game.opponentLogoUrl} /><span><strong>{game.opponent}</strong><small>{formatVenue(game.venue)}</small></span></button></td>
      <td>{result}</td>
      <td className="fui-num"><ActionValue points={game.points} /></td>
      <td className="fui-num"><ActionValue value={game.grade?.toFixed(2) ?? "Keine Note"} points={game.pointsGrade} /></td>
      <td className="fui-num"><ActionValue value={`${game.goals} ${game.goals === 1 ? "Tor" : "Tore"}`} points={game.pointsGoals} /></td>
      <td className="fui-num"><ActionValue value={`${game.assists} ${game.assists === 1 ? "Vorlage" : "Vorlagen"}`} points={game.pointsAssists} /></td>
      <td className="fui-num"><ActionValue points={game.pointsCleanSheet} /></td>
      <td className="fui-num"><ActionValue points={game.pointsStarter} /></td>
      <td className="fui-num"><CardActionValue points={game.pointsCards} /></td>
      <td className="fui-num"><ActionValue points={game.pointsMvp} /></td>
      <td className="fui-num"><ActionValue points={game.pointsJoker} /></td>
    </tr>
  );
}

function ActionValue({ value, points }: { value?: string | number; points: number }) {
  return <span className="action-value">
    <span className="action-point-total"><strong className={points < 0 ? "negative" : ""}>{formatSignedPoints(points)}</strong><small>Pkt.</small></span>
    {value != null && <small className="action-detail">{value}</small>}
  </span>;
}

function CardActionValue({ points }: { points: number }) {
  const label = points === -3 ? "Gelb-Rot" : points === -6 ? "Rot" : points < 0 ? "Platzverweis" : "—";
  return <ActionValue value={points < 0 ? label : undefined} points={points} />;
}
