import { LogoTile, Popover, TabNavigation, usePopoverHover } from "@gruberb/fun-ui";
import { useEffect, useMemo, useRef, useState } from "react";
import type { TeamLeaders, TeamPlayerScore, TeamScore } from "../types/models";
import { positionName } from "./player-identity";

export type TeamMetric = "overall" | "goalkeeper" | "defence" | "midfield" | "forward";

export const teamMetrics: { key: TeamMetric; label: string; short: string; leaders: keyof TeamLeaders }[] = [
  { key: "overall", label: "Gesamt", short: "GES", leaders: "overall" },
  { key: "goalkeeper", label: "Torwart", short: "TW", leaders: "goalkeeper" },
  { key: "defence", label: "Abwehr", short: "ABW", leaders: "defence" },
  { key: "midfield", label: "Mittelfeld", short: "MIT", leaders: "midfield" },
  { key: "forward", label: "Sturm", short: "ST", leaders: "forward" },
];

export function TeamRanking({ teams, matchday, scope, onTeam, expanded = false }: { teams: TeamScore[]; matchday: number; scope: "through" | "matchday"; onTeam: (id: string) => void; expanded?: boolean }) {
  const [metric, setMetric] = useState<TeamMetric>("overall");
  const listRef = useRef<HTMLOListElement>(null);
  const sorted = useMemo(() => [...teams].sort((a, b) => b[metric] - a[metric]), [teams, metric]);
  const selectedMetric = teamMetrics.find((item) => item.key === metric) ?? teamMetrics[0];
  useEffect(() => { listRef.current?.scrollTo({ top: 0 }); }, [teams, metric, matchday, scope]);
  return (
    <>
      <TabNavigation className="card-tabs" ariaLabel="Mannschaftsmetrik" activeTab={metric} onTabChange={(id) => setMetric(id as TeamMetric)} tabs={teamMetrics.map((item) => ({ id: item.key, label: item.short }))} />
      <ol ref={listRef} className={`team-pulse-list ${expanded ? "expanded" : ""}`}>
        {sorted.map((team, index) => <TeamRankingRow key={team.id} team={team} index={index} metric={metric} selectedMetric={selectedMetric} matchday={matchday} scope={scope} onTeam={onTeam} />)}
      </ol>
    </>
  );
}

function TeamRankingRow({ team, index, metric, selectedMetric, matchday, scope, onTeam }: { team: TeamScore; index: number; metric: TeamMetric; selectedMetric: (typeof teamMetrics)[number]; matchday: number; scope: "through" | "matchday"; onTeam: (id: string) => void }) {
  const hover = usePopoverHover<HTMLLIElement>();
  return (
    <li ref={hover.ref} role="button" tabIndex={0} onClick={() => onTeam(team.id)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") onTeam(team.id); }} {...hover.handlers}>
      <span className="rank">{index + 1}</span>
      <LogoTile code={team.code} url={team.logoUrl} />
      <strong>{team.name}</strong>
      <span className="metric-number">{team[metric] || "—"} <small>Pkt.</small></span>
      <Popover anchorRef={hover.ref} open={hover.open} id={hover.id} preferredWidth={410}>
        <PlayerScoreList title={team.name} note={`${selectedMetric.label} · ${scope === "through" ? `bis Spieltag ${matchday}` : `nur Spieltag ${matchday}`}`} players={team.topPlayers[selectedMetric.leaders]} />
      </Popover>
    </li>
  );
}

function PlayerScoreList({ title, note, players }: { title: string; note: string; players: TeamPlayerScore[] }) {
  return <>
    <div className="fui-popover__header"><strong className="fui-popover__title">{title}</strong><span className="fui-popover__meta">{note}</span></div>
    <ol className="score-popover">{players.map((player, playerIndex) => <li key={player.id}><span>{playerIndex + 1}</span><strong>{player.name}</strong><small>{positionName[player.position]}</small><b>{player.points}</b></li>)}</ol>
  </>;
}

export function TeamMetricCell({ value, label, players, contextLabel = "Saisonpunkte" }: { value: number; label: string; players: TeamPlayerScore[]; contextLabel?: string }) {
  const hover = usePopoverHover<HTMLDivElement>();
  return (
    <div ref={hover.ref} className="team-metric-cell" tabIndex={0} {...hover.handlers}>
      <div className="team-score"><strong>{value || "—"}</strong><span>Pkt.</span></div>
      <Popover anchorRef={hover.ref} open={hover.open} id={hover.id} preferredWidth={315}>
        <PlayerScoreList title={label} note={contextLabel} players={players} />
      </Popover>
    </div>
  );
}
