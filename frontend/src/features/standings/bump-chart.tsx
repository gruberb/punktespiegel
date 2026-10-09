import { CardHead } from "@gruberb/fun-ui";
import { useEffect, useRef, useState } from "react";
import type { LeagueStandings, LeagueTableRow } from "../../types/models";
import type { LeagueZone } from "./zones";

function defaultBumpSelection(standings: LeagueStandings) {
  const leader = standings.rows[0];
  if (!leader) return [];
  const climber = standings.rows.reduce((best, row) => ((row.trend ?? -Infinity) > (best.trend ?? -Infinity) ? row : best), leader);
  return climber.team.id !== leader.team.id && (climber.trend ?? 0) > 0
    ? [leader.team.id, climber.team.id]
    : [leader.team.id];
}

export function BumpChartCard({ standings, zones }: { standings: LeagueStandings; zones: LeagueZone[] }) {
  const rounds = standings.context.round;
  const teamCount = standings.rows.length;
  const [pinned, setPinned] = useState<string[]>(() => defaultBumpSelection(standings));
  const [hovered, setHovered] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const seasonKey = `${standings.context.league}:${standings.context.season}`;

  useEffect(() => {
    setPinned(defaultBumpSelection(standings));
  }, [seasonKey]);

  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollLeft = node.scrollWidth;
  }, [seasonKey]);

  function toggleTeam(teamId: string) {
    setPinned((current) => current.includes(teamId)
      ? current.filter((id) => id !== teamId)
      : [...current.slice(current.length >= 3 ? current.length - 2 : 0), teamId]);
  }

  const columnWidth = Math.max(24, Math.min(72, Math.floor(1010 / Math.max(1, rounds - 1))));
  const rowHeight = 27;
  const leftPad = 30;
  const labelGutter = 170;
  const topPad = 14;
  const bottomPad = 30;
  const width = leftPad + Math.max(1, rounds - 1) * columnWidth + labelGutter;
  const height = topPad + (teamCount - 1) * rowHeight + bottomPad;
  const x = (matchday: number) => leftPad + (matchday - 1) * columnWidth;
  const y = (rank: number) => topPad + (rank - 1) * rowHeight;
  const tickStep = columnWidth >= 34 ? 1 : columnWidth >= 28 ? 2 : 5;

  const emphasisClass = (teamId: string) => {
    const pinIndex = pinned.indexOf(teamId);
    return `${pinIndex >= 0 ? ` is-pinned pin-${pinIndex}` : ""}${hovered === teamId ? " is-hovered" : ""}`;
  };
  const paintOrder = [...standings.rows].sort((left, right) => {
    const weight = (row: LeagueTableRow) => (pinned.includes(row.team.id) ? 2 : 0) + (hovered === row.team.id ? 3 : 0);
    return weight(left) - weight(right);
  });
  const emphasized = standings.rows.filter((row) => pinned.includes(row.team.id) || hovered === row.team.id);

  return (
    <section className="detail-section bump-card">
      <CardHead eyebrow="Saisonverlauf" title="Platzierung je Spieltag" subtitle="Der Weg jedes Teams durch die Tabelle · antippen hebt bis zu drei Teams hervor" action={zones.length ? <div className="bump-legend" aria-hidden="true">{zones.map((zone) => <span key={zone.label}><i className={`bump-legend-swatch bump-zone-${zone.tone}`} />{zone.label}</span>)}</div> : undefined} />
      <div className="bump-scroll" ref={scrollRef}>
        <svg className="bump-chart" width={width} height={height} role="img" aria-label={`Platzierungsverlauf über ${rounds} Spieltage`}>
          {zones.filter((zone) => zone.from <= teamCount).map((zone) => (
            <rect key={zone.label} className={`bump-zone bump-zone-${zone.tone}`} x="0" y={y(zone.from) - rowHeight / 2 + 2} width={width - labelGutter + 62} height={(Math.min(zone.to, teamCount) - zone.from + 1) * rowHeight - 4} rx="6" />
          ))}
          {Array.from({ length: rounds }, (_, index) => index + 1).map((matchday) => (
            <g key={matchday}>
              <line className="bump-grid" x1={x(matchday)} y1={topPad - 6} x2={x(matchday)} y2={height - bottomPad + 8} />
              {(matchday % tickStep === 0 || matchday === 1 || matchday === rounds) && <text className="bump-tick" x={x(matchday)} y={height - 8} textAnchor="middle">{matchday}</text>}
            </g>
          ))}
          {paintOrder.map((row) => rounds === 1
            ? <circle key={row.team.id} className={`bump-line${emphasisClass(row.team.id)}`} cx={x(1)} cy={y(row.positions[0] ?? row.rank)} r="3.4" onMouseEnter={() => setHovered(row.team.id)} onMouseLeave={() => setHovered(null)} onClick={() => toggleTeam(row.team.id)} />
            : <polyline
                key={row.team.id}
                className={`bump-line${emphasisClass(row.team.id)}`}
                points={row.positions.map((rank, index) => `${x(index + 1)},${y(rank)}`).join(" ")}
                onMouseEnter={() => setHovered(row.team.id)}
                onMouseLeave={() => setHovered(null)}
                onClick={() => toggleTeam(row.team.id)}
              ><title>{row.team.name}</title></polyline>)}
          {emphasized.map((row) => row.positions.map((rank, index) => (
            <circle key={`${row.team.id}-${index}`} className={`bump-dot${emphasisClass(row.team.id)}`} cx={x(index + 1)} cy={y(rank)} r="3">
              <title>{`${row.team.name} · Spieltag ${index + 1}: Platz ${rank}`}</title>
            </circle>
          )))}
          {standings.rows.map((row) => (
            <g key={row.team.id} className={`bump-label${emphasisClass(row.team.id)}`} transform={`translate(${x(rounds) + 12}, ${y(row.rank)})`} onMouseEnter={() => setHovered(row.team.id)} onMouseLeave={() => setHovered(null)} onClick={() => toggleTeam(row.team.id)}>
              <rect className="bump-label-hit" x="-4" y={-rowHeight / 2} width={labelGutter - 10} height={rowHeight} fill="transparent" stroke="none" />
              <text className="bump-rank" x="0" y="3.5">{String(row.rank).padStart(2, "0")}</text>
              {row.team.logoUrl && <image href={row.team.logoUrl} x="22" y="-9" width="18" height="18" />}
              <text className="bump-code" x="46" y="3.5">{row.team.code}</text>
              <title>{row.team.name}</title>
            </g>
          ))}
          <text className="bump-tick bump-axis" x="4" y={height - 8} textAnchor="start">ST</text>
        </svg>
      </div>
    </section>
  );
}
