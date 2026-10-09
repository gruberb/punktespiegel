import { EntityLink } from "../../components/entity-link";
import { LogoTile } from "@gruberb/fun-ui";
import { useCallback } from "react";
import { Empty, ErrorState, LoadingState } from "../../components/feedback";
import { FixtureTiles } from "../../components/fixture-tiles";
import { PlayerName, PlayerPortrait, PositionTag, positionName } from "../../components/player-identity";
import { useResource } from "../../hooks/use-resource";
import { api } from "../../lib/data/api";
import type { Filters } from "../../lib/navigation/scope";
import type { MatchPlayer, MatchSide, Position } from "../../types/models";
import { formatFixtureSlot, lastName } from "../../utils/format";

export function MatchDetailView({ filters, matchId, backLabel, onBack, onPlayer, onTeam, onMatch }: { filters: Filters; matchId: string; backLabel: string; onBack: () => void; onPlayer: (id: string) => void; onTeam: (id: string) => void; onMatch: (id: string) => void }) {
  const { data: detail, error } = useResource(useCallback(
    (signal: AbortSignal) => api.match(matchId, new URLSearchParams({ league: filters.league, season: filters.season }), signal),
    [filters.league, filters.season, matchId],
  ));
  if (error) return <ErrorState message={error} />;
  if (!detail || detail.id !== matchId) return <LoadingState />;
  const { home, away } = detail;
  const played = detail.homeScore != null && detail.awayScore != null;
  const count = (side: MatchSide, pick: (player: MatchPlayer) => number) => side.players.reduce((sum, player) => sum + pick(player), 0);
  const formatGrade = (value: number | null) => value == null ? "—" : value.toFixed(2).replace(".", ",");
  const comparison: { label: string; home: number | null; away: number | null; text: (value: number | null) => string; lowerIsBetter?: boolean }[] = [
    { label: "Ø-Note", home: home.averageGrade, away: away.averageGrade, text: formatGrade, lowerIsBetter: true },
    { label: "Managerpunkte", home: home.points, away: away.points, text: (value) => String(value ?? 0) },
    { label: "Vorlagen", home: count(home, (player) => player.assists), away: count(away, (player) => player.assists), text: (value) => String(value ?? 0) },
    { label: "Eingesetzte Spieler", home: home.players.length, away: away.players.length, text: (value) => String(value ?? 0) },
    { label: "Platzverweise", home: count(home, (player) => player.card ? 1 : 0), away: count(away, (player) => player.card ? 1 : 0), text: (value) => String(value ?? 0), lowerIsBetter: true },
  ];
  const allPlayers = [...home.players.map((player) => ({ player, team: home.team })), ...away.players.map((player) => ({ player, team: away.team }))]
    .sort((left, right) => right.player.points - left.player.points || left.player.name.localeCompare(right.player.name, "de"));
  return (
    <section className="match-view">
      <button className="back-button" onClick={onBack}>← {backLabel}</button>
      <header className="match-hero fui-grid-paper">
        <p className="fui-kicker">{detail.leagueName} · {detail.season} · Spieltag {detail.round}{detail.scheduledAt ? ` · ${formatFixtureSlot(detail.scheduledAt)}` : ""}</p>
        <div className="match-scoreline">
          <button className="match-team home" onClick={() => onTeam(home.team.id)}><span><strong>{home.team.name}</strong>{home.rankAfter != null && <small>Platz {home.rankAfter} nach dem Spiel</small>}</span><LogoTile code={home.team.code} url={home.team.logoUrl} size="lg" /></button>
          <span className={`match-score ${played ? "" : "is-open"}`}>{played ? `${detail.homeScore} : ${detail.awayScore}` : "– : –"}</span>
          <button className="match-team" onClick={() => onTeam(away.team.id)}><LogoTile code={away.team.code} url={away.team.logoUrl} size="lg" /><span><strong>{away.team.name}</strong>{away.rankAfter != null && <small>Platz {away.rankAfter} nach dem Spiel</small>}</span></button>
        </div>
      </header>
      <nav aria-label="Weitere Spiele des Spieltags"><FixtureTiles matches={detail.roundMatches} currentId={detail.id} onMatch={onMatch} /></nav>
      {!played || !allPlayers.length ? <Empty message="Für dieses Spiel liegen noch keine Noten und Wertungen vor." /> : <>
        <div className="match-grid">
          <section className="match-lineup">
            <div className="section-copy"><p className="fui-kicker">Startelf · kicker-Noten</p><h2>Aufstellung</h2></div>
            <div className="match-pitch">
              <LineupHalf side={home} onPlayer={onPlayer} />
              <LineupHalf side={away} onPlayer={onPlayer} reversed />
            </div>
            <p className="match-legend"><span><i className="legend-goal" />Tor</span><span><b>V</b>Vorlage</span><span><b>★</b>Spieler des Spiels</span><span><i className="legend-card" />Platzverweis</span></p>
            <div className="match-subs">
              {[home, away].map((side) => (
                <div key={side.team.id}>
                  <h4>Eingewechselt · <EntityLink kind="team" id={side.team.id}>{side.team.code}</EntityLink></h4>
                  {side.players.filter((player) => !player.starter).length
                    ? <ul>{side.players.filter((player) => !player.starter).map((player) => <li key={player.id}><button onClick={() => onPlayer(player.id)}>{player.name}</button><span>{formatGrade(player.grade)}</span></li>)}</ul>
                    : <p>keine gewerteten Einwechslungen</p>}
                </div>
              ))}
            </div>
          </section>
          <aside className="match-aside">
            <div className="section-copy"><p className="fui-kicker">Mannschaften</p><h2>Vergleich</h2></div>
            <div className="match-compare">
              <header><span><EntityLink kind="team" id={home.team.id}>{home.team.code}</EntityLink></span><span><EntityLink kind="team" id={away.team.id}>{away.team.code}</EntityLink></span></header>
              {comparison.map((row) => {
                const total = Math.abs(row.home ?? 0) + Math.abs(row.away ?? 0);
                const homeShare = total ? Math.abs(row.home ?? 0) / total : .5;
                const homeLeads = row.home != null && row.away != null && row.home !== row.away && ((row.home < row.away) === Boolean(row.lowerIsBetter));
                const awayLeads = row.home != null && row.away != null && row.home !== row.away && !homeLeads;
                return (
                  <div className="compare-row" key={row.label}>
                    <b className={homeLeads ? "leads" : undefined}>{row.text(row.home)}</b>
                    <span>{row.label}</span>
                    <b className={awayLeads ? "leads" : undefined}>{row.text(row.away)}</b>
                    <i style={{ "--share": `${homeShare * 100}%` } as React.CSSProperties} />
                  </div>
                );
              })}
            </div>
            {detail.mvp && <div className="report-spotlight match-mvp" onClick={() => onPlayer(detail.mvp!.id)}>
              <span className="fui-kicker">Spieler des Spiels</span>
              <PlayerPortrait name={detail.mvp.name} url={detail.mvp.photoUrl} teamCode={detail.mvp.team.code} teamLogoUrl={detail.mvp.team.logoUrl} large />
              <strong><EntityLink kind="player" id={detail.mvp.id}>{detail.mvp.name}</EntityLink></strong>
              <small><EntityLink kind="team" id={detail.mvp.team.id}>{detail.mvp.team.name}</EntityLink> · {positionName[detail.mvp.position]}</small>
              <dl>
                <div><dt>Note</dt><dd>{formatGrade(detail.mvp.grade)}</dd></div>
                <div><dt>Punkte</dt><dd>{detail.mvp.points}</dd></div>
                <div><dt>Tore</dt><dd>{detail.mvp.goals}</dd></div>
                <div><dt>Vorl.</dt><dd>{detail.mvp.assists}</dd></div>
              </dl>
            </div>}
          </aside>
        </div>
        <section className="tabelle-block">
          <div className="section-copy"><p className="fui-kicker">kicker Manager-Liga</p><h2>Punkte des Spiels</h2></div>
          <div className="table-shell">
            <table>
              <thead><tr><th>Spieler</th><th>Position</th><th className="fui-num">Note</th><th className="fui-num">Tore</th><th className="fui-num">Vorl.</th><th>Rolle</th><th className="fui-num">Punkte</th></tr></thead>
              <tbody>{allPlayers.map(({ player, team }) => (
                <tr key={player.id} className="clickable-row" tabIndex={0} onClick={() => onPlayer(player.id)} onKeyDown={(event) => { if (event.key === "Enter") onPlayer(player.id); }}>
                  <td><span className="squad-player"><PlayerPortrait name={player.name} url={player.photoUrl} teamCode={team.code} teamLogoUrl={team.logoUrl} /><span><PlayerName name={player.name} /><small><EntityLink kind="team" id={team.id}>{team.name}</EntityLink></small></span></span></td>
                  <td><PositionTag position={player.position} /></td>
                  <td className="fui-num">{formatGrade(player.grade)}</td>
                  <td className="fui-num">{player.goals}</td>
                  <td className="fui-num">{player.assists}</td>
                  <td>{[player.starter ? "Startelf" : "Eingewechselt", player.mvp ? "Spieler des Spiels" : "", player.card ?? ""].filter(Boolean).join(" · ")}</td>
                  <td className="fui-num fui-data-table__primary">{player.points}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </section>
      </>}
    </section>
  );
}

function LineupHalf({ side, reversed = false, onPlayer }: { side: MatchSide; reversed?: boolean; onPlayer: (id: string) => void }) {
  const order: Position[] = reversed ? ["FWD", "MID", "DEF", "GK"] : ["GK", "DEF", "MID", "FWD"];
  const starters = side.players.filter((player) => player.starter);
  return (
    <div className={`pitch-half ${reversed ? "away" : "home"}`}>
      <span className="pitch-team"><LogoTile code={side.team.code} url={side.team.logoUrl} /><EntityLink kind="team" id={side.team.id}>{side.team.code}</EntityLink>{side.averageGrade != null && <small>Ø {side.averageGrade.toFixed(2).replace(".", ",")}</small>}</span>
      {order.map((position) => {
        const players = starters.filter((player) => player.position === position);
        return players.length ? <div className="pitch-row" key={position}>{players.map((player) => (
          <button key={player.id} className="pitch-player" onClick={() => onPlayer(player.id)} title={`${player.name} · Note ${player.grade?.toFixed(1) ?? "—"} · ${player.points} Punkte`}>
            <span className="pitch-name">{lastName(player.name)}</span>
            <span className="pitch-marks">
              <b className="pitch-grade">{player.grade == null ? "—" : player.grade.toLocaleString("de-DE", { maximumFractionDigits: 1 })}</b>
              {Array.from({ length: player.goals }, (_, index) => <i key={index} className="legend-goal" aria-label="Tor" />)}
              {player.assists > 0 && <b aria-label={`${player.assists} Vorlagen`}>V{player.assists > 1 ? player.assists : ""}</b>}
              {player.mvp && <b aria-label="Spieler des Spiels">★</b>}
              {player.card && <i className="legend-card" aria-label={player.card} />}
            </span>
          </button>
        ))}</div> : null;
      })}
    </div>
  );
}
