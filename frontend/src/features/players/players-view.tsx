import { EntityLink } from "../../components/entity-link";
import type { DataTableColumn } from "@gruberb/fun-ui";
import { DataTable, Notice, Segmented } from "@gruberb/fun-ui";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ResourcePanel } from "../../components/resource-panel";
import { PlayerName, PlayerPortrait, PositionTag, positionName } from "../../components/player-identity";
import { useResource } from "../../hooks/use-resource";
import { api } from "../../lib/data/api";
import type { PlayerSort } from "../../lib/data/player-table";
import { defaultPlayerSort, shortSeasonLabel, sortPlayers } from "../../lib/data/player-table";
import type { PlayerColumns } from "../../lib/navigation/routes";
import type { Filters } from "../../lib/navigation/scope";
import type { PlayerTableRow, Position } from "../../types/models";
import { formatMarketValue, formatPlayerValue, formatSignedPoints } from "../../utils/format";

export function PlayersView(props: { filters: Filters; seasonName: string; hasSeasonPoints: boolean; hasPreviousSeason: boolean; columnsMode: PlayerColumns; onColumnsMode: (mode: PlayerColumns) => void; onPlayer: (id: string) => void }) {
  const { filters } = props;
  const resource = useResource(useCallback(
    (signal: AbortSignal) => api.players(new URLSearchParams({ league: filters.league, season: filters.season }), signal),
    [filters.league, filters.season],
  ));
  return <ResourcePanel resource={resource} label="Spielerwertung">{(data) => <PlayerTable {...props} players={data} />}</ResourcePanel>;
}

function PlayerTable({ filters, seasonName, hasSeasonPoints, hasPreviousSeason, columnsMode, onColumnsMode, onPlayer, players }: { filters: Filters; seasonName: string; hasSeasonPoints: boolean; hasPreviousSeason: boolean; columnsMode: PlayerColumns; onColumnsMode: (mode: PlayerColumns) => void; onPlayer: (id: string) => void; players: PlayerTableRow[] }) {
  const [query, setQuery] = useState("");
  const [position, setPosition] = useState("");
  const [team, setTeam] = useState("");
  const [sort, setSort] = useState<PlayerSort>(() => defaultPlayerSort(hasSeasonPoints));
  const [direction, setDirection] = useState<"asc" | "desc">("desc");

  useEffect(() => {
    setSort(defaultPlayerSort(hasSeasonPoints));
    setDirection("desc");
  }, [filters.league, filters.season, hasSeasonPoints, columnsMode]);


  function sortBy(column: PlayerSort) {
    if (column === sort) setDirection((value) => value === "asc" ? "desc" : "asc");
    else {
      setSort(column);
      setDirection(column === "name" || column === "position" || column === "grade" ? "asc" : "desc");
    }
  }

  const teamOptions = useMemo(() => [...new Set(players.map((player) => player.team))].sort((left, right) => left.localeCompare(right, "de")), [players]);
  const search = query.trim().toLocaleLowerCase("de");
  const visiblePlayers = sortPlayers(players.filter((player) =>
    (!team || player.team === team) && (!position || player.position === position)
    && (!search || player.name.toLocaleLowerCase("de").includes(search) || player.team.toLocaleLowerCase("de").includes(search)),
  ), sort, direction);
  const sortProps = (column: PlayerSort) => ({ active: sort === column, direction, onSort: () => sortBy(column) });
  const identityColumns: DataTableColumn<PlayerTableRow>[] = [
    { id: "player", label: "Spieler", width: "29%", sort: sortProps("name"), render: (player, index) => <div className="table-player"><span className="rank">{index + 1}</span><PlayerPortrait name={player.name} url={player.photoUrl} teamCode={player.teamCode} teamLogoUrl={player.logoUrl} /><span><PlayerName name={player.name} /><small><EntityLink kind="team" id={player.teamId}>{player.team}</EntityLink></small></span></div> },
    { id: "position", label: "Position", shortLabel: "Pos.", sort: sortProps("position"), render: (player) => <PositionTag position={player.position} /> },
    { id: "price", label: "Marktwert", shortLabel: "Wert", numeric: true, sort: sortProps("price"), render: (player) => formatMarketValue(player.priceM) },
  ];
  const pointColumns: DataTableColumn<PlayerTableRow>[] = [
    { id: "points", label: `Punkte ${shortSeasonLabel(seasonName)}`, shortLabel: "Punkte", numeric: true, className: "fui-data-table__primary", sort: sortProps("points"), render: (player) => player.observedPoints },
  ];
  if (hasPreviousSeason) pointColumns.push({
    id: "previousPoints",
    label: "Punkte Vorsaison",
    shortLabel: "Vorsaison",
    numeric: true,
    sort: sortProps("previousPoints"),
    render: (player) => player.previousSeasonPoints ?? "—",
  });
  const seasonColumns: DataTableColumn<PlayerTableRow>[] = [
    { id: "goals", label: "Tore", numeric: true, sort: sortProps("goals"), render: (player) => player.goals },
    { id: "assists", label: "Vorlagen", shortLabel: "Vorl.", numeric: true, sort: sortProps("assists"), render: (player) => player.assists },
    { id: "grade", label: "Ø-Note", shortLabel: "Note", numeric: true, sort: sortProps("grade"), render: (player) => player.averageGrade?.toFixed(2) ?? "—" },
    { id: "value", label: "Wert · Pkt. / Mio. €", shortLabel: "Pkt./Mio.", numeric: true, sort: sortProps("value"), render: (player) => formatPlayerValue(player.value) },
  ];

  const historyColumns: DataTableColumn<PlayerTableRow>[] = [
    { id: "average", label: "Ø Punkte im Archiv", shortLabel: "Ø Punkte", numeric: true, sort: sortProps("average"), render: (player) => player.analysis.averagePoints ?? "—" },
    { id: "historicalValue", label: "Ø Pkt. / Mio. €", numeric: true, sort: sortProps("historicalValue"), render: (player) => formatPlayerValue(player.analysis.value) },
    { id: "trend", label: "Trend", numeric: true, sort: sortProps("trend"), render: (player) => player.analysis.trendDelta == null ? "—" : formatSignedPoints(player.analysis.trendDelta) },
    { id: "history", label: "Verlauf", render: (player) => {
      const history = player.analysis.history;
      const label = history.map((season) => `${season.season} · ${season.league}: ${season.points} Punkte`).join("\n");
      const maximum = Math.max(1, ...history.map((season) => Math.max(0, season.points)));
      return <span className="top-player-history table-history" title={label} aria-label={label || "Keine Vergleichssaison"}>{history.map((season) => <i key={`${season.season}-${season.league}`} style={{ height: `${Math.max(12, Math.round(Math.max(0, season.points) / maximum * 100))}%` }} />)}</span>;
    } },
    { id: "signal", label: "Einordnung", render: (player) => <span className="player-signal">{player.analysis.signal}</span> },
  ];
  const columns = [...identityColumns, ...pointColumns, ...(columnsMode === "history" ? historyColumns : seasonColumns)];

  return (
    <section className="data-page-section">
      <DataTable
        ariaLabel="Spielerwertung"
        leading={<Segmented ariaLabel="Spielerstatistik" value={columnsMode} onChange={(value) => onColumnsMode(value as PlayerColumns)} options={[{ value: "season", label: "Saison" }, { value: "history", label: "Historie" }]} />}
        rows={visiblePlayers}
        columns={columns}
        getRowKey={(player) => player.id}
        search={{ value: query, onChange: setQuery, placeholder: "Spieler oder Mannschaft" }}
        searchLabel="Suche"
        filters={[
          { id: "position", label: "Position", value: position, onChange: setPosition, options: [{ value: "", label: "Alle Positionen" }, ...(["GK", "DEF", "MID", "FWD"] as Position[]).map((item) => ({ value: item, label: positionName[item] }))] },
          { id: "team", label: "Mannschaft", value: team, onChange: setTeam, options: [{ value: "", label: "Alle Mannschaften" }, ...teamOptions.map((item) => ({ value: item, label: item }))] },
        ]}
        countLabel={`${visiblePlayers.length} Spieler`}
        emptyMessage="Keine Spieler entsprechen diesen Filtern."
        minWidth={columnsMode === "history" ? "1320px" : hasPreviousSeason ? "1120px" : "1020px"}
        mobileMinWidth={columnsMode === "history" ? "1000px" : hasPreviousSeason ? "700px" : "640px"}
        onRowClick={(player) => onPlayer(player.id)}
      />
      {columnsMode === "history" && <Notice className="top-players-note">Schnitt, Trend und Verlauf verwenden abgeschlossene Saisons vor {seasonName}. „Ø Pkt. / Mio. €“ teilt den historischen Saisonschnitt durch den Marktwert; die Saisonansicht verwendet die Punkte der gewählten Saison.</Notice>}
    </section>
  );
}
