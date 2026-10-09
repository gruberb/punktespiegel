import { useCallback } from "react";
import { ResourcePanel } from "../../components/resource-panel";
import { useResource } from "../../hooks/use-resource";
import { api } from "../../lib/data/api";

import { CardHead, SimpleCardHead, TabNavigation } from "@gruberb/fun-ui";
import { useState } from "react";
import { positionName } from "../../components/player-identity";
import { TeamRanking } from "../../components/team-scores";
import type { NavView } from "../../lib/navigation/scope";
import type { Dashboard, Player, Position } from "../../types/models";
import { OverviewBestEleven } from "../../components/best-eleven-card";
import type { RankingMetric } from "./player-ranking";
import { OverviewPlayerTable, PlayerRanking } from "./player-ranking";

type RankingsViewProps = {
  scope: "through" | "matchday";
  eleven: { league: string; season: string; round: number };
  onView: (view: NavView) => void;
  onPlayer: (id: string) => void;
  onTeam: (id: string) => void;
};

export function RankingsView(props: RankingsViewProps) {
  const { league, season, round } = props.eleven;
  const resource = useResource(useCallback(
    (signal: AbortSignal) => api.dashboard(new URLSearchParams({ league, season, round: String(round) }), signal),
    [league, season, round],
  ));
  return <section className="overview-grid" aria-label="Saisonüberblick">
    <ResourcePanel resource={resource} label="Ranglisten" className="resource-grid-contents">{data => <Rankings {...props} data={data} />}</ResourcePanel>
    <OverviewBestEleven {...props.eleven} scope={props.scope === "matchday" ? "matchday" : "season"} onPlayer={props.onPlayer} />
  </section>;
}

function Rankings({ data, scope, onView, onPlayer, onTeam }: { data: Dashboard; scope: "through" | "matchday"; eleven: { league: string; season: string; round: number }; onView: (view: NavView) => void; onPlayer: (id: string) => void; onTeam: (id: string) => void }) {
  const [position, setPosition] = useState<Position>("FWD");
  const [metric, setMetric] = useState<Exclude<RankingMetric, "points">>("grade");
  const round = data.context.round;
  const matchdayOnly = scope === "matchday";
  const leaderboards = matchdayOnly ? data.matchdayLeaderboards : data.leaderboards;
  const playerScope = matchdayOnly ? "matchday" as const : "season" as const;
  const metrics: { id: Exclude<RankingMetric, "points">; label: string; players: Player[] }[] = [
    { id: "grade", label: "Noten", players: leaderboards.grades },
    { id: "goals", label: "Tore", players: leaderboards.goals },
    { id: "assists", label: "Vorlagen", players: leaderboards.assists },
    { id: "cleanSheets", label: "Weiße Westen", players: leaderboards.cleanSheets },
    { id: "starterPoints", label: "Startelf", players: leaderboards.starterPoints },
    { id: "cardDeductions", label: "Platzverweise", players: leaderboards.cardDeductions },
    { id: "mvpAwards", label: "SdS", players: leaderboards.mvpAwards },
    { id: "jokerAwards", label: "Joker", players: leaderboards.jokerAwards },
  ];
  const activeMetric = metrics.find((item) => item.id === metric) ?? metrics[0];
  return (
    <>
      <article className="dashboard-card team-pulse-card">
        <CardHead eyebrow={matchdayOnly ? `Nur Spieltag ${round}` : `Bis einschließlich Spieltag ${round}`} title="Mannschaftswertung" subtitle={matchdayOnly ? "Punkte aller Spieler des Vereins an diesem Spieltag" : "Gesamtpunkte aller Spieler des Vereins"} action={<button onClick={() => onView("teams")}>Alle Mannschaften</button>} />
        <TeamRanking teams={matchdayOnly ? data.matchdayTeams : data.seasonTeams} matchday={round} scope={matchdayOnly ? "matchday" : "through"} onTeam={onTeam} />
      </article>
      <article className="dashboard-card">
        <CardHead eyebrow={matchdayOnly ? `Spieltag ${round}` : "Gesamt"} title={matchdayOnly ? "Spieltagsrangliste" : "Aktuelle Rangliste"} subtitle={matchdayOnly ? `Punkte an Spieltag ${round}` : `Gesamtpunkte bis Spieltag ${round}`} action={<button onClick={() => onView("players")}>Alle Spieler</button>} />
        <PlayerRanking players={leaderboards.overall} metric="points" scope={playerScope} onPlayer={onPlayer} />
      </article>
      <article className="dashboard-card position-card">
        <SimpleCardHead title="Nach Position" action={<TabNavigation className="card-tabs" ariaLabel="Position" activeTab={position} onTabChange={(id) => setPosition(id as Position)}
          tabs={(["GK", "DEF", "MID", "FWD"] as Position[]).map((item) => ({ id: item, label: positionName[item], buttonId: `position-${item}-tab`, controls: "position-panel" }))} />} />
        <div className="overview-tab-panel" id="position-panel" role="tabpanel" aria-labelledby={`position-${position}-tab`}>
          <OverviewPlayerTable players={leaderboards.positions[position] ?? []} metric="points" scope={playerScope} onPlayer={onPlayer} />
        </div>
      </article>
      <article className="dashboard-card overview-metrics-card">
        <SimpleCardHead title="Wertungen" action={<TabNavigation className="card-tabs" ariaLabel="Wertung" activeTab={metric} onTabChange={(id) => setMetric(id as typeof metric)}
          tabs={metrics.map((item) => ({ id: item.id, label: item.label, buttonId: `metric-${item.id}-tab`, controls: "metric-panel" }))} />} />
        <div className="overview-tab-panel" id="metric-panel" role="tabpanel" aria-labelledby={`metric-${metric}-tab`}>
          <OverviewPlayerTable players={activeMetric.players} metric={activeMetric.id} scope={playerScope} onPlayer={onPlayer} />
        </div>
      </article>
    </>
  );
}
