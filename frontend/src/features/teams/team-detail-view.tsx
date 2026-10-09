import { CardHead, LogoTile, Segmented } from "@gruberb/fun-ui";
import { useCallback, useEffect, useState } from "react";
import { Empty, ErrorState, LoadingState } from "../../components/feedback";
import { positionName } from "../../components/player-identity";
import { useResource } from "../../hooks/use-resource";
import { api } from "../../lib/data/api";
import type { Filters } from "../../lib/navigation/scope";
import { formatDate, formatDateWithYear, formatEur } from "../../utils/format";
import { TeamMatchCard } from "./team-matches";
import { TeamLikelyEleven, TeamSquadByPosition } from "./team-squad";
import { TeamTransferLedger } from "./team-transfers";

type TeamTab = "matches" | "squad" | "transfers";

export function TeamDetailView({ filters, teamId, backLabel, onBack, onPlayer, onTeam, onMatch }: { filters: Filters; teamId: string; backLabel: string; onBack: () => void; onPlayer: (id: string) => void; onTeam: (id: string) => void; onMatch: (id: string) => void }) {
  const [tab, setTab] = useState<TeamTab>("matches");
  useEffect(() => setTab("matches"), [teamId]);
  const { data: detail, error, loading } = useResource(useCallback(
    (signal: AbortSignal) => api.team(teamId, new URLSearchParams({ league: filters.league, season: filters.season }), signal),
    [filters.league, filters.season, teamId],
  ));
  if (error) return <ErrorState message={error} />;
  if (loading || !detail) return <LoadingState />;
  const totalPoints = detail.matches.reduce((sum, match) => sum + match.totalPoints, 0);
  const positionTotals: { label: string; value: number }[] = [
    { label: "Torwart", value: detail.matches.reduce((sum, match) => sum + match.goalkeeperPoints, 0) },
    { label: "Abwehr", value: detail.matches.reduce((sum, match) => sum + match.defencePoints, 0) },
    { label: "Mittelfeld", value: detail.matches.reduce((sum, match) => sum + match.midfieldPoints, 0) },
    { label: "Sturm", value: detail.matches.reduce((sum, match) => sum + match.forwardPoints, 0) },
  ];
  const strongestPart = [...positionTotals].sort((left, right) => right.value - left.value)[0];
  const profile = detail.profile;
  const squadValues = profile ? Object.values(profile.squad).map((member) => member.marketValue?.eur).filter((value): value is number => value != null) : [];
  const squadTotalValue = squadValues.length ? squadValues.reduce((sum, value) => sum + value, 0) : null;
  const squadAges = profile ? Object.values(profile.squad).map((member) => member.age).filter((value): value is number => value != null) : [];
  const averageAge = squadAges.length ? squadAges.reduce((sum, value) => sum + value, 0) / squadAges.length : null;
  const captain = profile?.captainPlayerId ? detail.players.find((player) => player.id === profile.captainPlayerId) : null;
  return (
    <div className="team-detail-view">
      <section className="detail-section team-detail-section">
        <button className="back-button" onClick={onBack}>← {backLabel}</button>
        <header className="team-profile fui-grid-paper">
          <LogoTile code={detail.code} url={detail.logoUrl} size="lg" />
          <div><p className="fui-kicker">Mannschaftsprofil</p><h2>{detail.name}</h2><span>Alle Wertungen der ausgewählten Saison</span></div>
          <div className="team-profile-stats"><span><strong>{totalPoints}</strong><small>Gesamtpunkte</small></span><span><strong>{detail.players.length}</strong><small>Kaderspieler</small></span><span><strong>{strongestPart.label}</strong><small>Stärkster Mannschaftsteil</small></span></div>
        </header>
        {profile && (
          <div className="club-facts" aria-label="Vereinsdaten">
            {profile.coach && <span><small>Trainer</small><strong><a href={profile.coach.tmUrl} target="_blank" rel="noreferrer">{profile.coach.name}</a></strong><em>{profile.coach.appointedAt ? `seit ${formatDateWithYear(profile.coach.appointedAt)}` : profile.coach.nationalities[0] ?? ""}</em></span>}
            {captain && <span><small>Kapitän</small><strong><button className="club-fact-link" onClick={() => onPlayer(captain.id)}>{captain.name}</button></strong><em>{positionName[captain.position]}</em></span>}
            {squadTotalValue != null && <span><small>Marktwert Kader</small><strong>{formatEur(squadTotalValue)}</strong><em>{squadValues.length} Spieler bewertet</em></span>}
            {averageAge != null && <span><small>Ø Alter</small><strong>{averageAge.toLocaleString("de-DE", { maximumFractionDigits: 1 })}</strong><em>Jahre</em></span>}
            <span className="club-facts-source"><small>Quelle</small><strong><a href={profile.transfermarktUrl} target="_blank" rel="noreferrer">Transfermarkt ↗</a></strong><em>Stand {formatDate(profile.generatedAt)}</em></span>
          </div>
        )}
        <Segmented role="tablist" className="profile-tabs" ariaLabel="Mannschaftsprofil-Bereiche" value={tab} onChange={(value) => setTab(value as TeamTab)}
          options={([["matches", "Spiele"], ["squad", "Kader"], ["transfers", "Transfers"]] as [TeamTab, string][]).map(([id, label]) => ({ value: id, label, id: `team-${id}-tab`, controls: `team-${id}-panel` }))} />
        {tab === "matches" && <div className="player-tab-panel" id="team-matches-panel" role="tabpanel" aria-labelledby="team-matches-tab">
          <section className="team-season-summary">
            <CardHead eyebrow="Saisonverlauf" title="Jedes Spiel im Detail" subtitle="Punkte nach Mannschaftsteil und Aktion" />
            <div className="team-match-list">
              {detail.matches.map((match) => <TeamMatchCard key={match.matchday} match={match} onTeam={onTeam} onPlayer={onPlayer} onMatch={onMatch} />)}
            </div>
          </section>
        {detail.externalSources && (
          <section className="player-news team-source-news" aria-labelledby="team-news-title">
            <div className="section-copy news-heading">
              <div><p className="fui-kicker">Medienbeobachtung</p><h3 id="team-news-title">Aktuelle Mannschaftsthemen</h3></div>
              <div className="news-actions"><span>Quellenstand {formatDate(detail.externalSources.generatedAt)}</span><a href={detail.externalSources.ligaInsiderUrl} target="_blank" rel="noreferrer">LigaInsider ↗</a><a href={detail.externalSources.transfermarktUrl} target="_blank" rel="noreferrer">Transfermarkt ↗</a></div>
            </div>
            <ol className="news-list">{detail.externalSources.headlines.map((article) => <li key={article.url}><a href={article.url} target="_blank" rel="noreferrer"><span><b>{article.source}</b></span><strong>{article.title}</strong><small>ligainsider.de ↗</small></a></li>)}</ol>
          </section>
        )}
        </div>}
        {tab === "squad" && <div className="player-tab-panel" id="team-squad-panel" role="tabpanel" aria-labelledby="team-squad-tab">
          <TeamSquadByPosition detail={detail} onPlayer={onPlayer} />
          {detail.likelyEleven && <TeamLikelyEleven eleven={detail.likelyEleven} teamCode={detail.code} teamLogoUrl={detail.logoUrl} onPlayer={onPlayer} />}
        </div>}
        {tab === "transfers" && <div className="player-tab-panel" id="team-transfers-panel" role="tabpanel" aria-labelledby="team-transfers-tab">
          {profile && (profile.arrivals.length > 0 || profile.departures.length > 0)
            ? <TeamTransferLedger profile={profile} />
            : <Empty message="Für diese Saison sind keine Transfers erfasst." />}
        </div>}
      </section>
    </div>
  );
}
