import { ResourcePanel } from "../../components/resource-panel";
import { OverviewBestEleven } from "../../components/best-eleven-card";
import { EntityLink } from "../../components/entity-link";
import { useCallback } from "react";
import { PlayerPortrait, positionName } from "../../components/player-identity";
import { useResource } from "../../hooks/use-resource";
import { api } from "../../lib/data/api";
import type { Filters } from "../../lib/navigation/scope";
import type { Dashboard, Player } from "../../types/models";
import { formatCardCounts } from "../../utils/format";

export function MatchdayReport({ filters, round, onPlayer }: { filters: Filters; round: number; onPlayer: (id: string) => void }) {
  const resource = useResource(useCallback(
    (signal: AbortSignal) => api.dashboard(new URLSearchParams({ league: filters.league, season: filters.season, round: String(round) }), signal),
    [filters.league, filters.season, round],
  ));
  return <section className="tabelle-block matchday-report">
    <div className="section-copy"><p className="fui-kicker">Spieltag {round} · Noten und Ranglisten</p><h2>Spieltag kompakt</h2></div>
    <div className="report-top">
      <ResourcePanel resource={resource} label="Spieltag-Wertungen">{dashboard => <ReportData dashboard={dashboard} round={round} onPlayer={onPlayer} section="side" />}</ResourcePanel>
      <OverviewBestEleven league={filters.league} season={filters.season} round={round} scope="matchday" onPlayer={onPlayer} />
    </div>
    <ResourcePanel resource={resource} label="Saison-Ranglisten">{dashboard => <ReportData dashboard={dashboard} round={round} onPlayer={onPlayer} section="lists" />}</ResourcePanel>
  </section>;
}

function ReportData({dashboard, round, onPlayer, section}: {dashboard: Dashboard; round: number; onPlayer: (id: string) => void; section: "side" | "lists"}) {
  const season = dashboard.leaderboards;
  const spotlight = dashboard.matchdayLeaderboards.grades[0];
  // kicker lists grade averages only for regulars: at least half of the matchdays so far.
  const minimumGraded = Math.max(1, Math.ceil(round / 2));
  const graded = season.grades.filter((player) => player.gradedMatches >= minimumGraded);
  const keepers = graded.filter((player) => player.position === "GK").slice(0, 8);
  const outfield = graded.filter((player) => player.position !== "GK").slice(0, 8);
  const scorers = [...new Map([...season.goals, ...season.assists].map((player) => [player.id, player])).values()]
    .sort((left, right) => right.goals + right.assists - (left.goals + left.assists) || right.goals - left.goals || left.name.localeCompare(right.name, "de"))
    .slice(0, 8);
  const sentOff = season.cardDeductions.slice(0, 5);
  return (
    <>
        {section === "side" && <div className="report-side">
          {spotlight && <div className="report-spotlight" onClick={() => onPlayer(spotlight.id)}>
            <span className="fui-kicker">Spieler des Tages</span>
            <PlayerPortrait name={spotlight.name} url={spotlight.photoUrl} teamCode={spotlight.teamCode} teamLogoUrl={spotlight.logoUrl} large />
            <strong><EntityLink kind="player" id={spotlight.id}>{spotlight.name}</EntityLink></strong>
            <small><EntityLink kind="team" id={spotlight.teamId}>{spotlight.team}</EntityLink> · {positionName[spotlight.position]}</small>
            <dl>
              <div><dt>Note</dt><dd>{spotlight.roundGrade?.toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 2 }) ?? "—"}</dd></div>
              <div><dt>Punkte</dt><dd>{spotlight.roundPoints}</dd></div>
              <div><dt>Tore</dt><dd>{spotlight.roundGoals}</dd></div>
              <div><dt>Vorl.</dt><dd>{spotlight.roundAssists}</dd></div>
            </dl>
          </div>}
          <div className="report-cards">
            <span className="fui-kicker">Platzverweise · Saison</span>
            {sentOff.length ? <ol>{sentOff.map((player) => <li key={player.id}><div className="entity-row" onClick={() => onPlayer(player.id)}><strong><EntityLink kind="player" id={player.id}>{player.name}</EntityLink></strong><small><EntityLink kind="team" id={player.teamId}>{player.team}</EntityLink> · {formatCardCounts(player.redCards, player.yellowRedCards)}</small></div></li>)}</ol> : <p>niemand</p>}
          </div>
        </div>}
      {section === "lists" && <div className="report-lists">
        <RankList title="Torschützen" note="Saison · in Klammern: dieser Spieltag" rows={season.goals.slice(0, 8).map((player) => ({ player, value: String(player.goals), extra: player.roundGoals ? `(+${player.roundGoals})` : "" }))} onPlayer={onPlayer} />
        <RankList title="Scorer" note="Tore + Vorlagen" rows={scorers.map((player) => ({ player, value: String(player.goals + player.assists), extra: `${player.goals}+${player.assists}` }))} onPlayer={onPlayer} />
        <RankList title="Top-Torhüter" note={`Notenschnitt · ab ${minimumGraded} benoteten Spielen`} rows={keepers.map((player) => ({ player, value: player.averageGrade!.toFixed(2).replace(".", ","), extra: `${player.gradedMatches} Sp.` }))} onPlayer={onPlayer} />
        <RankList title="Top-Feldspieler" note={`Notenschnitt · ab ${minimumGraded} benoteten Spielen`} rows={outfield.map((player) => ({ player, value: player.averageGrade!.toFixed(2).replace(".", ","), extra: `${player.gradedMatches} Sp.` }))} onPlayer={onPlayer} />
      </div>}
    </>
  );
}

function RankList({ title, note, rows, onPlayer }: { title: string; note: string; rows: { player: Player; value: string; extra: string }[]; onPlayer: (id: string) => void }) {
  return (
    <article className="rank-list dashboard-card">
      <header><h3>{title}</h3><span>{note}</span></header>
      {rows.length ? <ol>{rows.map(({ player, value, extra }, index) => (
        <li key={player.id}><div className="entity-row" onClick={() => onPlayer(player.id)}>
          <span className="rank">{index + 1}</span>
          <PlayerPortrait name={player.name} url={player.photoUrl} teamCode={player.teamCode} teamLogoUrl={player.logoUrl} />
          <span className="player-identity"><strong><EntityLink kind="player" id={player.id}>{player.name}</EntityLink></strong><small><EntityLink kind="team" id={player.teamId}>{player.team}</EntityLink></small></span>
          <span className="rank-list-value"><b>{value}</b><small>{extra}</small></span>
        </div></li>
      ))}</ol> : <p className="rank-list-empty">Noch keine Einträge.</p>}
    </article>
  );
}
