import { LogoTile, Segmented } from "@gruberb/fun-ui";
import { useCallback, useState } from "react";
import { ResourcePanel } from "../../components/resource-panel";
import { PlayerPortrait, positionName } from "../../components/player-identity";
import { useResource } from "../../hooks/use-resource";
import { api } from "../../lib/data/api";
import type { Filters } from "../../lib/navigation/scope";
import type { PlayerDetail, PlayerGame } from "../../types/models";
import { formatDate, formatEur, formatMarketValue, formatPlayerValue, formatSignedPoints, formatVenue } from "../../utils/format";
import { PlayerBioSection } from "./player-bio";
import { PlayerCareerSection } from "./player-career";
import { PlayerSeasons } from "./player-seasons";
import { PlayerNewsSection } from "./player-news";

const availabilityStatusName: Record<NonNullable<PlayerDetail["availability"]>["status"], string> = {
  injured: "Verletzt",
  rehab: "Aufbautraining",
  suspended: "Gesperrt",
  not_considered: "Nicht berücksichtigt",
  unavailable: "Nicht verfügbar",
};

export function PlayerDetailView({ filters, playerId, backLabel, onBack, onTeam, onSeason, onMatch }: { filters: Filters; playerId: string; backLabel: string; onBack: () => void; onTeam: (id: string) => void; onSeason: (year: number) => void; onMatch: (id: string) => void }) {
  const [activeTab, setActiveTab] = useState<"profile" | "points">("points");
  const seasonResource = useResource(useCallback(
    (signal: AbortSignal) => api.playerSeason(playerId, new URLSearchParams({ league: filters.league, season: filters.season }), signal),
    [filters.league, filters.season, playerId],
  ));
  const profile = useResource(useCallback(
    (signal: AbortSignal) => api.playerProfile(playerId, new URLSearchParams({ league: filters.league, season: filters.season }), signal),
    [filters.league, filters.season, playerId],
  ));
  return (
    <section className="detail-section player-detail-section">
      <button className="back-button" onClick={onBack}>← {backLabel}</button>
      <ResourcePanel resource={seasonResource} label="Spielerprofil" identity={playerId} feedback="quiet">{detail => <header className="player-profile fui-grid-paper">
        <PlayerPortrait name={detail.name} url={detail.photoUrl} teamCode={detail.teamCode} teamLogoUrl={detail.logoUrl} large />
        <div className="profile-copy"><p className="fui-kicker">{positionName[detail.position]}</p><h2>{detail.name}</h2><div className="profile-context"><button className="profile-team-link" onClick={() => onTeam(detail.teamId)}>{detail.team}</button><span>{detail.league} · {detail.season}</span></div><div className="profile-links"><a href={detail.kickerUrl} target="_blank" rel="noreferrer">kicker-Profil ↗</a>{profile.data?.ligaInsiderUrl && <a href={profile.data?.ligaInsiderUrl} target="_blank" rel="noreferrer">LigaInsider ↗</a>}<a href={profile.data?.transfermarktUrl ?? `https://www.transfermarkt.de/schnellsuche/ergebnis/schnellsuche?query=${encodeURIComponent(detail.name)}`} target="_blank" rel="noreferrer">Transfermarkt ↗</a></div></div>
        <div className="profile-stats">
          <span><strong>{detail.seasonPoints}</strong><small>Saisonpunkte</small></span>
          {profile.data?.bio?.marketValue?.eur != null
            ? <span><strong>{formatEur(profile.data.bio.marketValue.eur)}</strong><small>Marktwert · Transfermarkt</small></span>
            : <span><strong>{formatMarketValue(detail.priceM)}</strong><small>Marktwert · kicker</small></span>}
          <span><strong>{formatPlayerValue(detail.value)}</strong><small>Wert · Pkt. / Mio. €</small></span>
        </div>
      </header>}</ResourcePanel>
      <Segmented role="tablist" className="profile-tabs" ariaLabel="Spielerprofil-Bereiche" value={activeTab} onChange={(value) => setActiveTab(value as typeof activeTab)} options={[
        { value: "points", label: "Punkte & Spiele", id: "player-points-tab", controls: "player-points-panel" },
        { value: "profile", label: "Profil & Karriere", id: "player-profile-tab", controls: "player-profile-panel" },
      ]} />
      {activeTab === "profile" && (
        <div className="player-tab-panel" id="player-profile-panel" role="tabpanel" aria-labelledby="player-profile-tab">
          <ResourcePanel resource={profile} label="Profil & Karriere" identity={playerId}>{profileData => <>
          {profileData?.bio && <PlayerBioSection bio={profileData.bio} seasonStartYear={Number(filters.season)} />}
          {profileData?.availability && (
            <aside className={`availability-alert ${profileData.availability.status}`}>
              <div><p className="fui-kicker">Aktueller Verfügbarkeitsstatus</p><strong>{availabilityStatusName[profileData.availability.status]}{profileData.availability.reason ? ` · ${profileData.availability.reason}` : ""}</strong><small>{profileData.availability.absentSince ? `Fehlt seit ${profileData.availability.absentSince}. ` : ""}{profileData.availability.expectedReturn ? `Erwartete Rückkehr: ${formatDate(profileData.availability.expectedReturn)}.` : "Kein bestätigtes Rückkehrdatum."}</small></div>
              <a href={profileData.availability.sourceUrl} target="_blank" rel="noreferrer">{profileData.availability.source} · Stand {formatDate(profileData.availability.generatedAt)} ↗</a>
            </aside>
          )}
          {profileData && <PlayerNewsSection news={profileData.news} kickerNewsUrl={profileData.kickerNewsUrl} kickerNewsDirect={profileData.kickerNewsDirect} />}
          {profileData?.career && (profileData.career.clubs.length > 0 || profileData.career.seasons.length > 0) && <PlayerCareerSection career={profileData.career} />}
          </>}</ResourcePanel>
        </div>
      )}
      {activeTab === "points" && (
        <div className="player-tab-panel" id="player-points-panel" role="tabpanel" aria-labelledby="player-points-tab">
          <PlayerSeasons playerId={playerId} selectedYear={Number(filters.season)} onSeason={onSeason} onTeam={onTeam} />
          <div className="section-copy"><p className="fui-kicker">Saisonverlauf</p><h3>Jeder Einsatz und jede Punkteaktion</h3></div>
          <ResourcePanel resource={seasonResource} label="Saisonverlauf" identity={playerId}>{season => <div className="table-shell game-table">
            <table><thead><tr><th>Spieltag</th><th>Datum</th><th>Gegner</th><th>Ergebnis</th><th className="fui-num">Punkte</th><th className="fui-num">Note</th><th className="fui-num">Tore</th><th className="fui-num">Vorlagen</th><th className="fui-num">Zu null</th><th className="fui-num">Startelf</th><th className="fui-num">Karten</th><th className="fui-num">SdS</th><th className="fui-num">Joker</th></tr></thead>
              <tbody>{season.games.map((game) => <GameRow key={game.matchId} game={game} onTeam={onTeam} onMatch={onMatch} />)}</tbody>
            </table>
          </div>}</ResourcePanel>
        </div>
      )}
    </section>
  );
}

function GameRow({ game, onTeam, onMatch }: { game: PlayerGame; onTeam: (id: string) => void; onMatch: (id: string) => void }) {
  const result = game.homeScore == null || game.awayScore == null ? "—" : `${game.homeScore}–${game.awayScore}`;
  return (
    <tr>
      <td><strong>{game.matchday}</strong></td>
      <td>{formatDate(game.scheduledAt)}</td>
      <td><button className="opponent" onClick={() => onTeam(game.opponentId)}><LogoTile code={game.opponentCode} url={game.opponentLogoUrl} /><span><strong>{game.opponent}</strong><small>{formatVenue(game.venue)}</small></span></button></td>
      <td><button className="text-link" onClick={() => onMatch(game.matchId)} aria-label={`Spieltag ${game.matchday}: Spielbericht öffnen`}>{result}</button></td>
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
