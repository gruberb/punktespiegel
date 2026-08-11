import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";
import { createPortal } from "react-dom";
import { api } from "./api";
import { initialAvailableRound, latestAvailableRound } from "./rounds";
import type {
  BestEleven,
  BestElevenPlayer,
  Catalog,
  Dashboard,
  HistoricalPlayer,
  History,
  ManagerMode,
  ManagerRecommendation,
  Player,
  PlayerDetail,
  PlayerGame,
  Position,
  TeamLeaders,
  TeamDetail,
  TeamDetailMatch,
  TeamMatchContributor,
  TeamPlayerScore,
  TeamScore,
  TopPlayerAnalysis,
  TopPlayers,
} from "./types";

type View = "overview" | "players" | "player" | "teams" | "team" | "history" | "top" | "manager";
type NavView = Exclude<View, "player" | "team">;
type Filters = { league: string; season: string; round: string };
type ViewLocation = { view: View; filters: Filters; playerId: string | null; teamId: string | null; scrollY: number };
type TeamMetric = "overall" | "goalkeeper" | "defence" | "midfield" | "forward";
type PlayerSort = "name" | "position" | "price" | "round" | "points" | "grade" | "goals" | "assists" | "value";
type TopPlayerSort = "previous" | "average" | "value" | "trend" | "price";

const positionName: Record<Position, string> = {
  GK: "Torwart",
  DEF: "Abwehr",
  MID: "Mittelfeld",
  FWD: "Sturm",
};
const nav: { id: NavView; label: string }[] = [
  { id: "overview", label: "Überblick" },
  { id: "players", label: "Spieler" },
  { id: "teams", label: "Mannschaften" },
  { id: "history", label: "Historie" },
  { id: "top", label: "Top Players" },
  { id: "manager", label: "Fantasy Team" },
];
const teamMetrics: { key: TeamMetric; label: string; short: string; leaders: keyof TeamLeaders }[] = [
  { key: "overall", label: "Gesamt", short: "GES", leaders: "overall" },
  { key: "goalkeeper", label: "Torwart", short: "TW", leaders: "goalkeeper" },
  { key: "defence", label: "Abwehr", short: "ABW", leaders: "defence" },
  { key: "midfield", label: "Mittelfeld", short: "MIT", leaders: "midfield" },
  { key: "forward", label: "Sturm", short: "Sturm", leaders: "forward" },
];

function initialFilters(): Filters {
  const params = new URLSearchParams(window.location.search);
  const league = params.get("league") ?? "0001";
  const requestedRound = Number(params.get("round") ?? "1");
  const maximumRound = league === "0003" ? 38 : 34;
  const round = Number.isInteger(requestedRound) ? Math.min(Math.max(requestedRound, 1), maximumRound) : 1;
  return { league, season: params.get("season") ?? "2026", round: String(round) };
}

function requestedInitialRound() {
  const params = new URLSearchParams(window.location.search);
  return params.has("round") ? Number(params.get("round")) : null;
}

function initialView(): View {
  const params = new URLSearchParams(window.location.search);
  const value = params.get("view");
  if (value === "player" && !params.get("player")) return "players";
  if (value === "team" && !params.get("team")) return "teams";
  return (["overview", "players", "player", "teams", "team", "history", "top", "manager"] as View[]).includes(value as View)
    ? (value as View)
    : "overview";
}

function scopeQuery(filters: Filters, includeRound = true) {
  const params = new URLSearchParams({ league: filters.league, season: filters.season });
  if (includeRound) params.set("round", filters.round);
  return params;
}

function isAbort(reason: unknown) {
  return reason instanceof DOMException && reason.name === "AbortError";
}

function seasonsForLeague(catalog: Catalog | null, league: string) {
  return (catalog?.seasons.filter((season) => season.leagueCode === league) ?? [])
    .sort((left, right) => right.startYear - left.startYear);
}

function seasonsForTeam(catalog: Catalog | null, teamId: string | null) {
  if (!teamId) return [];
  return (catalog?.seasons.filter((season) => season.teamIds.includes(teamId)) ?? [])
    .sort((left, right) => right.startYear - left.startYear);
}

function playerSeasonMembership(season: Catalog["seasons"][number], playerId: string) {
  return season.players.find((player) => player.id === playerId);
}

function seasonsForPlayer(catalog: Catalog | null, playerId: string | null) {
  if (!playerId) return [];
  const candidates = (catalog?.seasons.filter((season) => playerSeasonMembership(season, playerId)) ?? [])
    .sort((left, right) => {
      if (left.startYear !== right.startYear) return right.startYear - left.startYear;
      const leftPlayer = playerSeasonMembership(left, playerId)!;
      const rightPlayer = playerSeasonMembership(right, playerId)!;
      return Number(rightPlayer.active) - Number(leftPlayer.active)
        || rightPlayer.appearances - leftPlayer.appearances
        || rightPlayer.points - leftPlayer.points
        || left.leagueCode.localeCompare(right.leagueCode);
    });
  const years = new Set<number>();
  return candidates.filter((season) => {
    if (years.has(season.startYear)) return false;
    years.add(season.startYear);
    return true;
  });
}

function viewBackLabel(view: View) {
  return ({
    overview: "zum Überblick",
    players: "zu den Spielern",
    player: "zum Spielerprofil",
    teams: "zu den Mannschaften",
    team: "zur Mannschaft",
    history: "zur Historie",
    top: "zu den Top Players",
    manager: "zum Fantasy Team",
  } satisfies Record<View, string>)[view];
}

export default function App() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [filters, setFilters] = useState(initialFilters);
  const [view, setViewState] = useState<View>(initialView);
  const [playerId, setPlayerId] = useState<string | null>(() => new URLSearchParams(window.location.search).get("player"));
  const [teamId, setTeamId] = useState<string | null>(() => new URLSearchParams(window.location.search).get("team"));
  const [backStack, setBackStack] = useState<ViewLocation[]>([]);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [dashboardError, setDashboardError] = useState<string | null>(null);
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const navigationToken = useRef(0);
  const initialRoundRequest = useRef(requestedInitialRound());
  const initialRoundResolved = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    api.catalog(controller.signal)
      .then(setCatalog)
      .catch((reason: Error) => { if (!isAbort(reason)) setCatalogError(reason.message); });
    return () => controller.abort();
  }, []);

  const seasons = seasonsForLeague(catalog, filters.league);
  const teamSeasons = seasonsForTeam(catalog, teamId);
  const playerSeasons = seasonsForPlayer(catalog, playerId);
  const playerSeasonCandidates = catalog?.seasons.filter((season) => playerId && playerSeasonMembership(season, playerId)) ?? [];
  const newestSeason = seasons[0];
  const latestPublishedSeason = seasons.find((season) => season.latestRound > 0) ?? newestSeason;
  const requestedSeason = seasons.find((season) => String(season.startYear) === filters.season);
  const selectedTeamSeason = teamSeasons.find((season) => String(season.startYear) === filters.season) ?? teamSeasons[0];
  const selectedPlayerSeason = playerSeasonCandidates.find((season) => season.leagueCode === filters.league && String(season.startYear) === filters.season)
    ?? playerSeasons.find((season) => String(season.startYear) === filters.season)
    ?? playerSeasons[0];
  const selectedSeason = view === "overview" ? latestPublishedSeason : view === "manager" || view === "top" ? newestSeason : view === "team" ? selectedTeamSeason : view === "player" ? selectedPlayerSeason : requestedSeason;
  const roundCount = selectedSeason?.roundCount ?? (filters.league === "0003" ? 38 : 34);
  const latestRound = selectedSeason?.latestRound ?? 0;
  const teamSelectionPending = Boolean(selectedTeamSeason)
    && (filters.league !== selectedTeamSeason?.leagueCode || filters.season !== String(selectedTeamSeason?.startYear));
  const playerSelectionPending = Boolean(selectedPlayerSeason)
    && (filters.league !== selectedPlayerSeason?.leagueCode || filters.season !== String(selectedPlayerSeason?.startYear));

  useEffect(() => {
    if (initialRoundResolved.current || !selectedSeason) return;
    initialRoundResolved.current = true;
    const round = String(initialAvailableRound(selectedSeason, initialRoundRequest.current));
    if (round === filters.round) return;
    const next = { ...filters, round };
    setFilters(next);
    syncUrl(next, view, playerId, teamId);
  }, [selectedSeason?.id]);

  useEffect(() => {
    if (view !== "overview" || !latestPublishedSeason || filters.season === String(latestPublishedSeason.startYear)) return;
    const next = { ...filters, season: String(latestPublishedSeason.startYear), round: String(Math.max(1, latestPublishedSeason.latestRound)) };
    setFilters(next);
    syncUrl(next, "overview", null, null);
  }, [view, filters.league, filters.season, latestPublishedSeason?.startYear, latestPublishedSeason?.latestRound]);

  useEffect(() => {
    if ((view !== "manager" && view !== "top") || !newestSeason || filters.season === String(newestSeason.startYear)) return;
    const next = { ...filters, season: String(newestSeason.startYear), round: String(Math.max(1, newestSeason.latestRound)) };
    setFilters(next);
    syncUrl(next, view, null, null);
  }, [view, filters.league, filters.season, newestSeason?.startYear, newestSeason?.latestRound]);

  useEffect(() => {
    if (view !== "team" || !teamId || !selectedTeamSeason) return;
    const season = String(selectedTeamSeason.startYear);
    if (filters.league === selectedTeamSeason.leagueCode && filters.season === season) return;
    const next = {
      ...filters,
      league: selectedTeamSeason.leagueCode,
      season,
      round: String(Math.max(1, selectedTeamSeason.latestRound)),
    };
    setFilters(next);
    syncUrl(next, "team", null, teamId);
  }, [view, teamId, filters.league, filters.season, selectedTeamSeason?.id, selectedTeamSeason?.latestRound]);

  useEffect(() => {
    if (view !== "player" || !playerId || !selectedPlayerSeason) return;
    const season = String(selectedPlayerSeason.startYear);
    if (filters.league === selectedPlayerSeason.leagueCode && filters.season === season) return;
    const next = {
      ...filters,
      league: selectedPlayerSeason.leagueCode,
      season,
      round: String(Math.max(1, selectedPlayerSeason.latestRound)),
    };
    setFilters(next);
    syncUrl(next, "player", playerId, null);
  }, [view, playerId, filters.league, filters.season, selectedPlayerSeason?.id, selectedPlayerSeason?.latestRound]);

  useEffect(() => {
    if (view !== "overview" || !selectedSeason) return;
    if (latestRound < 1) {
      setDashboard(null);
      setDashboardError(null);
      setDashboardLoading(false);
      return;
    }
    const controller = new AbortController();
    setDashboardLoading(true);
    setDashboardError(null);
    api.dashboard(scopeQuery({ ...filters, season: String(selectedSeason.startYear), round: String(latestRound) }), controller.signal)
      .then(setDashboard)
      .catch((reason: Error) => { if (!isAbort(reason)) setDashboardError(reason.message); })
      .finally(() => setDashboardLoading(false));
    return () => controller.abort();
  }, [filters.league, filters.season, latestRound, selectedSeason, view]);

  const showMatchday = view === "players";

  function syncUrl(nextFilters: Filters, nextView: View, nextPlayer: string | null, nextTeam: string | null) {
    const params = scopeQuery(nextFilters);
    params.set("view", nextView);
    if (nextView === "player" && nextPlayer) params.set("player", nextPlayer);
    if (nextView === "team" && nextTeam) params.set("team", nextTeam);
    window.history.replaceState({}, "", `${window.location.pathname}?${params}`);
  }

  function rememberCurrentLocation() {
    setBackStack((stack) => [...stack, { view, filters: { ...filters }, playerId, teamId, scrollY: window.scrollY }]);
  }

  function scrollToTop() {
    navigationToken.current += 1;
    window.scrollTo({ top: 0 });
  }

  function restoreScrollPosition(top: number) {
    const token = ++navigationToken.current;
    const attempt = (remaining: number) => {
      if (navigationToken.current !== token) return;
      const available = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
      if (available >= top || remaining <= 0) {
        window.scrollTo({ top: Math.min(top, available) });
        return;
      }
      window.requestAnimationFrame(() => attempt(remaining - 1));
    };
    window.requestAnimationFrame(() => attempt(180));
  }

  function updateFilter(key: keyof Filters, value: string) {
    const next = { ...filters, [key]: value };
    if (key === "league") {
      const available = seasonsForLeague(catalog, value);
      const defaultSeason = view === "overview"
        ? available.find((season) => season.latestRound > 0) ?? available[0]
        : available[0];
      if (defaultSeason) next.season = String(defaultSeason.startYear);
    }
    const season = catalog?.seasons.find((item) => item.leagueCode === next.league && String(item.startYear) === next.season);
    if (season) next.round = key === "league" || key === "season"
      ? String(latestAvailableRound(season))
      : String(Math.min(Number(next.round), season.roundCount));
    setFilters(next);
    syncUrl(next, view, playerId, teamId);
  }

  function updateTeamSeason(value: string) {
    const season = teamSeasons.find((item) => String(item.startYear) === value);
    if (!season || !teamId) return;
    const next = {
      ...filters,
      league: season.leagueCode,
      season: String(season.startYear),
      round: String(Math.max(1, season.latestRound)),
    };
    setFilters(next);
    syncUrl(next, "team", null, teamId);
  }

  function updatePlayerSeason(value: string) {
    const season = playerSeasons.find((item) => String(item.startYear) === value);
    if (!season || !playerId) return;
    const next = {
      ...filters,
      league: season.leagueCode,
      season: String(season.startYear),
      round: String(Math.max(1, season.latestRound)),
    };
    setFilters(next);
    syncUrl(next, "player", playerId, null);
  }

  function setView(next: NavView) {
    const nextFilters = next === "overview" && latestPublishedSeason
      ? { ...filters, season: String(latestPublishedSeason.startYear), round: String(Math.max(1, latestPublishedSeason.latestRound)) }
      : (next === "manager" || next === "top") && newestSeason
        ? { ...filters, season: String(newestSeason.startYear), round: String(Math.max(1, newestSeason.latestRound)) }
      : next === "history" && requestedSeason
        ? { ...filters, round: String(Math.max(1, requestedSeason.latestRound)) }
        : filters;
    if (nextFilters !== filters) setFilters(nextFilters);
    setViewState(next);
    setPlayerId(null);
    setTeamId(null);
    setBackStack([]);
    syncUrl(nextFilters, next, null, null);
    scrollToTop();
  }

  function openPlayer(id: string) {
    rememberCurrentLocation();
    setPlayerId(id);
    setTeamId(null);
    setViewState("player");
    syncUrl(filters, "player", id, null);
    scrollToTop();
  }

  function openPlayerAt(id: string, season: string, round: number) {
    rememberCurrentLocation();
    const next = { ...filters, season, round: String(round) };
    setFilters(next);
    setPlayerId(id);
    setTeamId(null);
    setViewState("player");
    syncUrl(next, "player", id, null);
    scrollToTop();
  }

  function openTeam(id: string) {
    rememberCurrentLocation();
    setPlayerId(null);
    setTeamId(id);
    setViewState("team");
    syncUrl(filters, "team", null, id);
    scrollToTop();
  }

  function openTeamAt(id: string, season: string, round: number) {
    rememberCurrentLocation();
    const next = { ...filters, season, round: String(round) };
    setFilters(next);
    setPlayerId(null);
    setTeamId(id);
    setViewState("team");
    syncUrl(next, "team", null, id);
    scrollToTop();
  }

  function goBack(fallback: NavView) {
    const previous = backStack.at(-1);
    if (!previous) {
      setView(fallback);
      return;
    }
    setBackStack((stack) => stack.slice(0, -1));
    setFilters(previous.filters);
    setPlayerId(previous.playerId);
    setTeamId(previous.teamId);
    setViewState(previous.view);
    syncUrl(previous.filters, previous.view, previous.playerId, previous.teamId);
    restoreScrollPosition(previous.scrollY);
  }

  const title = view === "overview" ? "Die Saison auf einen Blick." : view === "player" ? "Spielerprofil" : view === "team" ? "Mannschaftsprofil" : nav.find((item) => item.id === view)?.label;
  const description = view === "overview"
    ? latestRound > 0 ? `Der neueste vollständige Stand für ${selectedSeason?.displayName ?? "die gewählte Saison"} — bis einschließlich Spieltag ${latestRound}.` : `Für ${selectedSeason?.displayName ?? "diese Saison"} liegt noch kein abgeschlossener Spieltag vor.`
    : view === "teams"
      ? "Alle Vereine über die gesamte importierte Saison vergleichen."
      : view === "team"
        ? "Kader, Spieltagspunkte und ihre Zusammensetzung im Detail."
      : view === "history"
        ? "Die besten Saisons vergleichen und jeden Spieltag im Archiv nachvollziehen."
        : view === "manager"
          ? "Eine datenbasierte Mannschaft mit Prognose und den tatsächlich erzielten Saisonpunkten."
        : view === "top"
          ? `Der kaufbare Spielerpool für ${newestSeason?.displayName ?? "die aktuelle Saison"} — eingeordnet mit allen abgeschlossenen Leistungen bis zum Saisonstart.`
          : "Spieltagswert und Saisonstand direkt nebeneinander.";
  const navActive: NavView = view === "player" ? "players" : view === "team" ? "teams" : view;
  const previousView = backStack.at(-1)?.view;
  const backLabel = previousView ? `Zurück ${viewBackLabel(previousView)}` : view === "team" ? "Zurück zu den Mannschaften" : "Zurück zu den Spielern";

  return (
    <div className="app-shell">
      <header className="site-header">
        <button className="brand" onClick={() => setView("overview")} aria-label="Punktespiegel Startseite">
          <img src={`${import.meta.env.BASE_URL}brand/punktespiegel-mark.svg`} alt="" aria-hidden="true" />
          <span>Punktespiegel</span>
        </button>
        <nav className="main-nav" aria-label="Bereiche">
          {nav.map((item) => (
            <button key={item.id} className={navActive === item.id ? "active" : ""} onClick={() => setView(item.id)}>
              {item.label}
            </button>
          ))}
        </nav>
      </header>

      <main>
        <section className="control-deck" aria-label="Datenauswahl">
          <div className="intro">
            <p className="kicker">kicker-Daten · kicker Manager-Liga</p>
            <h1>{title}</h1>
            <p>{description}</p>
          </div>
          {view !== "history" && view !== "top" && <div className="selectors">
            {view !== "team" && view !== "player" && <label><span>Liga</span><select value={filters.league} onChange={(event) => updateFilter("league", event.target.value)}>{catalog?.leagues.map((league) => <option value={league.code} key={league.code}>{league.name}</option>)}</select></label>}
            {view === "team"
              ? <label><span>Saison</span><select value={selectedTeamSeason?.startYear ?? filters.season} onChange={(event) => updateTeamSeason(event.target.value)}>{teamSeasons.map((season) => <option value={season.startYear} key={season.id}>{season.displayName}</option>)}</select></label>
              : view === "player"
                ? <label><span>Saison</span><select value={selectedPlayerSeason?.startYear ?? filters.season} onChange={(event) => updatePlayerSeason(event.target.value)}>{playerSeasons.map((season) => <option value={season.startYear} key={season.id}>{season.displayName}</option>)}</select></label>
              : view !== "overview" && view !== "manager" && <label><span>Saison</span><select value={filters.season} onChange={(event) => updateFilter("season", event.target.value)}>{seasons.map((season) => <option value={season.startYear} key={season.id}>{season.displayName}</option>)}</select></label>}
            {showMatchday && (
              <label>
                <span>Spieltag</span>
                <select value={filters.round} onChange={(event) => updateFilter("round", event.target.value)}>
                  {Array.from({ length: roundCount }, (_, index) => index + 1).map((round) => <option value={round} key={round}>{round}</option>)}
                </select>
              </label>
            )}
          </div>}
        </section>

        {catalogError ? <ErrorState message={catalogError} /> : !catalog ? <LoadingState /> : (
          <>
            {view === "overview" && (
              latestRound < 1 ? <section className="detail-section"><Empty message="Für diese Saison liegen noch keine Daten eines abgeschlossenen Spieltags vor." /></section>
                : dashboardError ? <ErrorState message={dashboardError} />
                : dashboardLoading || !dashboard ? <LoadingState />
                  : <Overview data={dashboard} onView={setView} onPlayer={openPlayer} onTeam={openTeam} />
            )}
            {view === "players" && <PlayersView filters={filters} onPlayer={openPlayer} />}
            {view === "player" && playerId && (playerSelectionPending ? <LoadingState /> : <PlayerDetailView filters={filters} playerId={playerId} backLabel={backLabel} onBack={() => goBack("players")} onTeam={openTeam} onSeason={(year) => updatePlayerSeason(String(year))} />)}
            {view === "teams" && <TeamsView filters={filters} onTeam={openTeam} />}
            {view === "team" && teamId && (teamSelectionPending ? <LoadingState /> : <TeamDetailView filters={filters} teamId={teamId} backLabel={backLabel} onBack={() => goBack("teams")} onPlayer={openPlayer} onTeam={openTeam} />)}
            {view === "history" && <HistoryView filters={filters} leagues={catalog.leagues} seasons={seasons} onFilter={updateFilter} onPlayer={openPlayerAt} onTeam={openTeamAt} />}
            {view === "top" && <TopPlayersView filters={filters} leagues={catalog.leagues} onFilter={updateFilter} onPlayer={openPlayer} />}
            {view === "manager" && <ManagerPicksView filters={filters} onPlayer={openPlayer} />}
            <footer className="data-footnote"><span>Datenbasis</span>Auf Basis öffentlicher kicker-Daten und der Wertungen der kicker Manager-Liga. Stand: importierter Datenbestand.</footer>
          </>
        )}
      </main>
    </div>
  );
}

function Overview({ data, onView, onPlayer, onTeam }: { data: Dashboard; onView: (view: NavView) => void; onPlayer: (id: string) => void; onTeam: (id: string) => void }) {
  return (
    <section className="overview-grid" aria-label="Saisonüberblick">
      <article className="dashboard-card team-pulse-card">
        <CardHead eyebrow={`Bis einschließlich Spieltag ${data.context.round}`} title="Mannschaftswertung" subtitle="Gesamtpunkte aller Spieler des Vereins" action={<button onClick={() => onView("teams")}>Alle Mannschaften</button>} />
        <TeamRanking teams={data.seasonTeams} matchday={data.context.round} scope="through" onTeam={onTeam} />
      </article>
      <article className="dashboard-card">
        <CardHead eyebrow="Gesamt" title="Aktuelle Rangliste" subtitle={`Gesamtpunkte bis Spieltag ${data.context.round}`} action={<button onClick={() => onView("players")}>Alle Spieler</button>} />
        <PlayerRanking players={data.leaderboards.overall} metric="points" onPlayer={onPlayer} />
      </article>
      <article className="dashboard-card position-card">
        <SimpleCardHead title="Nach Position" />
        <div className="position-columns">
          {(["GK", "DEF", "MID", "FWD"] as Position[]).map((position) => (
            <section key={position}>
              <h3>{positionName[position]}</h3>
              <PlayerRanking players={data.leaderboards.positions[position] ?? []} metric="points" onPlayer={onPlayer} scrollable />
            </section>
          ))}
        </div>
      </article>
      <article className="dashboard-card">
        <SimpleCardHead title="Noten" />
        <PlayerRanking players={data.leaderboards.grades} metric="grade" onPlayer={onPlayer} />
      </article>
      <article className="dashboard-card">
        <CardHead eyebrow="Abschluss" title="Tore" subtitle={`Bis Spieltag ${data.context.round}`} />
        <PlayerRanking players={data.leaderboards.goals} metric="goals" onPlayer={onPlayer} />
      </article>
      <article className="dashboard-card">
        <CardHead eyebrow="Vorbereitung" title="Vorlagen" subtitle={`Bis Spieltag ${data.context.round}`} />
        <PlayerRanking players={data.leaderboards.assists} metric="assists" onPlayer={onPlayer} />
      </article>
      <section className="action-leaderboards" aria-label="Sonderwertungen">
        <div className="action-section-head"><p className="kicker">Weitere Wertungen</p><h2>Sonderwertungen</h2><p>Kumulierte Werte bis Spieltag {data.context.round}</p></div>
        <div className="action-grid">
          <article className="dashboard-card action-card"><CardHead eyebrow="Torhüter" title="Weiße Westen" subtitle="Zu-null-Spiele" /><PlayerRanking players={data.leaderboards.cleanSheets} metric="cleanSheets" onPlayer={onPlayer} scrollable /></article>
          <article className="dashboard-card action-card"><CardHead eyebrow="Einsatz" title="Startelfpunkte" subtitle="Punkte aus Startelfeinsätzen" /><PlayerRanking players={data.leaderboards.starterPoints} metric="starterPoints" onPlayer={onPlayer} scrollable /></article>
          <article className="dashboard-card action-card discipline-card"><CardHead eyebrow="Disziplin" title="Platzverweise" subtitle="Gelb-Rot: −3 Pkt. · Rot: −6 Pkt." /><PlayerRanking players={data.leaderboards.cardDeductions} metric="cardDeductions" onPlayer={onPlayer} scrollable /></article>
          <article className="dashboard-card action-card"><CardHead eyebrow="Auszeichnung" title="Spieler des Spiels" subtitle="SdS-Auszeichnungen" /><PlayerRanking players={data.leaderboards.mvpAwards} metric="mvpAwards" onPlayer={onPlayer} scrollable /></article>
          <article className="dashboard-card action-card"><CardHead eyebrow="Einwechslung" title="Joker" subtitle="Joker-Boni" /><PlayerRanking players={data.leaderboards.jokerAwards} metric="jokerAwards" onPlayer={onPlayer} scrollable /></article>
        </div>
      </section>
    </section>
  );
}

function CardHead({ eyebrow, title, subtitle, action }: { eyebrow: string; title: string; subtitle: string; action?: ReactNode }) {
  return (
    <header className="card-head">
      <div><p className="kicker">{eyebrow}</p><h2>{title}</h2><span>{subtitle}</span></div>
      {action}
    </header>
  );
}

function SimpleCardHead({ title, action }: { title: string; action?: ReactNode }) {
  return <header className="simple-card-head"><h2>{title}</h2>{action}</header>;
}

function TeamRanking({ teams, matchday, scope, onTeam, expanded = false }: { teams: TeamScore[]; matchday: number; scope: "through" | "matchday"; onTeam: (id: string) => void; expanded?: boolean }) {
  const [metric, setMetric] = useState<TeamMetric>("overall");
  const listRef = useRef<HTMLOListElement>(null);
  const sorted = useMemo(() => [...teams].sort((a, b) => b[metric] - a[metric]), [teams, metric]);
  const selectedMetric = teamMetrics.find((item) => item.key === metric) ?? teamMetrics[0];
  useEffect(() => { listRef.current?.scrollTo({ top: 0 }); }, [teams, metric, matchday, scope]);
  return (
    <>
      <div className="metric-tabs" aria-label="Mannschaftsmetrik">
        {teamMetrics.map((item) => <button key={item.key} className={metric === item.key ? "active" : ""} onClick={() => setMetric(item.key)}>{item.short}</button>)}
      </div>
      <ol ref={listRef} className={`team-pulse-list ${expanded ? "expanded" : ""}`}>
        {sorted.map((team, index) => <TeamRankingRow key={team.id} team={team} index={index} metric={metric} selectedMetric={selectedMetric} matchday={matchday} scope={scope} onTeam={onTeam} />)}
      </ol>
    </>
  );
}

function TeamRankingRow({ team, index, metric, selectedMetric, matchday, scope, onTeam }: { team: TeamScore; index: number; metric: TeamMetric; selectedMetric: (typeof teamMetrics)[number]; matchday: number; scope: "through" | "matchday"; onTeam: (id: string) => void }) {
  const anchorRef = useRef<HTMLLIElement>(null);
  const tooltipId = useId();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const open = hovered || focused;
  return (
    <li ref={anchorRef} role="button" tabIndex={0} aria-describedby={open ? tooltipId : undefined} onClick={() => onTeam(team.id)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") onTeam(team.id); }} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}>
      <span className="rank">{index + 1}</span>
      <TeamLogo code={team.code} url={team.logoUrl} />
      <strong>{team.name}</strong>
      <span className="metric-number">{team[metric] || "—"} <small>Pkt.</small></span>
      <FloatingScorePopover anchorRef={anchorRef} open={open} id={tooltipId} className="team-pulse-popover" preferredWidth={410}>
        <header><strong>{team.name}</strong><span>{selectedMetric.label} · {scope === "through" ? `bis Spieltag ${matchday}` : `nur Spieltag ${matchday}`}</span></header>
        <ol>{team.topPlayers[selectedMetric.leaders].map((player, playerIndex) => <li key={player.id}><span>{playerIndex + 1}</span><strong>{player.name}</strong><small>{positionName[player.position]}</small><b>{player.points}</b></li>)}</ol>
      </FloatingScorePopover>
    </li>
  );
}

type RankingMetric = "points" | "grade" | "goals" | "assists" | "cleanSheets" | "starterPoints" | "cardDeductions" | "mvpAwards" | "jokerAwards";

function PlayerRanking({ players, metric, onPlayer, scrollable = false, scope = "season" }: { players: Player[]; metric: RankingMetric; onPlayer: (id: string) => void; scrollable?: boolean; scope?: "season" | "matchday" }) {
  if (!players.length) return <Empty message="Für diese Auswahl liegen keine Wertungen vor." />;
  const value = (player: Player) => {
    if (metric === "grade") return (scope === "matchday" ? player.roundGrade : player.averageGrade)?.toFixed(2) ?? "—";
    if (metric === "goals") return scope === "matchday" ? player.roundGoals : player.goals;
    if (metric === "assists") return scope === "matchday" ? player.roundAssists : player.assists;
    if (metric === "cleanSheets") return scope === "matchday" ? player.roundCleanSheets : player.cleanSheets;
    if (metric === "starterPoints") return scope === "matchday" ? player.roundStarterPoints : player.starterPoints;
    if (metric === "cardDeductions") return formatPenalty(scope === "matchday" ? player.roundCardPoints : player.cardPoints);
    if (metric === "mvpAwards") return scope === "matchday" ? player.roundMvpAwards : player.mvpAwards;
    if (metric === "jokerAwards") return scope === "matchday" ? player.roundJokerAwards : player.jokerAwards;
    return scope === "matchday" ? player.roundPoints : player.observedPoints;
  };
  const suffix = metric === "grade" ? "Note" : metric === "points" || metric === "starterPoints" || metric === "cardDeductions" ? "Pkt." : metric === "goals" ? "Tore" : metric === "assists" ? "Vorlagen" : metric === "cleanSheets" ? "Spiele" : metric === "mvpAwards" ? "SdS" : "Boni";
  return (
    <ol className={`player-ranking ${scrollable ? "scrollable" : ""}`}>
      {players.map((player, index) => (
        <li key={player.id}>
          <button onClick={() => onPlayer(player.id)}>
            <span className="rank">{index + 1}</span>
            <TeamLogo code={player.teamCode} url={player.logoUrl} />
            <span className="player-identity"><strong>{player.name}</strong><small>{metric === "cardDeductions" ? `${player.team} · ${formatCardCounts(scope === "matchday" ? player.roundRedCards : player.redCards, scope === "matchday" ? player.roundYellowRedCards : player.yellowRedCards)}` : `${player.team} · ${positionName[player.position]}`}</small></span>
            <span className="ranking-value"><strong>{value(player)}</strong><small>{suffix}</small></span>
          </button>
        </li>
      ))}
    </ol>
  );
}

function HistoryView({ filters, leagues, seasons, onFilter, onPlayer, onTeam }: { filters: Filters; leagues: Catalog["leagues"]; seasons: Catalog["seasons"]; onFilter: (key: keyof Filters, value: string) => void; onPlayer: (id: string, season: string, round: number) => void; onTeam: (id: string, season: string, round: number) => void }) {
  const selectedSeason = seasons.find((season) => String(season.startYear) === filters.season);
  const [history, setHistory] = useState<History | null>(null);
  const [archive, setArchive] = useState<Dashboard | null>(null);
  const [archiveEleven, setArchiveEleven] = useState<BestEleven | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const archiveMaximum = Math.max(1, selectedSeason?.latestRound ?? 0);
  const archiveRound = Math.min(archiveMaximum, Math.max(1, Number(filters.round) || 1));
  const seasonDetailRound = Math.max(1, selectedSeason?.latestRound ?? 0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setHistoryError(null);
    api.history(new URLSearchParams({ league: filters.league, season: filters.season }), controller.signal)
      .then(setHistory)
      .catch((reason: Error) => { if (!isAbort(reason)) setHistoryError(reason.message); })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [filters.league, filters.season]);

  useEffect(() => {
    if (!filters.season) return;
    const controller = new AbortController();
    const params = new URLSearchParams({ league: filters.league, season: filters.season, round: String(archiveRound) });
    const bestParams = new URLSearchParams(params);
    bestParams.set("scope", "matchday");
    setArchiveError(null);
    Promise.all([api.dashboard(params, controller.signal), api.bestEleven(bestParams, controller.signal)])
      .then(([dashboard, eleven]) => { setArchive(dashboard); setArchiveEleven(eleven); })
      .catch((reason: Error) => { if (!isAbort(reason)) { setArchive(null); setArchiveEleven(null); setArchiveError(reason.message); } });
    return () => controller.abort();
  }, [archiveRound, filters.league, filters.season]);

  if (historyError) return <ErrorState message={historyError} />;
  if (loading || !history) return <LoadingState />;
  return (
    <div className="history-view">
      <div className="history-toolbar" aria-label="Historienauswahl">
        <label><span>Liga</span><select value={filters.league} onChange={(event) => onFilter("league", event.target.value)}>{leagues.map((league) => <option value={league.code} key={league.code}>{league.name}</option>)}</select></label>
        <label><span>Saison</span><select value={filters.season} onChange={(event) => onFilter("season", event.target.value)}>{seasons.map((season) => <option value={season.startYear} key={season.id}>{season.displayName}</option>)}</select></label>
        <div className="history-round-control"><button aria-label="Vorheriger Spieltag" disabled={archiveRound <= 1} onClick={() => onFilter("round", String(Math.max(1, archiveRound - 1)))}>←</button><label><span>Spieltag</span><select value={archiveRound} onChange={(event) => onFilter("round", event.target.value)}>{Array.from({ length: archiveMaximum }, (_, index) => index + 1).map((round) => <option value={round} key={round}>{round}</option>)}</select></label><button aria-label="Nächster Spieltag" disabled={archiveRound >= archiveMaximum} onClick={() => onFilter("round", String(Math.min(archiveMaximum, archiveRound + 1)))}>→</button></div>
      </div>
      <section className="detail-section history-section">
        <div className="detail-head"><div><p className="kicker">Saisonrangliste</p><h2>Beste Saisonleistungen</h2></div><span>{selectedSeason?.displayName}</span></div>
        <HistoricalRanking players={history.leaderboards.overall} metric="points" onPlayer={(id) => onPlayer(id, filters.season, seasonDetailRound)} />
      </section>

      <section className="detail-section history-section">
        <SimpleCardHead title="Nach Position" />
        <div className="history-position-grid">
          {(["GK", "DEF", "MID", "FWD"] as Position[]).map((position) => <section key={position}><h3>{positionName[position]}</h3><HistoricalRanking players={history.leaderboards.positions[position] ?? []} metric="points" onPlayer={(id) => onPlayer(id, filters.season, seasonDetailRound)} /></section>)}
        </div>
      </section>

      <div className="history-metric-grid">
        <section className="detail-section history-section"><SimpleCardHead title="Noten" /><HistoricalRanking players={history.leaderboards.grades} metric="grade" onPlayer={(id) => onPlayer(id, filters.season, seasonDetailRound)} /></section>
        <section className="detail-section history-section"><SimpleCardHead title="Tore" /><HistoricalRanking players={history.leaderboards.goals} metric="goals" onPlayer={(id) => onPlayer(id, filters.season, seasonDetailRound)} /></section>
        <section className="detail-section history-section"><SimpleCardHead title="Vorlagen" /><HistoricalRanking players={history.leaderboards.assists} metric="assists" onPlayer={(id) => onPlayer(id, filters.season, seasonDetailRound)} /></section>
      </div>

      <section className="detail-section archive-section">
        <div className="archive-head">
          <div><p className="kicker">Spieltagsarchiv</p><h2>Spieltag für Spieltag</h2><p>Exakte Wertungen eines Spieltags — Mannschaften, Spieler, Positionen und die beste Elf.</p></div>
          <span>Spieltag {archiveRound}</span>
        </div>
        {archiveError ? <ErrorState message={archiveError} /> : archive && archiveEleven ? (
          <div className="archive-grid">
            <article className="archive-card archive-team archive-comparison-card"><CardHead eyebrow={`Nur Spieltag ${archiveRound}`} title="Mannschaftswertung" subtitle="Gesamtpunkte aller Spieler an diesem Spieltag" /><TeamRanking teams={archive.matchdayTeams} matchday={archiveRound} scope="matchday" onTeam={(id) => onTeam(id, filters.season, archiveRound)} /></article>
            <article className="archive-card archive-comparison-card"><SimpleCardHead title="Spieltagsrangliste" /><PlayerRanking players={archive.matchdayLeaderboards.overall} metric="points" scope="matchday" scrollable onPlayer={(id) => onPlayer(id, filters.season, archiveRound)} /></article>
            <article className="archive-card archive-wide"><SimpleCardHead title="Nach Position" /><div className="position-columns">{(["GK", "DEF", "MID", "FWD"] as Position[]).map((position) => <section key={position}><h3>{positionName[position]}</h3><PlayerRanking players={archive.matchdayLeaderboards.positions[position] ?? []} metric="points" scope="matchday" scrollable onPlayer={(id) => onPlayer(id, filters.season, archiveRound)} /></section>)}</div></article>
            <article className="archive-card"><SimpleCardHead title="Noten" /><PlayerRanking players={archive.matchdayLeaderboards.grades} metric="grade" scope="matchday" scrollable onPlayer={(id) => onPlayer(id, filters.season, archiveRound)} /></article>
            <article className="archive-card"><SimpleCardHead title="Tore" /><PlayerRanking players={archive.matchdayLeaderboards.goals} metric="goals" scope="matchday" scrollable onPlayer={(id) => onPlayer(id, filters.season, archiveRound)} /></article>
            <article className="archive-card"><SimpleCardHead title="Vorlagen" /><PlayerRanking players={archive.matchdayLeaderboards.assists} metric="assists" scope="matchday" scrollable onPlayer={(id) => onPlayer(id, filters.season, archiveRound)} /></article>
            <ArchiveBestEleven eleven={archiveEleven} onPlayer={(id) => onPlayer(id, filters.season, archiveRound)} />
          </div>
        ) : <LoadingState />}
      </section>
    </div>
  );
}

function HistoricalRanking({ players, metric, onPlayer }: { players: HistoricalPlayer[]; metric: "points" | "grade" | "goals" | "assists"; onPlayer: (id: string) => void }) {
  const value = (player: HistoricalPlayer) => metric === "grade" ? player.averageGrade?.toFixed(2) ?? "—" : metric === "goals" ? player.goals : metric === "assists" ? player.assists : player.points;
  const suffix = metric === "grade" ? "Note" : metric === "points" ? "Pkt." : metric === "goals" ? "Tore" : "Vorlagen";
  return <ol className="historical-ranking">{players.map((player, index) => <li key={player.id}><button onClick={() => onPlayer(player.id)}><span className="history-rank">{String(index + 1).padStart(2, "0")}</span><PlayerPortrait name={player.name} url={player.photoUrl} teamCode={player.teamCode} teamLogoUrl={player.logoUrl} /><span className="player-identity"><strong>{player.name}</strong><small>{player.team} · {positionName[player.position]}</small></span><span className="ranking-value"><strong>{value(player)}</strong><small>{suffix}</small></span></button></li>)}</ol>;
}

function ArchiveBestEleven({ eleven, onPlayer }: { eleven: BestEleven; onPlayer: (id: string) => void }) {
  const grouped = groupBestEleven(eleven.players);
  return <article className="archive-card archive-wide archive-eleven"><div className="detail-head"><div><p className="kicker">Nur dieser Spieltag</p><h2>Beste Elf · Spieltag {eleven.matchday}</h2><p>Die elf punktstärksten Spieler in einer zulässigen Formation.</p></div><div className="best-summary"><strong>{eleven.points}</strong><span>Punkte</span><b>{eleven.formation}</b></div></div><div className="best-pitch compact-pitch">{(["FWD", "MID", "DEF", "GK"] as Position[]).map((position) => <div className="best-row" key={position}>{grouped[position].map((player) => <BestPlayerCard key={player.id} player={player} onClick={() => onPlayer(player.id)} />)}</div>)}</div></article>;
}

function PlayersView({ filters, onPlayer }: { filters: Filters; onPlayer: (id: string) => void }) {
  const [query, setQuery] = useState("");
  const [position, setPosition] = useState("");
  const [sort, setSort] = useState<PlayerSort>("points");
  const [direction, setDirection] = useState<"asc" | "desc">("desc");
  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const params = scopeQuery(filters);
    params.set("limit", "100");
    params.set("sort", sort);
    params.set("direction", direction);
    if (query) params.set("q", query);
    if (position) params.set("position", position);
    setLoading(true);
    setError(null);
    async function loadAllPlayers() {
      const items: Player[] = [];
      let offset = 0;
      while (true) {
        params.set("offset", String(offset));
        const result = await api.players(params, controller.signal);
        items.push(...result.items);
        if (result.nextOffset == null) break;
        offset = result.nextOffset;
      }
      return items;
    }
    loadAllPlayers()
      .then(setPlayers)
      .catch((reason: Error) => { if (!isAbort(reason)) setError(reason.message); })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [filters, query, position, sort, direction]);

  function sortBy(column: PlayerSort) {
    if (column === sort) setDirection((value) => value === "asc" ? "desc" : "asc");
    else {
      setSort(column);
      setDirection(column === "name" || column === "position" || column === "grade" ? "asc" : "desc");
    }
  }

  return (
    <section className="detail-section">
      <div className="detail-head">
        <div><p className="kicker">Spielerwertung</p><h2>Spielerpool vergleichen</h2><p>Tabellenkopf anklicken, um neu zu sortieren. Der Wert entspricht den Gesamtpunkten je Marktwert-Million.</p></div>
        <span>{players.length} Spieler angezeigt</span>
      </div>
      <div className="filter-row">
        <label className="search"><span>Suche</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Spieler oder Mannschaft" /></label>
        <label><span>Position</span><select value={position} onChange={(event) => setPosition(event.target.value)}><option value="">Alle Positionen</option>{(["GK", "DEF", "MID", "FWD"] as Position[]).map((item) => <option key={item} value={item}>{positionName[item]}</option>)}</select></label>
      </div>
      {error ? <ErrorState message={error} /> : (
        <div className={`table-shell player-table ${loading ? "is-loading" : ""}`}>
          <table>
            <thead><tr>
              <SortableHead label="Spieler" column="name" active={sort} direction={direction} onSort={sortBy} />
              <SortableHead label="Position" column="position" active={sort} direction={direction} onSort={sortBy} />
              <SortableHead label="Marktwert" column="price" active={sort} direction={direction} onSort={sortBy} numeric />
              <SortableHead label={`Spieltag ${filters.round}`} column="round" active={sort} direction={direction} onSort={sortBy} numeric />
              <SortableHead label={`Gesamt bis Spieltag ${filters.round}`} column="points" active={sort} direction={direction} onSort={sortBy} numeric />
              <SortableHead label="Tore" column="goals" active={sort} direction={direction} onSort={sortBy} numeric />
              <SortableHead label="Vorlagen" column="assists" active={sort} direction={direction} onSort={sortBy} numeric />
              <SortableHead label="Ø-Note" column="grade" active={sort} direction={direction} onSort={sortBy} numeric />
              <SortableHead label="Wert · Pkt. / Mio. €" column="value" active={sort} direction={direction} onSort={sortBy} numeric />
            </tr></thead>
            <tbody>
              {players.map((player, index) => (
                <tr key={player.id} className="clickable-row" tabIndex={0} onClick={() => onPlayer(player.id)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") onPlayer(player.id); }}>
                  <td><div className="table-player"><span className="rank">{index + 1}</span><PlayerPortrait name={player.name} url={player.photoUrl} teamCode={player.teamCode} teamLogoUrl={player.logoUrl} /><span><strong>{player.name}</strong><small>{player.team}</small></span></div></td>
                  <td><PositionTag position={player.position} /></td>
                  <td className="num">{formatMarketValue(player.priceM)}</td>
                  <td className="num matchday-score">{player.roundPoints}</td>
                  <td className="num primary-num">{player.observedPoints}</td>
                  <td className="num">{player.goals}</td>
                  <td className="num">{player.assists}</td>
                  <td className="num">{player.averageGrade?.toFixed(2) ?? "—"}</td>
                  <td className="num">{formatPlayerValue(player.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && !players.length && <Empty message="Keine Spieler entsprechen diesen Filtern." />}
        </div>
      )}
    </section>
  );
}

function SortableHead({ label, column, active, direction, onSort, numeric = false }: { label: string; column: PlayerSort; active: PlayerSort; direction: "asc" | "desc"; onSort: (column: PlayerSort) => void; numeric?: boolean }) {
  return <th className={numeric ? "num" : ""} aria-sort={active === column ? (direction === "asc" ? "ascending" : "descending") : "none"}><button className="sort-button" onClick={() => onSort(column)}>{label}<span>{active === column ? (direction === "asc" ? "↑" : "↓") : "↕"}</span></button></th>;
}

function PlayerDetailView({ filters, playerId, backLabel, onBack, onTeam, onSeason }: { filters: Filters; playerId: string; backLabel: string; onBack: () => void; onTeam: (id: string) => void; onSeason: (year: number) => void }) {
  const [detail, setDetail] = useState<PlayerDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    api.player(playerId, scopeQuery(filters, false), controller.signal)
      .then(setDetail)
      .catch((reason: Error) => { if (!isAbort(reason)) setError(reason.message); })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [filters.league, filters.season, playerId]);
  if (error) return <ErrorState message={error} />;
  if (loading || !detail) return <LoadingState />;
  return (
    <section className="detail-section player-detail-section">
      <button className="back-button" onClick={onBack}>← {backLabel}</button>
      <header className="player-profile">
        <PlayerPortrait name={detail.name} url={detail.photoUrl} teamCode={detail.teamCode} teamLogoUrl={detail.logoUrl} large />
        <div className="profile-copy"><p className="kicker">{positionName[detail.position]}</p><h2>{detail.name}</h2><div className="profile-context"><button className="profile-team-link" onClick={() => onTeam(detail.teamId)}>{detail.team}</button><span>{detail.league} · {detail.season}</span></div><div className="profile-links"><a href={detail.kickerUrl} target="_blank" rel="noreferrer">kicker-Profil ↗</a><a href={detail.transfermarktUrl} target="_blank" rel="noreferrer">Bei Transfermarkt suchen ↗</a></div></div>
        <div className="profile-stats">
          <span><strong>{detail.seasonPoints}</strong><small>Saisonpunkte</small></span>
          <span><strong>{formatMarketValue(detail.priceM)}</strong><small>Marktwert</small></span>
          <span><strong>{formatPlayerValue(detail.value)}</strong><small>Wert · Pkt. / Mio. €</small></span>
        </div>
      </header>
      <PlayerNewsSection news={detail.news} kickerNewsUrl={detail.kickerNewsUrl} />
      <section className="player-seasons">
        <div className="section-copy"><h3>Punkte nach Saison</h3><p>Verein, Einsätze und benotete Spiele je Saison.</p></div>
        <div className="table-shell player-season-table">
          <table><thead><tr><th>Jahr</th><th>Verein</th><th>Liga</th><th className="num">Einsätze</th><th className="num">Benotet</th><th className="num">Gesamtpunkte</th></tr></thead>
            <tbody>{detail.seasons.map((season) => (
              <tr key={season.startYear} className={`clickable-row ${season.startYear === detail.startYear ? "selected" : ""}`} tabIndex={0} onClick={() => onSeason(season.startYear)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") onSeason(season.startYear); }}>
                <td><strong>{season.season}</strong></td>
                <td><span className="season-team-list">{season.teams.map((team) => <span key={team.id}><TeamLogo code={team.code} url={team.logoUrl} /><strong>{team.name}</strong></span>)}</span></td>
                <td>{season.league}</td>
                <td className="num">{season.appearances}</td>
                <td className="num">{season.gradedAppearances}</td>
                <td className="num primary-num">{season.points}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </section>
      <div className="section-copy"><p className="kicker">Saisonverlauf</p><h3>Jeder Einsatz und jede Punkteaktion</h3></div>
      <div className="table-shell game-table">
        <table><thead><tr><th>Spieltag</th><th>Datum</th><th>Gegner</th><th>Ergebnis</th><th className="num">Punkte</th><th className="num">Note</th><th className="num">Tore</th><th className="num">Vorlagen</th><th className="num">Zu null</th><th className="num">Startelf</th><th className="num">Karten</th><th className="num">SdS</th><th className="num">Joker</th></tr></thead>
          <tbody>{detail.games.map((game) => <GameRow key={game.matchday} game={game} onTeam={onTeam} />)}</tbody>
        </table>
      </div>
    </section>
  );
}

function PlayerNewsSection({ news, kickerNewsUrl }: { news: PlayerDetail["news"]; kickerNewsUrl: string }) {
  return (
    <section className="player-news" aria-labelledby="player-news-title">
      <div className="section-copy news-heading">
        <div><p className="kicker">Medienbeobachtung</p><h3 id="player-news-title">In den Nachrichten</h3></div>
        <div className="news-actions">
          {news.generatedAt && <span>Stand {formatDate(news.generatedAt)}</span>}
          <a href={kickerNewsUrl} target="_blank" rel="noreferrer">Alle kicker-Spieler-News ↗</a>
        </div>
      </div>
      {news.articles.length ? (
        <ol className="news-list">
          {news.articles.map((article) => (
            <li key={article.url}>
              <a href={article.url} target="_blank" rel="noreferrer">
                <span><time dateTime={article.publishedAt}>{formatDate(article.publishedAt)}</time><b>{article.source}</b></span>
                <strong>{article.title}</strong>
                <small>{article.domain} ↗</small>
              </a>
            </li>
          ))}
        </ol>
      ) : <p className="news-empty">Im automatischen Nachrichtenfeed wurden keine passenden Überschriften gefunden. Das vollständige kicker-Spielerarchiv ist über den Link oben erreichbar.</p>}
    </section>
  );
}

function ManagerPicksView({ filters, onPlayer }: { filters: Filters; onPlayer: (id: string) => void }) {
  const [mode, setMode] = useState<ManagerMode>("classic");
  const [recommendation, setRecommendation] = useState<ManagerRecommendation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    api.managerPicks(scopeQuery(filters, false), mode, controller.signal)
      .then(setRecommendation)
      .catch((reason: Error) => { if (!isAbort(reason)) setError(reason.message); })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [filters.league, filters.season, mode]);

  if (error) return <ErrorState message={error} />;
  const starters = recommendation?.players.filter((player) => player.role === "start") ?? [];
  const reserves = recommendation?.players.filter((player) => player.role === "reserve") ?? [];
  return (
    <div className="manager-view">
      <div className="manager-toolbar">
        <div className="scope-switch" aria-label="Spielmodus">
          <button className={mode === "classic" ? "active" : ""} onClick={() => setMode("classic")}>Classic</button>
          <button className={mode === "interactive" ? "active" : ""} onClick={() => setMode("interactive")}>Interactive</button>
        </div>
        <p>{mode === "classic" ? "15 Spieler · feste 4-4-2-Aufstellung" : "22 Spieler · beste der sieben erlaubten Formationen"}</p>
      </div>
      {loading || !recommendation ? <LoadingState /> : (
        <>
          <section className="detail-section manager-summary-section">
            <div className="detail-head">
              <div><p className="kicker">Modellvorschlag · {recommendation.season}</p><h2>Fantasy Team</h2><p>Optimiert nach Punkteprognose sowie Positions-, Formations- und Vereinsregeln. Prognosen sind Erwartungswerte, keine Garantie.</p></div>
              <span>{recommendation.leagueName}</span>
            </div>
            <div className="manager-stats">
              <span><strong>{recommendation.formation}</strong><small>Startformation</small></span>
              <span><strong>{recommendation.projectedStartingPoints}</strong><small>Projizierte Punkte</small></span>
              <span><strong>{recommendation.currentStartingPoints}</strong><small>Aktuelle Punkte{recommendation.matchdays.length ? ` · bis Spieltag ${recommendation.matchdays.at(-1)?.matchday}` : ""}</small></span>
            </div>
          </section>
          <div className="manager-squad-grid">
            <section className="detail-section manager-lineup">
              <div className="section-copy"><p className="kicker">Startelf</p><h3>Formation {recommendation.formation}</h3></div>
              <div className="manager-position-groups">
                {(["GK", "DEF", "MID", "FWD"] as Position[]).map((position) => (
                  <section key={position}><h4>{positionName[position]}</h4><div>{starters.filter((player) => player.position === position).map((player) => <ManagerPlayerCard key={player.id} player={player} onClick={() => onPlayer(player.id)} />)}</div></section>
                ))}
              </div>
              <section className="manager-reserves manager-reserves-inline">
                <div className="section-copy"><p className="kicker">Reserve</p><h3>Ersatzbank</h3></div>
                <ol>{reserves.map((player) => <li key={player.id}><ManagerPlayerRow player={player} onClick={() => onPlayer(player.id)} /></li>)}</ol>
              </section>
            </section>
          </div>
          <section className="detail-section fantasy-matchdays">
            <div className="section-copy"><p className="kicker">Saisonverlauf</p><h3>Punkte je Spieltag</h3><p>Gesamt- und Positionspunkte auf einen Blick. Aufklappen zeigt die Einzelwerte der Startelf.</p></div>
            {recommendation.matchdays.length ? (
              <div className="fantasy-matchday-list">
                {recommendation.matchdays.map((matchday) => <FantasyMatchdayCard key={matchday.matchday} matchday={matchday} onPlayer={onPlayer} />)}
              </div>
            ) : <p className="fantasy-matchdays-empty">Für diese Saison sind noch keine Spieltagspunkte verfügbar.</p>}
          </section>
        </>
      )}
    </div>
  );
}

function ManagerPlayerCard({ player, onClick }: { player: ManagerRecommendation["players"][number]; onClick: () => void }) {
  return <button className="manager-player-card" onClick={onClick}><PlayerPortrait name={player.name} url={player.photoUrl} teamCode={player.teamCode} teamLogoUrl={player.logoUrl} /><span><strong>{player.name}</strong><small>{player.team}</small></span><b>{player.currentPoints} Pkt.<small>aktuell</small></b>{player.promotionAdjusted && <em>Ligastufe korrigiert</em>}</button>;
}

function ManagerPlayerRow({ player, onClick }: { player: ManagerRecommendation["players"][number]; onClick: () => void }) {
  const confidence = ({ high: "hoch", medium: "mittel", low: "gering" } as const)[player.confidence];
  return <button onClick={onClick}><PlayerPortrait name={player.name} url={player.photoUrl} teamCode={player.teamCode} teamLogoUrl={player.logoUrl} /><span><strong>{player.name}</strong><small>{positionName[player.position]} · {player.team}{player.promotionAdjusted ? " · Ligastufe korrigiert" : ""}</small></span><span><b>{player.currentPoints}</b><small>Aktuell</small></span><em className={`confidence ${player.confidence}`}>{confidence}</em></button>;
}

function FantasyMatchdayCard({ matchday, onPlayer }: { matchday: ManagerRecommendation["matchdays"][number]; onPlayer: (id: string) => void }) {
  const positions = [
    { label: "TW", value: matchday.positionPoints.GK },
    { label: "ABW", value: matchday.positionPoints.DEF },
    { label: "MIT", value: matchday.positionPoints.MID },
    { label: "Sturm", value: matchday.positionPoints.FWD },
  ];
  return (
    <details className="fantasy-matchday-card">
      <summary>
        <span className="matchday-badge">Spieltag {matchday.matchday}</span>
        <span className="fantasy-summary-positions">{positions.map((position) => <span key={position.label}><small>{position.label}</small><strong>{position.value}</strong></span>)}</span>
        <span className="fantasy-matchday-total"><strong>{matchday.totalPoints}</strong><small>Punkte</small></span>
        <span className="fantasy-matchday-toggle" aria-hidden="true">⌄</span>
      </summary>
      <ol className="fantasy-player-points">
        {matchday.players.map((player) => (
          <li key={player.id}><button onClick={() => onPlayer(player.id)}><PlayerPortrait name={player.name} url={player.photoUrl} teamCode={player.teamCode} teamLogoUrl={player.logoUrl} /><span><strong>{player.name}</strong><small>{positionName[player.position]} · {player.team}</small></span><b className={player.points < 0 ? "negative" : ""}>{player.points > 0 ? `+${player.points}` : player.points}</b></button></li>
        ))}
      </ol>
    </details>
  );
}

function GameRow({ game, onTeam }: { game: PlayerGame; onTeam: (id: string) => void }) {
  const result = game.homeScore == null || game.awayScore == null ? "—" : `${game.homeScore}–${game.awayScore}`;
  return (
    <tr>
      <td><strong>{game.matchday}</strong></td>
      <td>{formatDate(game.scheduledAt)}</td>
      <td><button className="opponent" onClick={() => onTeam(game.opponentId)}><TeamLogo code={game.opponentCode} url={game.opponentLogoUrl} /><span><strong>{game.opponent}</strong><small>{formatVenue(game.venue)}</small></span></button></td>
      <td>{result}</td>
      <td className="num primary-num">{game.points}</td>
      <td className="num"><ActionValue value={game.grade?.toFixed(2) ?? "—"} points={game.pointsGrade} /></td>
      <td className="num"><ActionValue value={game.goals || "—"} points={game.pointsGoals} /></td>
      <td className="num"><ActionValue value={game.assists || "—"} points={game.pointsAssists} /></td>
      <td className="num"><ActionValue points={game.pointsCleanSheet} /></td>
      <td className="num"><ActionValue points={game.pointsStarter} /></td>
      <td className="num"><CardActionValue points={game.pointsCards} /></td>
      <td className="num"><ActionValue points={game.pointsMvp} /></td>
      <td className="num"><ActionValue points={game.pointsJoker} /></td>
    </tr>
  );
}

function ActionValue({ value, points }: { value?: string | number; points: number }) {
  return <span className="action-value">{value != null && <strong>{value}</strong>}<small className={points < 0 ? "negative" : ""}>{points > 0 ? `+${points}` : points || "—"} Pkt.</small></span>;
}

function CardActionValue({ points }: { points: number }) {
  const label = points === -3 ? "Gelb-Rot" : points === -6 ? "Rot" : points < 0 ? "Platzverweis" : "—";
  return <span className="action-value discipline-action"><strong>{label}</strong><small className={points < 0 ? "negative" : ""}>{points ? `${formatPenalty(points)} Pkt.` : "—"}</small></span>;
}

function TeamDetailView({ filters, teamId, backLabel, onBack, onPlayer, onTeam }: { filters: Filters; teamId: string; backLabel: string; onBack: () => void; onPlayer: (id: string) => void; onTeam: (id: string) => void }) {
  const [detail, setDetail] = useState<TeamDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    api.team(teamId, scopeQuery(filters, false), controller.signal)
      .then(setDetail)
      .catch((reason: Error) => { if (!isAbort(reason)) setError(reason.message); })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [filters.league, filters.season, teamId]);
  if (error) return <ErrorState message={error} />;
  if (loading || !detail) return <LoadingState />;
  const totalPoints = detail.matches.reduce((sum, match) => sum + match.totalPoints, 0);
  return (
    <div className="team-detail-view">
      <section className="detail-section team-detail-section">
        <button className="back-button" onClick={onBack}>← {backLabel}</button>
        <header className="team-profile">
          <TeamLogo code={detail.code} url={detail.logoUrl} large />
          <div><p className="kicker">Mannschaftsprofil</p><h2>{detail.name}</h2><span>Alle Wertungen der ausgewählten Saison</span></div>
          <div className="team-profile-stats"><span><strong>{totalPoints}</strong><small>Gesamtpunkte</small></span><span><strong>{detail.players.length}</strong><small>Spieler</small></span></div>
        </header>
        <div className="team-detail-grid">
          <article className="team-roster-card">
            <CardHead eyebrow="Kader" title="Spieler und Punkte" subtitle="Klicken für das Spielerprofil" />
            <ol className="team-roster-list">
              {detail.players.map((player, index) => (
                <li key={player.id}><button onClick={() => onPlayer(player.id)}><span className="rank">{index + 1}</span><PlayerPortrait name={player.name} url={player.photoUrl} teamCode={detail.code} teamLogoUrl={detail.logoUrl} /><span className="player-identity"><strong>{player.name}</strong><small>{positionName[player.position]}</small></span><span className="ranking-value"><strong>{player.points}</strong><small>Pkt.</small></span></button></li>
              ))}
            </ol>
          </article>
          <article className="team-season-summary">
            <CardHead eyebrow="Saisonverlauf" title="Jedes Spiel im Detail" subtitle="Punkte nach Mannschaftsteil und Aktion" />
            <div className="team-match-list">
              {detail.matches.map((match) => <TeamMatchCard key={match.matchday} match={match} onTeam={onTeam} onPlayer={onPlayer} />)}
            </div>
          </article>
        </div>
      </section>
    </div>
  );
}

const teamMatchActions: { key: keyof TeamDetailMatch; label: string }[] = [
  { key: "gradePoints", label: "Noten" },
  { key: "goalPoints", label: "Tore" },
  { key: "assistPoints", label: "Vorlagen" },
  { key: "cleanSheetPoints", label: "Zu null" },
  { key: "starterPoints", label: "Startelf" },
  { key: "mvpPoints", label: "SdS" },
  { key: "jokerPoints", label: "Joker" },
];

function TeamMatchCard({ match, onTeam, onPlayer }: { match: TeamDetailMatch; onTeam: (id: string) => void; onPlayer: (id: string) => void }) {
  const positionParts = [
    { label: "TW", position: "GK" as Position, value: match.goalkeeperPoints, className: "gk" },
    { label: "ABW", position: "DEF" as Position, value: match.defencePoints, className: "def" },
    { label: "MIT", position: "MID" as Position, value: match.midfieldPoints, className: "mid" },
    { label: "Sturm", position: "FWD" as Position, value: match.forwardPoints, className: "fwd" },
  ];
  const visualTotal = positionParts.reduce((sum, part) => sum + Math.abs(part.value), 0);
  const result = match.homeScore == null || match.awayScore == null ? "—" : `${match.homeScore}–${match.awayScore}`;
  return (
    <section className="team-match-card">
      <header>
        <span className="matchday-badge">Spieltag {match.matchday}</span>
        <button className="team-match-opponent" onClick={() => onTeam(match.opponentId)}><TeamLogo code={match.opponentCode} url={match.opponentLogoUrl} /><span><strong>{match.opponent}</strong><small>{formatDate(match.scheduledAt)} · {formatVenue(match.venue)}</small></span></button>
        <span className="team-match-result"><strong>{result}</strong></span>
        <span className="team-match-total"><strong>{match.totalPoints}</strong><small>Punkte</small></span>
      </header>
      <div className="position-breakdown" aria-label="Punkte nach Mannschaftsteil">
        <div className="position-stack">{positionParts.map((part) => <PositionSegment key={part.label} part={part} players={match.players.filter((player) => player.position === part.position)} width={visualTotal ? (Math.abs(part.value) / visualTotal) * 100 : 0} onPlayer={onPlayer} />)}</div>
        <div className="position-breakdown-values">{positionParts.map((part) => <span key={part.label}><small>{part.label}</small><strong>{part.value}</strong></span>)}</div>
      </div>
      <div className="action-breakdown" aria-label="Punkte nach Wertungsaktion">
        {teamMatchActions.map((action) => {
          const value = match[action.key] as number;
          return <span key={action.key} className={value < 0 ? "negative" : ""}><small>{action.label}</small><strong>{value > 0 ? `+${value}` : value}</strong></span>;
        })}
        <span className={match.cardPoints < 0 ? "negative card-breakdown" : "card-breakdown"}><small>Platzverweise</small><strong>{match.cardPoints ? formatPenalty(match.cardPoints) : "0"}</strong><em>{formatCardCounts(match.redCards, match.yellowRedCards)}</em></span>
      </div>
    </section>
  );
}

function PositionSegment({ part, players, width, onPlayer }: { part: { label: string; position: Position; value: number; className: string }; players: TeamMatchContributor[]; width: number; onPlayer: (id: string) => void }) {
  if (!width) return null;
  return (
    <div className={`position-segment ${part.className} ${part.value < 0 ? "negative" : ""}`} style={{ width: `${width}%` }} tabIndex={0} aria-label={`${positionName[part.position]}: ${part.value} Punkte`}>
      <div className="position-contributors" role="tooltip">
        <header><strong>{positionName[part.position]}</strong><span>{part.value} Pkt.</span></header>
        <ol>
          {players.map((player, index) => (
            <li key={player.id}>
              <button onClick={() => onPlayer(player.id)}>
                <span>{index + 1}</span>
                <PlayerPortrait name={player.name} url={player.photoUrl} teamCode="" teamLogoUrl={null} />
                <strong>{player.name}</strong>
                <b>{player.points > 0 ? `+${player.points}` : player.points}</b>
              </button>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

function TeamsView({ filters, onTeam }: { filters: Filters; onTeam: (id: string) => void }) {
  const [teams, setTeams] = useState<TeamScore[]>([]);
  const [sortMetric, setSortMetric] = useState<TeamMetric>("overall");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const sortedTeams = useMemo(() => [...teams].sort((left, right) => {
    const difference = left[sortMetric] - right[sortMetric];
    if (difference !== 0) return sortDirection === "asc" ? difference : -difference;
    return left.name.localeCompare(right.name, "de");
  }), [teams, sortMetric, sortDirection]);

  function sortTeams(metric: TeamMetric) {
    if (metric === sortMetric) setSortDirection((direction) => direction === "desc" ? "asc" : "desc");
    else { setSortMetric(metric); setSortDirection("desc"); }
  }
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    api.teams(scopeQuery(filters, false), controller.signal)
      .then(setTeams)
      .catch((reason: Error) => { if (!isAbort(reason)) setError(reason.message); })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [filters.league, filters.season]);
  if (error) return <ErrorState message={error} />;
  return (
    <section className="detail-section">
      <div className="detail-head"><div><p className="kicker">Saisonweiter Vereinsvergleich</p><h2>Gesamtpunkte nach Mannschaft und Position</h2><p>Summe aller Spielerpunkte der importierten Saison.</p></div><span>{teams.length} Vereine</span></div>
      <div className={`team-table table-shell ${loading ? "is-loading" : ""}`}>
        <div className="team-table-head"><span>Verein</span>{teamMetrics.map((metric) => <span key={metric.key}><button className={sortMetric === metric.key ? "active" : ""} onClick={() => sortTeams(metric.key)}>{metric.label}<small aria-hidden="true">{sortMetric === metric.key ? sortDirection === "desc" ? "↓" : "↑" : "↕"}</small></button></span>)}</div>
        {sortedTeams.map((team, index) => (
          <div className="team-table-row" key={team.id}>
            <button className="team-name" onClick={() => onTeam(team.id)}><span className="rank">{index + 1}</span><TeamLogo code={team.code} url={team.logoUrl} large /><span><strong>{team.name}</strong><small>{team.sampleSize} Spieler mit Wertung</small></span></button>
            {teamMetrics.map((metric) => <TeamMetricCell key={metric.key} value={team[metric.key]} label={metric.label} players={team.topPlayers[metric.leaders]} />)}
          </div>
        ))}
        {!loading && !teams.length && <Empty message="Für diese Saison liegen keine Mannschaftswertungen vor." />}
      </div>
    </section>
  );
}

function TeamMetricCell({ value, label, players }: { value: number; label: string; players: TeamPlayerScore[] }) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const tooltipId = useId();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const open = hovered || focused;
  return (
    <div ref={anchorRef} className="team-metric-cell" tabIndex={0} aria-describedby={open ? tooltipId : undefined} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}>
      <div className="team-score"><strong>{value || "—"}</strong><span>Pkt.</span></div>
      <FloatingScorePopover anchorRef={anchorRef} open={open} id={tooltipId} className="metric-popover" preferredWidth={315}>
        <header><strong>{label}</strong><span>Saisonpunkte</span></header>
        <ol>{players.map((player, index) => <li key={player.id}><span>{index + 1}</span><strong>{player.name}</strong><small>{positionName[player.position]}</small><b>{player.points}</b></li>)}</ol>
      </FloatingScorePopover>
    </div>
  );
}

function FloatingScorePopover({ anchorRef, open, id, className, preferredWidth, children }: { anchorRef: RefObject<HTMLElement | null>; open: boolean; id: string; className: string; preferredWidth: number; children: ReactNode }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number; width: number } | null>(null);

  function updatePosition() {
    const anchor = anchorRef.current;
    const panel = panelRef.current;
    if (!anchor || !panel) return;
    const margin = 12;
    const gap = 8;
    const viewportWidth = document.documentElement.clientWidth;
    const viewportHeight = window.innerHeight;
    const width = Math.min(preferredWidth, viewportWidth - margin * 2);
    const anchorBox = anchor.getBoundingClientRect();
    const panelHeight = Math.min(panel.offsetHeight, viewportHeight - margin * 2);
    const roomAbove = anchorBox.top - margin;
    const roomBelow = viewportHeight - anchorBox.bottom - margin;
    const placeBelow = roomBelow >= panelHeight + gap || roomBelow >= roomAbove;
    const desiredTop = placeBelow ? anchorBox.bottom + gap : anchorBox.top - panelHeight - gap;
    const top = Math.max(margin, Math.min(desiredTop, viewportHeight - panelHeight - margin));
    const centeredLeft = anchorBox.left + anchorBox.width / 2 - width / 2;
    const left = Math.max(margin, Math.min(centeredLeft, viewportWidth - width - margin));
    setPosition({ top, left, width });
  }

  useLayoutEffect(() => {
    if (open) updatePosition();
  }, [open, preferredWidth]);

  useEffect(() => {
    if (!open) return;
    const update = () => updatePosition();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open, preferredWidth]);

  if (!open) return null;
  return createPortal(
    <div ref={panelRef} id={id} role="tooltip" className={`floating-score-popover ${className}`} style={{ top: position?.top ?? 0, left: position?.left ?? 0, width: position?.width ?? preferredWidth, visibility: position ? "visible" : "hidden" }}>
      {children}
    </div>,
    document.body,
  );
}

function TopPlayersView({ filters, leagues, onFilter, onPlayer }: { filters: Filters; leagues: Catalog["leagues"]; onFilter: (key: keyof Filters, value: string) => void; onPlayer: (id: string) => void }) {
  const [data, setData] = useState<TopPlayers | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<TopPlayerSort>("previous");

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    api.topPlayers(scopeQuery(filters, false), controller.signal)
      .then(setData)
      .catch((reason: Error) => { if (!isAbort(reason)) { setData(null); setError(reason.message); } })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [filters.league, filters.season]);

  const controls = (
    <div className="selectors top-player-selectors">
      <label><span>Liga</span><select value={filters.league} onChange={(event) => onFilter("league", event.target.value)}>{leagues.map((league) => <option value={league.code} key={league.code}>{league.name}</option>)}</select></label>
      <label><span>Sortierung</span><select value={sort} onChange={(event) => setSort(event.target.value as TopPlayerSort)}>
        <option value="previous">Punkte Vorsaison</option>
        <option value="average">Saisonschnitt</option>
        <option value="value">Preis-Leistung</option>
        <option value="trend">Jüngster Trend</option>
        <option value="price">Marktwert</option>
      </select></label>
    </div>
  );

  return (
    <div className="top-players-view">
      <section className="detail-section top-players-intro">
        <div>
          <p className="kicker">Fantasy-Auswahl · aktueller Spielerpool</p>
          <h2>{data ? `Spieler für ${data.context.season}` : "Spieler für die neue Saison"}</h2>
          <p>Alle aktuell kaufbaren Spieler, eingeordnet anhand ihrer abgeschlossenen Saisons vor dem Saisonstart. Punkte der neuen Saison und Hochrechnungen fließen hier bewusst nicht ein.</p>
        </div>
        {controls}
        {data && <div className="top-players-context"><strong>{data.context.playerCount} kaufbare Spieler</strong><span>{data.context.cutoffSeason ? `Leistungsdaten bis einschließlich ${data.context.cutoffSeason}` : "noch keine abgeschlossene Vorsaison importiert"}</span></div>}
      </section>
      {error ? <ErrorState message={error} /> : loading || !data ? <LoadingState /> : (
        <div className="top-player-pairs">
          <TopPlayerGroup title="Torwart & Abwehr" positions={["GK", "DEF"]} players={data.positions} sort={sort} onPlayer={onPlayer} />
          <TopPlayerGroup title="Mittelfeld & Sturm" positions={["MID", "FWD"]} players={data.positions} sort={sort} onPlayer={onPlayer} />
        </div>
      )}
      <p className="top-players-note">Keine Punkte der neuen Saison und keine Prognose: Auch Spieler ohne importierte Historie bleiben sichtbar. Die Einordnung verwendet ausschließlich abgeschlossene kicker-Wertungen aus Bundesliga, 2. Bundesliga und 3. Liga.</p>
    </div>
  );
}

function TopPlayerGroup({ title, positions, players, sort, onPlayer }: { title: string; positions: Position[]; players: TopPlayers["positions"]; sort: TopPlayerSort; onPlayer: (id: string) => void }) {
  const sortLabel: Record<TopPlayerSort, string> = {
    previous: "Punkte der letzten abgeschlossenen Saison",
    average: "Punkte im Schnitt je abgeschlossener Saison",
    value: "Schnittpunkte je Mio. € Marktwert",
    trend: "Veränderung zwischen den letzten zwei Saisons",
    price: "Aktueller Marktwert",
  };
  return (
    <section className="detail-section top-player-group">
      <div className="top-player-group-head"><div><p className="kicker">Kaufbare Spieler</p><h2>{title}</h2></div><span>{sortLabel[sort]}</span></div>
      <div className="top-player-columns">
        {positions.map((position) => (
          <section key={position}>
            <h3>{positionName[position]} <span>{players[position].length}</span></h3>
            {players[position].length ? <ol>{sortTopPlayers(players[position], sort).map((player, index) => <li key={player.id}><TopPlayerRow player={player} rank={index + 1} onClick={() => onPlayer(player.id)} /></li>)}</ol> : <Empty message="Für diese Position sind keine kaufbaren Spieler importiert." />}
          </section>
        ))}
      </div>
    </section>
  );
}

function TopPlayerRow({ player, rank, onClick }: { player: TopPlayerAnalysis; rank: number; onClick: () => void }) {
  const historyLabel = player.history.map((season) => `${season.season} · ${season.league}: ${season.points} Punkte`).join("\n");
  const maxPoints = Math.max(1, ...player.history.map((season) => Math.max(0, season.points)));
  return (
    <button onClick={onClick} title={historyLabel}>
      <span className="rank">{rank}</span>
      <PlayerPortrait name={player.name} url={player.photoUrl} teamCode={player.teamCode} teamLogoUrl={player.logoUrl} />
      <span className="top-player-copy"><strong>{player.name}</strong><small>{player.team}</small><em>{player.signal}</em></span>
      <span className="top-player-history" aria-label={historyLabel || "Keine Vergleichssaison"}>
        {player.history.map((season) => <i key={`${season.season}-${season.league}`} style={{ height: `${Math.max(12, Math.round((Math.max(0, season.points) / maxPoints) * 100))}%` }} />)}
      </span>
      <span className="top-player-stat top-player-price"><strong>{formatMarketValue(player.priceM)}</strong><small>Marktwert</small></span>
      <span className={`top-player-stat top-player-previous ${player.trend}`}><strong>{player.previousPoints ?? "—"}</strong><small>{player.previousSeason ?? "Vorsaison"}</small></span>
      <span className="top-player-stat top-player-average"><strong>{player.averagePoints ?? "—"}</strong><small>Ø Pkt.</small></span>
      <span className="top-player-stat top-player-value"><strong>{formatPlayerValue(player.value)}</strong><small>Pkt./Mio.</small></span>
    </button>
  );
}

function sortTopPlayers(players: TopPlayerAnalysis[], sort: TopPlayerSort) {
  function metric(player: TopPlayerAnalysis) {
    if (sort === "previous") return player.previousPoints ?? -Infinity;
    if (sort === "average") return player.averagePoints ?? -Infinity;
    if (sort === "value") return player.value ?? -Infinity;
    if (sort === "trend") return player.trendDelta ?? -Infinity;
    return player.priceM;
  }
  return [...players].sort((left, right) => metric(right) - metric(left)
    || (right.previousPoints ?? -Infinity) - (left.previousPoints ?? -Infinity)
    || left.name.localeCompare(right.name, "de"));
}

function BestPlayerCard({ player, onClick }: { player: BestElevenPlayer; onClick: () => void }) {
  return <button className="best-player" onClick={onClick}><TeamLogo code={player.teamCode} url={player.logoUrl} /><strong>{lastName(player.name)}</strong><small>{player.team}</small><span>{player.points} Pkt.</span></button>;
}

function groupBestEleven(players: BestElevenPlayer[]) {
  return players.reduce<Record<Position, BestElevenPlayer[]>>((groups, player) => {
    groups[player.position].push(player);
    return groups;
  }, { GK: [], DEF: [], MID: [], FWD: [] });
}

function TeamLogo({ code, url, large = false }: { code: string; url: string | null; large?: boolean }) {
  const [imageState, setImageState] = useState<"loading" | "loaded" | "error">(url ? "loading" : "error");
  useEffect(() => { setImageState(url ? "loading" : "error"); }, [url]);
  return (
    <span className={`team-logo ${large ? "large" : ""} ${imageState === "loaded" ? "image-loaded" : ""}`} aria-label={code}>
      {imageState !== "loaded" && <span className="team-logo-fallback">{code}</span>}
      {url && imageState !== "error" && <img src={url} alt="" loading="lazy" onLoad={() => setImageState("loaded")} onError={() => setImageState("error")} />}
    </span>
  );
}

function PlayerPortrait({ name, url, teamCode, teamLogoUrl, large = false }: { name: string; url: string | null; teamCode: string; teamLogoUrl: string | null; large?: boolean }) {
  return (
    <span className={`player-photo ${large ? "large" : ""}`} aria-label={`Foto von ${name}`}>
      <TeamLogo code={teamCode} url={teamLogoUrl} large={large} />
      {url && <img src={url} alt="" loading="lazy" onError={(event) => { event.currentTarget.style.display = "none"; }} />}
    </span>
  );
}

function PositionTag({ position }: { position: Position }) {
  return <span className={`position-tag pos-${position.toLowerCase()}`}>{positionName[position]}</span>;
}

function formatPlayerValue(value: number | null) { return value == null ? "—" : value.toFixed(1); }
function formatMarketValue(valueInMillions: number) { return valueInMillions >= 999 ? "–" : `€${valueInMillions.toFixed(1)}m`; }
function formatPenalty(value: number) { return value < 0 ? `−${Math.abs(value)}` : String(value); }
function formatCardCounts(redCards: number, yellowRedCards: number) {
  const parts = [redCards > 0 ? `${redCards}× Rot` : "", yellowRedCards > 0 ? `${yellowRedCards}× Gelb-Rot` : ""].filter(Boolean);
  return parts.length ? parts.join(" · ") : "keine Platzverweise";
}
function formatDate(value: string | null) { return value ? new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "short" }).format(new Date(value)) : "—"; }
function formatVenue(value: PlayerGame["venue"]) { return value === "Home" ? "Heim" : "Auswärts"; }
function lastName(name: string) { return name.split(" ").at(-1) ?? name; }
function Empty({ message }: { message: string }) { return <div className="empty"><span>○</span><p>{message}</p></div>; }
function ErrorState({ message }: { message: string }) { return <div className="state-card error-state"><span>Ansicht konnte nicht geladen werden</span><strong>{message}</strong><p>Bitte prüfen, ob die statischen Datendateien vorhanden sind, und anschließend neu laden.</p></div>; }
function LoadingState() { return <div className="loading-grid" aria-label="Dashboard wird geladen"><span /><span /><span /></div>; }
