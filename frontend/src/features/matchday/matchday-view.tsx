import { useCallback } from "react";
import { ResourcePanel } from "../../components/resource-panel";
import { FixtureTiles } from "../../components/fixture-tiles";
import { PageHeader, StepperSelect } from "../../components/page-controls";
import { useResource } from "../../hooks/use-resource";
import { api } from "../../lib/data/api";
import type { Filters } from "../../lib/navigation/scope";
import type { Catalog } from "../../types/models";
import { MatchdayReport } from "./matchday-report";

export function MatchdayView({ filters, leagues, seasons, onFilter, onPlayer, onMatch }: { filters: Filters; leagues: Catalog["leagues"]; seasons: Catalog["seasons"]; onFilter: (key: keyof Filters, value: string) => void; onPlayer: (id: string) => void; onMatch: (id: string) => void }) {
  const selectedSeason = seasons.find((season) => String(season.startYear) === filters.season);
  const maximumRound = Math.max(1, selectedSeason?.latestRound ?? 0);
  const round = Math.min(maximumRound, Math.max(1, Number(filters.round) || 1));
  const leagueName = leagues.find((league) => league.code === filters.league)?.name ?? "Bundesliga";
  const resource = useResource(useCallback(
    (signal: AbortSignal) => api.standings(new URLSearchParams({ league: filters.league, season: filters.season, round: String(round) }), signal),
    [filters.league, filters.season, round],
  ));
  return (
    <div className="tabelle-view">
      <PageHeader eyebrow={`${leagueName} · ${selectedSeason?.displayName ?? "Gewählte Saison"}`} title={`Spieltag ${round}`} controls={<div className="selectors">
        <StepperSelect label="Liga" value={filters.league} options={leagues.map((league) => ({ value: league.code, label: league.name }))} onChange={(value) => onFilter("league", value)} />
        <StepperSelect label="Saison" value={filters.season} options={[...seasons].reverse().map((season) => ({ value: String(season.startYear), label: season.displayName }))} onChange={(value) => onFilter("season", value)} />
        <StepperSelect label="Spieltag" value={String(round)} options={Array.from({ length: maximumRound }, (_, index) => ({ value: String(index + 1), label: `Spieltag ${index + 1}` }))} onChange={(value) => onFilter("round", value)} />
      </div>} />
      <ResourcePanel resource={resource} label="Ergebnisse">{standings => <section className="tabelle-block">
        <div className="section-copy"><p className="fui-kicker">{standings.fixtures.length} Spiele · antippen öffnet den Spielbericht</p><h2>Ergebnisse</h2></div>
        <FixtureTiles matches={standings.fixtures.map(fixture => ({ id: fixture.id, scheduledAt: fixture.scheduledAt, home: fixture.home.team, away: fixture.away.team, homeScore: fixture.homeScore, awayScore: fixture.awayScore }))} onMatch={onMatch} />
      </section>}</ResourcePanel>
      <MatchdayReport filters={filters} round={round} onPlayer={onPlayer} />
    </div>
  );
}
