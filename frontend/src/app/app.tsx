import { useState } from "react";
import { EntityNavigationContext } from "../components/entity-link";
import { AppShell, Segmented } from "@gruberb/fun-ui";
import { Empty, ErrorState, LoadingState } from "../components/feedback";
import { PageHeader, StepperSelect } from "../components/page-controls";
import { InfoPage } from "../features/info/info-page";
import { MatchdayView } from "../features/matchday/matchday-view";
import { MatchDetailView } from "../features/matches/match-detail-view";
import { PlayerDetailView } from "../features/players/player-detail-view";
import { PlayersView } from "../features/players/players-view";
import { RankingsView } from "../features/rankings/rankings-view";
import { StandingsView } from "../features/standings/standings-view";
import { TeamDetailView } from "../features/teams/team-detail-view";
import { TeamsView } from "../features/teams/teams-view";
import type { NavView } from "../lib/navigation/scope";
import { isInfoView, viewHref } from "../lib/navigation/scope";
import { nav, navMobile } from "./navigation-items";
import { SiteFooter } from "./site-footer";
import { useAppModel } from "./use-app-model";

export default function App() {
  const {
    view, navActive, setView, filters, title,
    description, catalog, updateFilter, selectedTeamSeason, teamSeasons,
    updateTeamSeason, selectedPlayerSeason, playerSeasons, updatePlayerSeason, seasons,
    latestRound, overviewScope, setOverviewScope, overviewRound, catalogError,
    selectedSeason, openPlayer, openTeam, hasSeasonPoints, hasPreviousSeason,
    playerColumns, updatePlayerColumns, playerId, backLabel,
    goBack, teamId, teamSelectionPending, openMatch, matchId,
    replaceMatch,
  } = useAppModel();

  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try { return localStorage.getItem("punktespiegel.sidebarCollapsed") === "true"; }
    catch { return false; }
  });
  function toggleSidebar() {
    const next = !sidebarCollapsed;
    setSidebarCollapsed(next);
    // Storage can be unavailable in private or embedded browsing contexts.
    try { localStorage.setItem("punktespiegel.sidebarCollapsed", String(next)); } catch { /* Keep the in-memory preference. */ }
  }

  return (
    <EntityNavigationContext value={{ filters, onPlayer: openPlayer, onTeam: openTeam }}>
    <AppShell
      className={`view-${view}${sidebarCollapsed ? " sidebar-collapsed" : ""}`}
      navLabel="Bereiche"
      activeId={navActive}
      onNavigate={(id) => setView(id as NavView)}
      brand={<><a href={viewHref("overview", filters)} onClick={(event) => { event.preventDefault(); setView("overview"); }} aria-label="Punktespiegel Startseite">
        <img src={`${import.meta.env.BASE_URL}brand/punktespiegel-mark.svg`} alt="" aria-hidden="true" />
        <span>Punktespiegel</span>
      </a><button className="sidebar-toggle" onClick={toggleSidebar} aria-expanded={!sidebarCollapsed} aria-label={sidebarCollapsed ? "Seitenleiste ausklappen" : "Seitenleiste einklappen"} title={sidebarCollapsed ? "Seitenleiste ausklappen" : "Seitenleiste einklappen"}>{sidebarCollapsed ? "»" : "«"}</button></>}
      nav={nav.map((item) => ({ id: item.id, label: item.label, mobileLabel: navMobile[item.id].label, href: viewHref(item.id, filters), icon: <span title={item.label}>{navMobile[item.id].icon}</span> }))}
    >
        {!isInfoView(view) && view !== "overview" && view !== "matchday" && view !== "match" && <PageHeader title={title ?? ""} description={description} controls={<div className="selectors">
            {view !== "team" && view !== "player" && <StepperSelect label="Liga" value={filters.league} options={(catalog?.leagues ?? []).map((league) => ({ value: league.code, label: league.name }))} onChange={(value) => updateFilter("league", value)} />}
            {view === "team"
              ? <StepperSelect label="Saison" value={String(selectedTeamSeason?.startYear ?? filters.season)} options={[...teamSeasons].reverse().map((season) => ({ value: String(season.startYear), label: season.displayName }))} onChange={updateTeamSeason} />
              : view === "player"
                ? <StepperSelect label="Saison" value={String(selectedPlayerSeason?.startYear ?? filters.season)} options={[...playerSeasons].reverse().map((season) => ({ value: String(season.startYear), label: season.displayName }))} onChange={updatePlayerSeason} />
                : view !== "table" && <StepperSelect label="Saison" value={filters.season} options={[...seasons].reverse().map((season) => ({ value: String(season.startYear), label: season.displayName }))} onChange={(value) => updateFilter("season", value)} />}
            {view === "table" && latestRound > 0 && <>
              <Segmented ariaLabel="Zeitraum" size="lg" stretch value={overviewScope} onChange={(value) => setOverviewScope(value as typeof overviewScope)} options={[{ value: "through", label: "Gesamt" }, { value: "matchday", label: "Nur Spieltag" }]} />
              <StepperSelect label="Spieltag" value={String(overviewRound)} options={Array.from({ length: Math.max(1, latestRound) }, (_, index) => ({ value: String(index + 1), label: `Spieltag ${index + 1}` }))} onChange={(value) => updateFilter("round", value)} />
            </>}
          </div>} />}

        {isInfoView(view) ? <InfoPage view={view} filters={filters} onView={setView} /> : catalogError ? <ErrorState message={catalogError} /> : !catalog ? <LoadingState /> : (
          <>
            {view === "table" && (
              latestRound < 1 ? <section className="detail-section"><Empty message="Für diese Saison liegen noch keine Daten eines abgeschlossenen Spieltags vor." /></section>
                : <RankingsView scope={overviewScope} eleven={{ league: filters.league, season: String(selectedSeason?.startYear ?? filters.season), round: overviewRound }} onView={setView} onPlayer={openPlayer} onTeam={openTeam} />
            )}
            {view === "players" && <PlayersView filters={filters} seasonName={selectedSeason?.displayName ?? filters.season} hasSeasonPoints={hasSeasonPoints} hasPreviousSeason={hasPreviousSeason} columnsMode={playerColumns} onColumnsMode={updatePlayerColumns} onPlayer={openPlayer} />}
            {view === "player" && playerId && <PlayerDetailView key={playerId} filters={{ ...filters, league: selectedPlayerSeason?.leagueCode ?? filters.league, season: String(selectedPlayerSeason?.startYear ?? filters.season) }} playerId={playerId} backLabel={backLabel} onBack={() => goBack("players")} onTeam={openTeam} onSeason={(year) => updatePlayerSeason(String(year))} onMatch={openMatch} />}
            {view === "teams" && <TeamsView filters={filters} onTeam={openTeam} />}
            {view === "team" && teamId && (teamSelectionPending ? <LoadingState /> : <TeamDetailView filters={filters} teamId={teamId} backLabel={backLabel} onBack={() => goBack("teams")} onPlayer={openPlayer} onTeam={openTeam} onMatch={openMatch} />)}
            {view === "match" && matchId && <MatchDetailView filters={filters} matchId={matchId} backLabel={backLabel} onBack={() => goBack("overview")} onPlayer={openPlayer} onTeam={openTeam} onMatch={replaceMatch} />}
            {view === "matchday" && <MatchdayView filters={filters} leagues={catalog.leagues} seasons={seasons} onFilter={updateFilter} onPlayer={openPlayer} onMatch={openMatch} />}
            {view === "overview" && <StandingsView filters={filters} leagues={catalog.leagues} seasons={seasons} onFilter={updateFilter} onTeam={openTeam} onPlayer={openPlayer} onMatch={openMatch} />}
          </>
        )}
        <SiteFooter currentView={view} filters={filters} onView={setView} />
    </AppShell>
    </EntityNavigationContext>
  );
}
