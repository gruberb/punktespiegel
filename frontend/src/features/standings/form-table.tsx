import type { DataTableColumn } from "@gruberb/fun-ui";
import { DataTable, FormChip, FormChips, LogoTile, Segmented, TrendBadge, usePopoverHover } from "@gruberb/fun-ui";
import { useMemo, useState } from "react";
import { MatchPopover } from "../../components/match-popover";
import type { LeagueStandings, LeagueTableFormEntry, LeagueTableRow, LeagueTableTeam, VenueTableRow } from "../../types/models";
import { formOutcome } from "../../utils/football";
import { zoneForRank } from "./zones";

type FormTableSort = "rank" | "form" | "difference";

export function FormTableCard({ standings, league, onTeam }: { standings: LeagueStandings; league: string; onTeam: (id: string) => void }) {
  const [venue, setVenue] = useState<"all" | "home" | "away">("all");
  const [sort, setSort] = useState<FormTableSort>("rank");
  const [direction, setDirection] = useState<"asc" | "desc">("asc");

  const rows = useMemo(() => {
    const sorted = [...standings.rows];
    if (sort === "form") sorted.sort((left, right) => right.formPoints - left.formPoints || left.rank - right.rank);
    if (sort === "difference") sorted.sort((left, right) => right.goalDifference - left.goalDifference || left.rank - right.rank);
    if ((sort === "rank") === (direction === "desc")) sorted.reverse();
    return sorted;
  }, [standings.rows, sort, direction]);

  function sortBy(column: FormTableSort) {
    if (column === sort) setDirection((value) => value === "asc" ? "desc" : "asc");
    else {
      setSort(column);
      setDirection(column === "rank" ? "asc" : "desc");
    }
  }

  const sortProps = (column: FormTableSort) => ({ active: sort === column, direction, onSort: () => sortBy(column) });
  const columns: DataTableColumn<LeagueTableRow>[] = [
    { id: "rank", label: "Platz", shortLabel: "#", sort: sortProps("rank"), render: (row) => { const zone = zoneForRank(league, row.rank); return <span className={`tabelle-rank${zone ? ` tabelle-rank-${zone.tone}` : ""}`} title={zone?.label}>{row.rank}</span>; } },
    { id: "trend", label: "Trend", shortLabel: "±", render: (row) => <TrendBadge trend={row.trend} title={trendTitle(row.trend)} /> },
    { id: "team", label: "Verein", width: "24%", render: (row) => <div className="table-team tabelle-team"><LogoTile code={row.team.code} url={row.team.logoUrl} /><span><strong><span className="player-name-full">{row.team.name}</span><span className="player-name-short">{row.team.code}</span></strong></span></div> },
    { id: "played", label: "Spiele", shortLabel: "Sp", numeric: true, render: (row) => row.played },
    { id: "wins", label: "S", numeric: true, render: (row) => row.wins },
    { id: "draws", label: "U", numeric: true, render: (row) => row.draws },
    { id: "losses", label: "N", numeric: true, render: (row) => row.losses },
    { id: "goals", label: "Tore", numeric: true, render: (row) => `${row.goalsFor}:${row.goalsAgainst}` },
    { id: "difference", label: "Tordifferenz", shortLabel: "TD", numeric: true, sort: sortProps("difference"), render: (row) => row.goalDifference > 0 ? `+${row.goalDifference}` : row.goalDifference },
    { id: "points", label: "Punkte", shortLabel: "Pkt", numeric: true, className: "fui-data-table__primary", render: (row) => row.points },
    { id: "form", label: "Letzte 5", shortLabel: "Form", sort: sortProps("form"), render: (row) => <span className="form-cell"><FormChips>{row.form.map((entry) => <FormEntryChip key={entry.round} entry={entry} team={row.team} />)}</FormChips></span> },
    { id: "course", label: "Verlauf", render: (row) => <RankSparkline positions={row.positions} teamCount={standings.rows.length} /> },
  ];

  return (
    <section className="tabelle-block">
      <div className="section-copy cross-copy">
        <div><p className="fui-kicker">Stand nach Spieltag {standings.context.round}</p><h2>{venue === "all" ? "Formtabelle" : venue === "home" ? "Heimtabelle" : "Auswärtstabelle"}</h2></div>
        <Segmented ariaLabel="Tabellenart" value={venue} onChange={(id) => setVenue(id as typeof venue)} options={[{ value: "all", label: "Gesamt" }, { value: "home", label: "Heim" }, { value: "away", label: "Auswärts" }]} />
      </div>
      {venue !== "all" ? <VenueTable rows={standings.venues[venue]} league={league} leagueName={standings.context.leagueName} venue={venue} onTeam={onTeam} /> : <DataTable
        ariaLabel={`Tabelle der ${standings.context.leagueName}`}
        rows={rows}
        columns={columns}
        getRowKey={(row) => row.team.id}
        emptyMessage="Für diese Auswahl liegen keine Tabellendaten vor."
        minWidth="1080px"
        mobileMinWidth="640px"
        onRowClick={(row) => onTeam(row.team.id)}
      />}
    </section>
  );
}

function VenueTable({ rows, league, leagueName, venue, onTeam }: { rows: VenueTableRow[]; league: string; leagueName: string; venue: "home" | "away"; onTeam: (id: string) => void }) {
  const columns: DataTableColumn<VenueTableRow>[] = [
    { id: "rank", label: "Platz", shortLabel: "#", render: (row) => { const zone = zoneForRank(league, row.rank); return <span className={`tabelle-rank${zone ? ` tabelle-rank-${zone.tone}` : ""}`}>{row.rank}</span>; } },
    { id: "team", label: "Verein", width: "30%", render: (row) => <div className="table-team tabelle-team"><LogoTile code={row.team.code} url={row.team.logoUrl} /><span><strong><span className="player-name-full">{row.team.name}</span><span className="player-name-short">{row.team.code}</span></strong></span></div> },
    { id: "played", label: "Spiele", shortLabel: "Sp", numeric: true, render: (row) => row.played },
    { id: "wins", label: "S", numeric: true, render: (row) => row.wins },
    { id: "draws", label: "U", numeric: true, render: (row) => row.draws },
    { id: "losses", label: "N", numeric: true, render: (row) => row.losses },
    { id: "goals", label: "Tore", numeric: true, render: (row) => `${row.goalsFor}:${row.goalsAgainst}` },
    { id: "difference", label: "Tordifferenz", shortLabel: "TD", numeric: true, render: (row) => row.goalDifference > 0 ? `+${row.goalDifference}` : row.goalDifference },
    { id: "points", label: "Punkte", shortLabel: "Pkt", numeric: true, className: "fui-data-table__primary", render: (row) => row.points },
  ];
  return <DataTable ariaLabel={`${venue === "home" ? "Heimtabelle" : "Auswärtstabelle"} der ${leagueName}`} rows={rows} columns={columns} getRowKey={(row) => row.team.id} emptyMessage="Für diese Auswahl liegen keine Tabellendaten vor." minWidth="760px" mobileMinWidth="520px" onRowClick={(row) => onTeam(row.team.id)} />;
}

function trendTitle(trend: number | null) {
  return trend == null ? "Noch kein Vergleich möglich" : "Plätze gewonnen oder verloren gegenüber dem Stand vor fünf Spieltagen";
}

function FormEntryChip({ entry, team }: { entry: LeagueTableFormEntry; team: LeagueTableTeam }) {
  const hover = usePopoverHover<HTMLSpanElement>();
  // The entry's score is from this team's point of view; the popover shows it home side first.
  const [scored, conceded] = entry.score.split(":");
  const [home, away] = entry.home ? [team, entry.opponent] : [entry.opponent, team];
  const score = entry.home ? `${scored}:${conceded}` : `${conceded}:${scored}`;
  const outcome = entry.outcome === "S" ? "Sieg" : entry.outcome === "N" ? "Niederlage" : "Unentschieden";
  return (
    <FormChip ref={hover.ref} outcome={formOutcome[entry.outcome]} tabIndex={0} aria-label={`Spieltag ${entry.round}: ${outcome}, ${home.name} ${score} ${away.name}`} {...hover.handlers}>
      {entry.outcome}
      <MatchPopover hover={hover} title={`Spieltag ${entry.round}`} status={`${outcome} · ${entry.home ? "Heim" : "Auswärts"}`} home={home} away={away} score={score} />
    </FormChip>
  );
}

function RankSparkline({ positions, teamCount }: { positions: number[]; teamCount: number }) {
  if (positions.length < 2) return <span className="form-chips-empty">—</span>;
  const width = 86;
  const height = 26;
  const x = (index: number) => 2 + (index * (width - 4)) / (positions.length - 1);
  const y = (rank: number) => 2 + ((rank - 1) * (height - 4)) / Math.max(1, teamCount - 1);
  return (
    <svg className="rank-sparkline" width={width} height={height} aria-hidden="true">
      <polyline points={positions.map((rank, index) => `${x(index)},${y(rank)}`).join(" ")} />
      <circle cx={x(positions.length - 1)} cy={y(positions[positions.length - 1])} r="2.4" />
    </svg>
  );
}
