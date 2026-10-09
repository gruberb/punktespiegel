import { useCallback } from "react";
import { Empty, ErrorState, LoadingState } from "../../components/feedback";
import { PageHeader, StepperSelect } from "../../components/page-controls";
import { useResource } from "../../hooks/use-resource";
import { api } from "../../lib/data/api";
import type { Filters } from "../../lib/navigation/scope";
import type { Catalog } from "../../types/models";
import { BumpChartCard } from "./bump-chart";
import { CrossTableCard } from "./cross-table";
import { FormTableCard } from "./form-table";
import { InsightCards, InsightFacts } from "./insights";
import { leagueZones } from "./zones";

export function StandingsView({ filters, leagues, seasons, onFilter, onTeam, onPlayer, onMatch }: { filters: Filters; leagues: Catalog["leagues"]; seasons: Catalog["seasons"]; onFilter: (key: keyof Filters, value: string) => void; onTeam: (id: string) => void; onPlayer: (id: string) => void; onMatch: (id: string) => void }) {
  const selectedSeason = seasons.find((season) => String(season.startYear) === filters.season);
  const maximumRound = Math.max(1, selectedSeason?.latestRound ?? 0);
  const round = Math.min(maximumRound, Math.max(1, Number(filters.round) || 1));
  const leagueName = leagues.find((league) => league.code === filters.league)?.name ?? "Bundesliga";

  const { data: insights } = useResource(useCallback(
    (signal: AbortSignal) => api.insights(new URLSearchParams({ league: filters.league, season: filters.season, round: String(round) }), signal),
    [filters.league, filters.season, round],
  ));

  const { data: standings, error, loading } = useResource(useCallback(
    (signal: AbortSignal) => api.standings(new URLSearchParams({ league: filters.league, season: filters.season, round: String(round) }), signal),
    [filters.league, filters.season, round],
  ));

  return (
    <div className="tabelle-view">
      <PageHeader hero eyebrow={`${leagueName} · ${selectedSeason?.displayName ?? "Gewählte Saison"} · Stand nach`} title={`Spieltag ${round}`} controls={<div className="selectors">
        <StepperSelect label="Liga" value={filters.league} options={leagues.map((league) => ({ value: league.code, label: league.name }))} onChange={(value) => onFilter("league", value)} />
        <StepperSelect label="Saison" value={filters.season} options={[...seasons].reverse().map((season) => ({ value: String(season.startYear), label: season.displayName }))} onChange={(value) => onFilter("season", value)} />
        <StepperSelect label="Spieltag" value={String(round)} options={Array.from({ length: maximumRound }, (_, index) => ({ value: String(index + 1), label: `Spieltag ${index + 1}` }))} onChange={(value) => onFilter("round", value)} />
      </div>} />
      {error ? <ErrorState message={error} />
        : loading || !standings ? <LoadingState />
          : standings.context.playedMatchCount < 1 ? <section className="detail-section"><Empty message="Für diese Auswahl liegen noch keine gespielten Partien vor." /></section>
            : <>
              {insights && insights.cards.length > 0 && <InsightCards cards={insights.cards} onTeam={onTeam} onPlayer={onPlayer} />}
              {insights && insights.facts.length > 0 && <InsightFacts round={round} facts={insights.facts} onTeam={onTeam} onPlayer={onPlayer} />}
              <FormTableCard standings={standings} league={filters.league} onTeam={onTeam} />
              <BumpChartCard standings={standings} zones={leagueZones[filters.league] ?? []} />
              <CrossTableCard standings={standings} onTeam={onTeam} onMatch={onMatch} />
            </>}
    </div>
  );
}
