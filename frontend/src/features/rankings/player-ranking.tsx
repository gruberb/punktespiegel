import { EntityLink } from "../../components/entity-link";
import type { DataTableColumn } from "@gruberb/fun-ui";
import { DataTable } from "@gruberb/fun-ui";
import { Empty } from "../../components/feedback";
import { PlayerName, PlayerPortrait, positionName } from "../../components/player-identity";
import type { Player } from "../../types/models";
import { formatCardCounts, formatPenalty } from "../../utils/format";

export type RankingMetric = "points" | "grade" | "goals" | "assists" | "cleanSheets" | "starterPoints" | "cardDeductions" | "mvpAwards" | "jokerAwards";

function playerRankingValue(player: Player, metric: RankingMetric, scope: "season" | "matchday" = "season") {
  if (metric === "grade") return (scope === "matchday" ? player.roundGrade : player.averageGrade)?.toFixed(2) ?? "—";
  if (metric === "goals") return scope === "matchday" ? player.roundGoals : player.goals;
  if (metric === "assists") return scope === "matchday" ? player.roundAssists : player.assists;
  if (metric === "cleanSheets") return scope === "matchday" ? player.roundCleanSheets : player.cleanSheets;
  if (metric === "starterPoints") return scope === "matchday" ? player.roundStarterPoints : player.starterPoints;
  if (metric === "cardDeductions") return formatPenalty(scope === "matchday" ? player.roundCardPoints : player.cardPoints);
  if (metric === "mvpAwards") return scope === "matchday" ? player.roundMvpAwards : player.mvpAwards;
  if (metric === "jokerAwards") return scope === "matchday" ? player.roundJokerAwards : player.jokerAwards;
  return scope === "matchday" ? player.roundPoints : player.observedPoints;
}

function playerRankingSuffix(metric: RankingMetric) {
  return metric === "grade" ? "Note" : metric === "points" || metric === "starterPoints" || metric === "cardDeductions" ? "Pkt." : metric === "goals" ? "Tore" : metric === "assists" ? "Vorlagen" : metric === "cleanSheets" ? "Spiele" : metric === "mvpAwards" ? "SdS" : "Boni";
}

function playerRankingColumnLabel(metric: RankingMetric) {
  return ({
    points: "Punkte",
    grade: "Note",
    goals: "Tore",
    assists: "Vorlagen",
    cleanSheets: "Weiße Westen",
    starterPoints: "Startelf",
    cardDeductions: "Platzverweise",
    mvpAwards: "SdS",
    jokerAwards: "Joker",
  } satisfies Record<RankingMetric, string>)[metric];
}

export function PlayerRanking({ players, metric, onPlayer, scrollable = false, scope = "season" }: { players: Player[]; metric: RankingMetric; onPlayer: (id: string) => void; scrollable?: boolean; scope?: "season" | "matchday" }) {
  if (!players.length) return <Empty message="Für diese Auswahl liegen keine Wertungen vor." />;
  const suffix = playerRankingSuffix(metric);
  return (
    <ol className={`player-ranking ${scrollable ? "scrollable" : ""}`}>
      {players.map((player, index) => (
        <li key={player.id}>
          <div className="entity-row" onClick={() => onPlayer(player.id)}>
            <span className="rank">{index + 1}</span>
            <PlayerPortrait name={player.name} url={player.photoUrl} teamCode={player.teamCode} teamLogoUrl={player.logoUrl} />
            <span className="player-identity"><strong><EntityLink kind="player" id={player.id}>{player.name}</EntityLink></strong><small><EntityLink kind="team" id={player.teamId}>{player.team}</EntityLink> · {metric === "cardDeductions" ? formatCardCounts(scope === "matchday" ? player.roundRedCards : player.redCards, scope === "matchday" ? player.roundYellowRedCards : player.yellowRedCards) : positionName[player.position]}</small></span>
            <span className="ranking-value"><strong>{playerRankingValue(player, metric, scope)}</strong><small>{suffix}</small></span>
          </div>
        </li>
      ))}
    </ol>
  );
}

export function OverviewPlayerTable({ players, metric, scope = "season", onPlayer }: { players: Player[]; metric: RankingMetric; scope?: "season" | "matchday"; onPlayer: (id: string) => void }) {
  const columns: DataTableColumn<Player>[] = [
    {
      id: "player",
      label: "Name",
      width: "40%",
      render: (player, index) => <div className="table-player">
        <span className="rank">{index + 1}</span>
        <PlayerPortrait name={player.name} url={player.photoUrl} teamCode={player.teamCode} teamLogoUrl={player.logoUrl} />
        <span><PlayerName name={player.name} /></span>
      </div>,
    },
    { id: "team", label: "Team", width: "28%", render: (player) => <span className="overview-table-text" title={player.team}><EntityLink kind="team" id={player.teamId}>{player.team}</EntityLink></span> },
    { id: "position", label: "Position", shortLabel: "Pos.", width: "17%", render: (player) => <span className="overview-table-text" title={positionName[player.position]}>{positionName[player.position]}</span> },
    {
      id: "value",
      label: playerRankingColumnLabel(metric),
      shortLabel: metric === "points" ? "Pkt." : undefined,
      numeric: true,
      className: "fui-data-table__primary",
      width: "15%",
      render: (player) => <>{playerRankingValue(player, metric, scope)}<small>{playerRankingSuffix(metric)}</small></>,
    },
  ];
  return <DataTable
    ariaLabel={`Spieler nach ${playerRankingColumnLabel(metric)}`}
    rows={players}
    columns={columns}
    getRowKey={(player) => player.id}
    emptyMessage="Für diese Auswahl liegen keine Wertungen vor."
    minWidth="100%"
    maxVisibleRows={10}
    onRowClick={(player) => onPlayer(player.id)}
  />;
}
