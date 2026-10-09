import type { DataTableColumn } from "@gruberb/fun-ui";
import { DataTable, LogoTile } from "@gruberb/fun-ui";
import { useCallback, useMemo, useState } from "react";
import { ResourcePanel } from "../../components/resource-panel";
import type { TeamMetric } from "../../components/team-scores";
import { TeamMetricCell, teamMetrics } from "../../components/team-scores";
import { useResource } from "../../hooks/use-resource";
import { api } from "../../lib/data/api";
import type { Filters } from "../../lib/navigation/scope";
import type { TeamScore } from "../../types/models";

export function TeamsView(props: { filters: Filters; onTeam: (id: string) => void }) {
  const { filters } = props;
  const resource = useResource(useCallback(
    (signal: AbortSignal) => api.teams(new URLSearchParams({ league: filters.league, season: filters.season }), signal),
    [filters.league, filters.season],
  ));
  return <ResourcePanel resource={resource} label="Mannschaftswertungen">{(data) => <TeamTable {...props} teams={data} />}</ResourcePanel>;
}

function TeamTable({ onTeam, teams }: { onTeam: (id: string) => void; teams: TeamScore[] }) {
  const [query, setQuery] = useState("");
  const [sortMetric, setSortMetric] = useState<TeamMetric>("overall");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");

  const sortedTeams = useMemo(() => teams.filter((team) => team.name.toLocaleLowerCase("de").includes(query.trim().toLocaleLowerCase("de"))).sort((left, right) => {
    const difference = left[sortMetric] - right[sortMetric];
    if (difference !== 0) return sortDirection === "asc" ? difference : -difference;
    return left.name.localeCompare(right.name, "de");
  }), [teams, query, sortMetric, sortDirection]);

  function sortTeams(metric: TeamMetric) {
    if (metric === sortMetric) setSortDirection((direction) => direction === "desc" ? "asc" : "desc");
    else { setSortMetric(metric); setSortDirection("desc"); }
  }
  const columns: DataTableColumn<TeamScore>[] = [
    { id: "team", label: "Verein", width: "36%", render: (team, index) => <div className="table-team"><span className="rank">{index + 1}</span><LogoTile code={team.code} url={team.logoUrl} size="lg" /><span><strong>{team.name}</strong><small>{team.sampleSize} Spieler mit Wertung</small></span></div> },
    ...teamMetrics.map((metric): DataTableColumn<TeamScore> => ({
      id: metric.key,
      label: metric.label,
      shortLabel: metric.short,
      numeric: true,
      className: "team-points-cell",
      sort: { active: sortMetric === metric.key, direction: sortDirection, onSort: () => sortTeams(metric.key) },
      render: (team) => <TeamMetricCell value={team[metric.key]} label={metric.label} players={team.topPlayers[metric.leaders]} />,
    })),
  ];
  return (
    <section className="data-page-section">
      <DataTable
        ariaLabel="Mannschaftswertungen"
        rows={sortedTeams}
        columns={columns}
        getRowKey={(team) => team.id}
        search={{ value: query, onChange: setQuery, placeholder: "Verein suchen" }}
        searchLabel="Suche"
        countLabel={`${sortedTeams.length} Vereine`}
        emptyMessage="Für diese Saison liegen keine Mannschaftswertungen vor."
        minWidth="900px"
        mobileMinWidth="580px"
        onRowClick={(team) => onTeam(team.id)}
      />
    </section>
  );
}
