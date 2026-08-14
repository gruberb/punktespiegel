import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, ReactNode, RefObject } from "react";
import { createPortal } from "react-dom";
import { api } from "./api";
import { DataTable } from "./DataTable";
import type { DataTableColumn } from "./DataTable";
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

type InfoView = "about" | "methodology" | "sources" | "faq";
type View = "overview" | "players" | "player" | "teams" | "team" | "history" | "top" | "manager" | InfoView;
type NavView = Exclude<View, "player" | "team">;
type Filters = { league: string; season: string; round: string };
type ViewLocation = { view: View; filters: Filters; playerId: string | null; teamId: string | null; scrollY: number };
type TeamMetric = "overall" | "goalkeeper" | "defence" | "midfield" | "forward";
type PlayerSort = "name" | "position" | "price" | "round" | "points" | "grade" | "goals" | "assists" | "value";
type TopPlayerSort = "previous" | "average" | "value" | "trend" | "price";
type Theme = "light" | "dark";

const themeStorageKey = "punktespiegel-theme";
const siteBaseUrl = "https://gruberb.github.io/punktespiegel/";

const positionName: Record<Position, string> = {
  GK: "Torwart",
  DEF: "Abwehr",
  MID: "Mittelfeld",
  FWD: "Sturm",
};
const availabilityStatusName: Record<NonNullable<PlayerDetail["availability"]>["status"], string> = {
  injured: "Verletzt",
  rehab: "Aufbautraining",
  suspended: "Gesperrt",
  not_considered: "Nicht berücksichtigt",
  unavailable: "Nicht verfügbar",
};
const nav: { id: NavView; label: string }[] = [
  { id: "overview", label: "Überblick" },
  { id: "players", label: "Spieler" },
  { id: "teams", label: "Mannschaften" },
  { id: "history", label: "Historie" },
  { id: "top", label: "Topspieler" },
  { id: "manager", label: "Fantasy Team" },
];
const infoViews: InfoView[] = ["about", "methodology", "sources", "faq"];
const faqItems = [
  {
    question: "Welche Daten zeigt Punktespiegel?",
    answer: "Punktespiegel zeigt kicker-Noten, Managerpunkte, Tore, Vorlagen und weitere Wertungen nach Spieler, Verein, Position, Saison und Spieltag.",
  },
  {
    question: "Welche Ligen sind enthalten?",
    answer: "Punktespiegel deckt die Bundesliga, die 2. Bundesliga und die 3. Liga ab.",
  },
  {
    question: "Wie aktuell sind die Daten?",
    answer: "Die laufende Saison wird täglich neu importiert und veröffentlicht. Abgeschlossene Saisons bleiben unverändert, sofern kein vollständiger manueller Neuaufbau angestoßen wird.",
  },
  {
    question: "Gibt es Daten für Interactive und Classic?",
    answer: "Ja. Die Fantasy-Team-Ansicht bietet datenbasierte Beispielkader und Aufstellungen für beide Varianten. Es handelt sich um unabhängige Beispiele, nicht um eine Erfolgsgarantie.",
  },
  {
    question: "Brauche ich ein Konto?",
    answer: "Nein. Punktespiegel läuft als statische Website ohne Anmeldung, Benutzerkonto oder Laufzeitdatenbank.",
  },
  {
    question: "Ist Punktespiegel ein offizielles kicker-Angebot?",
    answer: "Nein. Punktespiegel ist ein unabhängiges Analyseprojekt und nicht mit kicker verbunden. Die Datenbasis und externe Quellen werden transparent ausgewiesen.",
  },
];
const teamMetrics: { key: TeamMetric; label: string; short: string; leaders: keyof TeamLeaders }[] = [
  { key: "overall", label: "Gesamt", short: "GES", leaders: "overall" },
  { key: "goalkeeper", label: "Torwart", short: "TW", leaders: "goalkeeper" },
  { key: "defence", label: "Abwehr", short: "ABW", leaders: "defence" },
  { key: "midfield", label: "Mittelfeld", short: "MIT", leaders: "midfield" },
  { key: "forward", label: "Sturm", short: "ST", leaders: "forward" },
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

function initialTheme(): Theme {
  const documentTheme = document.documentElement.dataset.theme;
  if (documentTheme === "light" || documentTheme === "dark") return documentTheme;
  try {
    const storedTheme = window.localStorage.getItem(themeStorageKey);
    if (storedTheme === "light" || storedTheme === "dark") return storedTheme;
  } catch {
    // Storage can be unavailable in privacy-restricted browser contexts.
  }
  return "light";
}

function initialView(): View {
  const params = new URLSearchParams(window.location.search);
  const value = params.get("view");
  if (value === "player" && !params.get("player")) return "players";
  if (value === "team" && !params.get("team")) return "teams";
  return (["overview", "players", "player", "teams", "team", "history", "top", "manager", ...infoViews] as View[]).includes(value as View)
    ? (value as View)
    : "overview";
}

function isInfoView(view: View): view is InfoView {
  return infoViews.includes(view as InfoView);
}

function scopeQuery(filters: Filters, includeRound = true) {
  const params = new URLSearchParams({ league: filters.league, season: filters.season });
  if (includeRound) params.set("round", filters.round);
  return params;
}

function viewHref(view: NavView, filters: Filters) {
  const params = isInfoView(view) ? new URLSearchParams({ view }) : scopeQuery(filters, view === "players");
  if (!isInfoView(view)) params.set("view", view);
  return `?${params}`;
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
    top: "zu den Topspielern",
    manager: "zum Fantasy Team",
    about: "zu Über Punktespiegel",
    methodology: "zu Daten & Methodik",
    sources: "zu den Quellen",
    faq: "zu den häufigen Fragen",
  } satisfies Record<View, string>)[view];
}

export default function App() {
  const [theme, setTheme] = useState<Theme>(initialTheme);
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

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute("content", theme === "light" ? "#f7f6fb" : "#131215");
    try {
      window.localStorage.setItem(themeStorageKey, theme);
    } catch {
      // The selected theme still applies for this page view without persistence.
    }
  }, [theme]);

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
    const leagueName = catalog?.leagues.find((league) => league.code === filters.league)?.name ?? "Bundesliga";
    const seasonName = selectedSeason?.displayName ?? filters.season;
    const seo = ({
      overview: {
        title: `kicker Manager Punkte ${leagueName} ${seasonName}`,
        description: `Aktuelle kicker-Noten und Managerpunkte der ${leagueName} ${seasonName}: Ranglisten nach Spielern, Positionen und Mannschaften.`,
      },
      players: {
        title: `kicker Noten & Managerpunkte ${leagueName}`,
        description: `Spieler, kicker-Noten, Managerpunkte, Tore, Vorlagen und Marktwerte der ${leagueName} ${seasonName} nach Spieltag durchsuchen.`,
      },
      player: {
        title: `Spielerprofil: kicker Noten & Punkte ${leagueName}`,
        description: `Kicker-Noten, Managerpunkte, Saisonverlauf, Einsätze und verlinkte Fußball-News für Spieler der ${leagueName}.`,
      },
      teams: {
        title: `Mannschaftswertung ${leagueName}: kicker Punkte`,
        description: `Kicker Managerpunkte aller Mannschaften der ${leagueName} ${seasonName} vergleichen und Kader, Positionen sowie Spiele öffnen.`,
      },
      team: {
        title: `Mannschaftsprofil: kicker Punkte ${leagueName}`,
        description: `Kader, Spielerpunkte und jedes Spiel im Detail für Mannschaften der ${leagueName} – mit historischen kicker Managerdaten.`,
      },
      history: {
        title: `kicker Noten & Punkte Historie ${leagueName}`,
        description: `Historische kicker-Noten, Managerpunkte, Saisonbestleistungen, Spieltage und Mannschaftswertungen der ${leagueName}.`,
      },
      top: {
        title: `Topspieler für kicker Manager Interactive & Classic`,
        description: `Topspieler für kicker Manager Interactive und Classic nach Vorsaisonpunkten, Durchschnitt, Marktwert und Position vergleichen.`,
      },
      manager: {
        title: `Beispielteams für kicker Manager Interactive & Classic`,
        description: `Datenbasierte Beispielkader und Aufstellungen für kicker Manager Interactive und Classic in Bundesliga, 2. Bundesliga und 3. Liga.`,
      },
      about: {
        title: "Über Punktespiegel",
        description: "Was Punktespiegel bietet: aktuelle und historische kicker-Noten, Managerpunkte und Beispielteams für drei deutsche Profiligen.",
      },
      methodology: {
        title: "Daten & Methodik",
        description: "So importiert, prüft und veröffentlicht Punktespiegel kicker-Wertungen, historische Saisondaten und Fantasy-Beispielkader.",
      },
      sources: {
        title: "Quellen für Punkte, Rollen & Fußball-News",
        description: "Transparente Übersicht der Daten-, Profil-, Rollen-, Verfügbarkeits- und Nachrichtenquellen hinter Punktespiegel.",
      },
      faq: {
        title: "Häufige Fragen zu Punktespiegel",
        description: "Antworten zu Datenumfang, Ligen, Aktualisierung, kicker Manager Interactive und Classic sowie zur Unabhängigkeit von Punktespiegel.",
      },
    } satisfies Record<View, { title: string; description: string }>)[view];

    const canonical = new URL(siteBaseUrl);
    canonical.searchParams.set("view", view);
    if (!isInfoView(view)) {
      canonical.searchParams.set("league", filters.league);
      canonical.searchParams.set("season", filters.season);
      if (view === "players") canonical.searchParams.set("round", filters.round);
      if (view === "player" && playerId) canonical.searchParams.set("player", playerId);
      if (view === "team" && teamId) canonical.searchParams.set("team", teamId);
    }

    document.title = `${seo.title} | Punktespiegel`;
    document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.setAttribute("href", canonical.href);
    const metadata: ["name" | "property", string, string][] = [
      ["name", "description", seo.description],
      ["property", "og:title", `${seo.title} | Punktespiegel`],
      ["property", "og:description", seo.description],
      ["property", "og:url", canonical.href],
      ["name", "twitter:title", `${seo.title} | Punktespiegel`],
      ["name", "twitter:description", seo.description],
    ];
    metadata.forEach(([attribute, key, content]) => {
      document.head.querySelector<HTMLMetaElement>(`meta[${attribute}="${key}"]`)?.setAttribute("content", content);
    });

    document.getElementById("punktespiegel-faq-structured-data")?.remove();
    if (view === "faq") {
      const structuredData = document.createElement("script");
      structuredData.id = "punktespiegel-faq-structured-data";
      structuredData.type = "application/ld+json";
      structuredData.textContent = JSON.stringify({
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: faqItems.map((item) => ({
          "@type": "Question",
          name: item.question,
          acceptedAnswer: { "@type": "Answer", text: item.answer },
        })),
      });
      document.head.append(structuredData);
    }
  }, [catalog, filters.league, filters.round, filters.season, playerId, selectedSeason?.displayName, teamId, view]);

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
    const params = isInfoView(nextView) ? new URLSearchParams({ view: nextView }) : scopeQuery(nextFilters);
    if (!isInfoView(nextView)) params.set("view", nextView);
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

  const infoTitle: Record<InfoView, string> = {
    about: "Über Punktespiegel",
    methodology: "Daten & Methodik",
    sources: "Quellen",
    faq: "Häufige Fragen",
  };
  const title = isInfoView(view) ? infoTitle[view] : view === "overview" ? "Überblick" : view === "player" ? "Spielerprofil" : view === "team" ? "Mannschaftsprofil" : nav.find((item) => item.id === view)?.label;
  const description = view === "overview"
    ? latestRound > 0 ? `${selectedSeason?.displayName ?? "Gewählte Saison"} · kumuliert bis Spieltag ${latestRound}` : `${selectedSeason?.displayName ?? "Gewählte Saison"} · noch ohne abgeschlossenen Spieltag`
    : view === "teams"
      ? `${selectedSeason?.displayName ?? "Gewählte Saison"} · gesamte Saison`
      : view === "team"
        ? "Kader und Saisonverlauf"
      : view === "history"
        ? "Gesamtsaison und einzelne Spieltage"
        : view === "manager"
          ? `${newestSeason?.displayName ?? "Aktuelle Saison"} · Classic und Interactive`
        : view === "top"
          ? `${newestSeason?.displayName ?? "Aktuelle Saison"} · kaufbarer Spielerpool`
          : `${selectedSeason?.displayName ?? "Gewählte Saison"} · Spieltag ${filters.round}`;
  const navActive: NavView | null = isInfoView(view) ? null : view === "player" ? "players" : view === "team" ? "teams" : view;
  const previousView = backStack.at(-1)?.view;
  const backLabel = previousView ? `Zurück ${viewBackLabel(previousView)}` : view === "team" ? "Zurück zu den Mannschaften" : "Zurück zu den Spielern";
  const homeParams = scopeQuery(filters, false);
  homeParams.set("view", "overview");

  return (
    <div className={`app-shell view-${view}`}>
      <header className="site-header">
        <a className="brand" href={`?${homeParams}`} onClick={(event) => { event.preventDefault(); setView("overview"); }} aria-label="Punktespiegel Startseite">
          <img src={`${import.meta.env.BASE_URL}brand/punktespiegel-mark.svg`} alt="" aria-hidden="true" />
          <span>Punktespiegel</span>
        </a>
        <nav className="main-nav" aria-label="Bereiche">
          {nav.map((item) => (
            <button key={item.id} className={navActive === item.id ? "active" : ""} aria-current={navActive === item.id ? "page" : undefined} onClick={() => setView(item.id)}>
              {item.label}
            </button>
          ))}
        </nav>
        <button
          className="theme-toggle"
          aria-label={theme === "dark" ? "Zum hellen Design wechseln" : "Zum dunklen Design wechseln"}
          title={theme === "dark" ? "Helles Design" : "Dunkles Design"}
          onClick={() => setTheme((current) => current === "dark" ? "light" : "dark")}
        >
          <span className="theme-toggle-icon" aria-hidden="true">{theme === "dark" ? "☀" : "☾"}</span>
          <span>{theme === "dark" ? "Hell" : "Dunkel"}</span>
        </button>
      </header>

      <main>
        {!isInfoView(view) && view !== "history" && view !== "top" && <PageHeader title={title ?? ""} description={description} controls={<div className="selectors">
            {view !== "team" && view !== "player" && <StepperSelect label="Liga" value={filters.league} options={(catalog?.leagues ?? []).map((league) => ({ value: league.code, label: league.name }))} onChange={(value) => updateFilter("league", value)} />}
            {view === "team"
              ? <StepperSelect label="Saison" value={String(selectedTeamSeason?.startYear ?? filters.season)} options={[...teamSeasons].reverse().map((season) => ({ value: String(season.startYear), label: season.displayName }))} onChange={updateTeamSeason} />
              : view === "player"
                ? <StepperSelect label="Saison" value={String(selectedPlayerSeason?.startYear ?? filters.season)} options={[...playerSeasons].reverse().map((season) => ({ value: String(season.startYear), label: season.displayName }))} onChange={updatePlayerSeason} />
              : view === "manager" && newestSeason
                ? <StepperSelect label="Saison" value={String(newestSeason.startYear)} options={[{ value: String(newestSeason.startYear), label: newestSeason.displayName }]} onChange={() => undefined} />
                : view !== "overview" && <StepperSelect label="Saison" value={filters.season} options={[...seasons].reverse().map((season) => ({ value: String(season.startYear), label: season.displayName }))} onChange={(value) => updateFilter("season", value)} />}
            {showMatchday && (
              <StepperSelect label="Spieltag" value={filters.round} options={Array.from({ length: roundCount }, (_, index) => ({ value: String(index + 1), label: `Spieltag ${index + 1}` }))} onChange={(value) => updateFilter("round", value)} />
            )}
          </div>} />}

        {isInfoView(view) ? <InfoPage view={view} filters={filters} onView={setView} /> : catalogError ? <ErrorState message={catalogError} /> : !catalog ? <LoadingState /> : (
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
          </>
        )}
        <SiteFooter currentView={view} filters={filters} onView={setView} />
      </main>
    </div>
  );
}

function PageHeader({ title, description, controls, className = "" }: { title: string; description: string; controls?: ReactNode; className?: string }) {
  return <section className={`control-deck page-header ${className}`} aria-label="Seitenkopf und Datenauswahl">
    <div className="intro"><p className="kicker">kicker-Daten · kicker Manager-Liga</p><h1>{title}</h1><p>{description}</p></div>
    {controls}
  </section>;
}

function StepperSelect({ label, value, options, onChange }: { label: string; value: string; options: { value: string; label: string }[]; onChange: (value: string) => void }) {
  const index = Math.max(0, options.findIndex((option) => option.value === value));
  return <div className="stepper-select">
    <button aria-label={`${label} zurück`} disabled={index <= 0} onClick={() => onChange(options[index - 1]?.value ?? value)}>‹</button>
    <label><span>{label}</span><select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>{options.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label>
    <button aria-label={`${label} weiter`} disabled={index >= options.length - 1} onClick={() => onChange(options[index + 1]?.value ?? value)}>›</button>
  </div>;
}

function Overview({ data, onView, onPlayer, onTeam }: { data: Dashboard; onView: (view: NavView) => void; onPlayer: (id: string) => void; onTeam: (id: string) => void }) {
  const [position, setPosition] = useState<Position>("FWD");
  const [metric, setMetric] = useState<Exclude<RankingMetric, "points">>("grade");
  const metrics: { id: Exclude<RankingMetric, "points">; label: string; players: Player[] }[] = [
    { id: "grade", label: "Noten", players: data.leaderboards.grades },
    { id: "goals", label: "Tore", players: data.leaderboards.goals },
    { id: "assists", label: "Vorlagen", players: data.leaderboards.assists },
    { id: "cleanSheets", label: "Weiße Westen", players: data.leaderboards.cleanSheets },
    { id: "starterPoints", label: "Startelf", players: data.leaderboards.starterPoints },
    { id: "cardDeductions", label: "Platzverweise", players: data.leaderboards.cardDeductions },
    { id: "mvpAwards", label: "SdS", players: data.leaderboards.mvpAwards },
    { id: "jokerAwards", label: "Joker", players: data.leaderboards.jokerAwards },
  ];
  const activeMetric = metrics.find((item) => item.id === metric) ?? metrics[0];
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
        <SimpleCardHead title="Nach Position" action={<div className="metric-tabs overview-tabs" aria-label="Position">
          {(["GK", "DEF", "MID", "FWD"] as Position[]).map((item) => <button key={item} className={position === item ? "active" : ""} onClick={() => setPosition(item)}>{positionName[item]}</button>)}
        </div>} />
        <div className="overview-tab-panel">
          <OverviewPlayerTable players={data.leaderboards.positions[position] ?? []} metric="points" onPlayer={onPlayer} />
        </div>
      </article>
      <article className="dashboard-card overview-metrics-card">
        <SimpleCardHead title="Wertungen" action={<div className="metric-tabs overview-tabs metric-overflow" aria-label="Wertung">
          {metrics.map((item) => <button key={item.id} className={metric === item.id ? "active" : ""} onClick={() => setMetric(item.id)}>{item.label}</button>)}
        </div>} />
        <div className="overview-tab-panel">
          <OverviewPlayerTable players={activeMetric.players} metric={activeMetric.id} onPlayer={onPlayer} />
        </div>
      </article>
    </section>
  );
}

function InfoPage({ view, filters, onView }: { view: InfoView; filters: Filters; onView: (view: NavView) => void }) {
  const link = (target: NavView, label: string) => <a href={viewHref(target, filters)} onClick={(event) => { event.preventDefault(); onView(target); }}>{label}</a>;
  const copy: Record<InfoView, { eyebrow: string; title: string; intro: string }> = {
    about: {
      eyebrow: "Unabhängiges Datenprojekt",
      title: "Über Punktespiegel",
      intro: "Punktespiegel macht aktuelle und historische kicker-Noten und Managerpunkte für Bundesliga, 2. Bundesliga und 3. Liga vergleichbar – ohne Anmeldung und ohne Paywall.",
    },
    methodology: {
      eyebrow: "Nachvollziehbar statt Blackbox",
      title: "Daten & Methodik",
      intro: "Vom öffentlichen Quellwert bis zur Tabelle im Browser: Hier ist dokumentiert, wie Punktespiegel Daten importiert, prüft, verdichtet und für Beispielteams einordnet.",
    },
    sources: {
      eyebrow: "Transparente Datenbasis",
      title: "Quellen",
      intro: "Punktespiegel trennt Wertungsdaten, Rollen- und Verfügbarkeitssignale sowie Fußball-News. Externe Profile und Meldungen bleiben mit ihrer Originalquelle verlinkt.",
    },
    faq: {
      eyebrow: "Kurz erklärt",
      title: "Häufige Fragen",
      intro: "Antworten zum Datenumfang, zur Aktualisierung, zu Interactive und Classic sowie zur Unabhängigkeit von Punktespiegel.",
    },
  };
  const page = copy[view];

  return <article className="info-page">
    <a className="info-back" href={viewHref("overview", filters)} onClick={(event) => { event.preventDefault(); onView("overview"); }}>← Zurück zum Überblick</a>
    <header className="info-hero">
      <p className="kicker">{page.eyebrow}</p>
      <h1>{page.title}</h1>
      <p>{page.intro}</p>
    </header>

    {view === "about" && <>
      <div className="info-grid">
        <section className="info-card info-card-wide"><h2>Ein Überblick, der Details nicht versteckt</h2><p>Ranglisten führen direkt zu Spieler- und Mannschaftsprofilen. Saison- und Spieltagsfilter machen Entwicklungen sichtbar; die Historie bündelt Noten, Punkte, Leistungsdaten und die beste Elf. Die Fantasy-Ansicht ergänzt datenbasierte Beispielkader für kicker Manager Interactive und Classic.</p></section>
        <section className="info-card"><h2>Drei Ligen, mehrere Saisons</h2><p>Bundesliga, 2. Bundesliga und 3. Liga verwenden dieselben Tabellen und Metriken. So lassen sich Positionen, Vereine und Spieltage konsistent vergleichen.</p></section>
        <section className="info-card"><h2>Unabhängig und transparent</h2><p>Punktespiegel ist ein unabhängiges Analyseprojekt und nicht mit kicker verbunden. Quellen, Modellgrenzen und Aktualisierungswege werden offen beschrieben.</p></section>
      </div>
      <nav className="info-actions" aria-label="Punktespiegel entdecken">{link("players", "Spielerdaten durchsuchen →")}{link("history", "Historie öffnen →")}{link("manager", "Fantasy-Teams ansehen →")}</nav>
    </>}

    {view === "methodology" && <>
      <ol className="method-steps">
        <li><span>01</span><div><h2>Öffentliche Daten importieren</h2><p>Der Build-Generator lädt die laufende Saison aus öffentlichen kicker-Quelldaten. Abgeschlossene Saisons bleiben unverändert, bis ein vollständiger Neuaufbau ausdrücklich gestartet wird.</p></div></li>
        <li><span>02</span><div><h2>Datenvertrag prüfen</h2><p>Ligen, Saisons, Spieltage, Spieler, Vereine und Wertungen werden normalisiert und vor jeder Veröffentlichung auf Vollständigkeit und Konsistenz geprüft.</p></div></li>
        <li><span>03</span><div><h2>Statische Saisonartefakte bauen</h2><p>Je Liga und Saison entsteht ein kompaktes JSON-Artefakt. Der Browser lädt nur die ausgewählte Saison; es gibt keinen Laufzeitserver, keine Datenbank und kein Benutzerkonto.</p></div></li>
        <li><span>04</span><div><h2>Beispielteams offline berechnen</h2><p>Interactive- und Classic-Kader werden vorab berechnet. Marktwerte, Positionen, Vereinslimits, Rollen und Verfügbarkeit fließen in die Auswahl ein; die Ergebnisse sind Beispiele und keine Garantie.</p></div></li>
      </ol>
      <div className="info-grid">
        <section className="info-card"><h2>Aktualisierung</h2><p>Die laufende Saison wird täglich um 12:15 Uhr deutscher Zeit neu gebaut. Ein manueller Lauf kann zusätzlich alle abgeschlossenen Saisons aktualisieren.</p></section>
        <section className="info-card"><h2>Modellgrenzen</h2><p>Prognosen bleiben Erwartungswerte. Die historische Classic-Prüfung ist ohne vollständig archivierte damalige Marktsnapshots ausdrücklich experimentell.</p></section>
      </div>
    </>}

    {view === "sources" && <>
      <div className="info-grid">
        <section className="info-card"><h2>Noten, Punkte und Medien</h2><p>Spiel- und Wertungsdaten sowie Spielerfotos und Vereinslogos stammen aus öffentlichen kicker-Quellen. Spielerprofile verlinken zusätzlich auf die jeweiligen kicker-Seiten.</p></section>
        <section className="info-card"><h2>Rollen und Verfügbarkeit</h2><p>LigaInsider liefert Bundesliga-Rollen- und Topelf-Signale. Medizinische Verfügbarkeit wird für die Bundesliga über LigaInsider und für 2. Bundesliga sowie 3. Liga über Transfermarkt eingeordnet.</p></section>
        <section className="info-card info-card-wide"><h2>Fußball-News</h2><p>Spielerbezogene Überschriften werden über NewsAPI oder öffentliche RSS-Feeds gesammelt. Jede Meldung öffnet die Originalquelle; Punktespiegel übernimmt keine redaktionelle Verantwortung für externe Inhalte.</p></section>
      </div>
      <nav className="source-directory" aria-label="Externe Quellen">
        <a href="https://www.kicker.de/games/startseite" target="_blank" rel="noreferrer external"><strong>kicker Games</strong><span>Interactive, Classic und Regeln ↗</span></a>
        <a href="https://www.ligainsider.de/" target="_blank" rel="noreferrer external"><strong>LigaInsider</strong><span>Rollen, Topelf und Verfügbarkeit ↗</span></a>
        <a href="https://www.transfermarkt.de/" target="_blank" rel="noreferrer external"><strong>Transfermarkt</strong><span>Vereinsprofile und Ausfalllisten ↗</span></a>
        <a href="https://www.sportschau.de/fussball/" target="_blank" rel="noreferrer external"><strong>Sportschau</strong><span>Fußball-News und RSS ↗</span></a>
        <a href="https://www.bundesliga.com/de/bundesliga" target="_blank" rel="noreferrer external"><strong>Bundesliga.com</strong><span>Offizielle Liga-News ↗</span></a>
        <a href="https://www.skysports.com/football" target="_blank" rel="noreferrer external"><strong>Sky Sports</strong><span>Internationaler Fußball-Newsfeed ↗</span></a>
        <a href="https://www.espn.com/soccer/" target="_blank" rel="noreferrer external"><strong>ESPN Soccer</strong><span>Internationaler Fußball-Newsfeed ↗</span></a>
        <a href="https://www.bbc.com/sport/football" target="_blank" rel="noreferrer external"><strong>BBC Football</strong><span>Internationaler Fußball-Newsfeed ↗</span></a>
      </nav>
    </>}

    {view === "faq" && <section className="info-faq" aria-label="Häufige Fragen zu Punktespiegel">
      {faqItems.map((item) => <details key={item.question}><summary>{item.question}</summary><p>{item.answer}</p></details>)}
    </section>}
  </article>;
}

function SiteFooter({ currentView, filters, onView }: { currentView: View; filters: Filters; onView: (view: NavView) => void }) {
  const links: { view: NavView; label: string }[] = [
    { view: "about", label: "Über Punktespiegel" },
    { view: "methodology", label: "Daten & Methodik" },
    { view: "sources", label: "Quellen" },
    { view: "faq", label: "FAQ" },
    { view: "players", label: "Spieler" },
    { view: "history", label: "Historie" },
    { view: "manager", label: "Fantasy Team" },
  ];
  const openView = (event: ReactMouseEvent<HTMLAnchorElement>, target: NavView) => {
    event.preventDefault();
    onView(target);
  };
  return <footer className="site-footer">
    <div className="site-footer-main">
      <a className="site-footer-brand" href={viewHref("overview", filters)} onClick={(event) => openView(event, "overview")}>
        <img src={`${import.meta.env.BASE_URL}brand/punktespiegel-mark.svg`} alt="" aria-hidden="true" />
        <span><strong>Punktespiegel</strong><small>Noten, Punkte und Historie</small></span>
      </a>
      <nav className="site-footer-links" aria-label="Weitere Seiten">
        {links.map((item) => <a key={item.view} href={viewHref(item.view, filters)} aria-current={currentView === item.view ? "page" : undefined} onClick={(event) => openView(event, item.view)}>{item.label}</a>)}
      </nav>
    </div>
    <div className="site-footer-meta">
      <p><strong>Datenbasis</strong> Öffentliche kicker-Daten und Wertungen der kicker Manager-Liga. Punktespiegel ist ein unabhängiges Projekt.</p>
      <nav aria-label="Technische Links"><a href="https://github.com/gruberb/punktespiegel" target="_blank" rel="noreferrer external">GitHub ↗</a><a href={`${import.meta.env.BASE_URL}sitemap.xml`}>Sitemap</a></nav>
    </div>
  </footer>;
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

function PlayerRanking({ players, metric, onPlayer, scrollable = false, scope = "season" }: { players: Player[]; metric: RankingMetric; onPlayer: (id: string) => void; scrollable?: boolean; scope?: "season" | "matchday" }) {
  if (!players.length) return <Empty message="Für diese Auswahl liegen keine Wertungen vor." />;
  const suffix = playerRankingSuffix(metric);
  return (
    <ol className={`player-ranking ${scrollable ? "scrollable" : ""}`}>
      {players.map((player, index) => (
        <li key={player.id}>
          <button onClick={() => onPlayer(player.id)}>
            <span className="rank">{index + 1}</span>
            <PlayerPortrait name={player.name} url={player.photoUrl} teamCode={player.teamCode} teamLogoUrl={player.logoUrl} />
            <span className="player-identity"><strong>{player.name}</strong><small>{metric === "cardDeductions" ? `${player.team} · ${formatCardCounts(scope === "matchday" ? player.roundRedCards : player.redCards, scope === "matchday" ? player.roundYellowRedCards : player.yellowRedCards)}` : `${player.team} · ${positionName[player.position]}`}</small></span>
            <span className="ranking-value"><strong>{playerRankingValue(player, metric, scope)}</strong><small>{suffix}</small></span>
          </button>
        </li>
      ))}
    </ol>
  );
}

function OverviewPlayerTable({ players, metric, onPlayer }: { players: Player[]; metric: RankingMetric; onPlayer: (id: string) => void }) {
  const columns: DataTableColumn<Player>[] = [
    {
      id: "player",
      label: "Name",
      width: "40%",
      render: (player, index) => <div className="table-player">
        <span className="rank">{index + 1}</span>
        <PlayerPortrait name={player.name} url={player.photoUrl} teamCode={player.teamCode} teamLogoUrl={player.logoUrl} />
        <span><strong>{player.name}</strong></span>
      </div>,
    },
    { id: "team", label: "Team", width: "28%", render: (player) => <span className="overview-table-text" title={player.team}>{player.team}</span> },
    { id: "position", label: "Position", shortLabel: "Pos.", width: "17%", render: (player) => <span className="overview-table-text" title={positionName[player.position]}>{positionName[player.position]}</span> },
    {
      id: "value",
      label: playerRankingColumnLabel(metric),
      shortLabel: metric === "points" ? "Pkt." : undefined,
      numeric: true,
      className: "point-value",
      width: "15%",
      render: (player) => <>{playerRankingValue(player, metric)}<small>{playerRankingSuffix(metric)}</small></>,
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

function HistoryView({ filters, leagues, seasons, onFilter, onPlayer, onTeam }: { filters: Filters; leagues: Catalog["leagues"]; seasons: Catalog["seasons"]; onFilter: (key: keyof Filters, value: string) => void; onPlayer: (id: string, season: string, round: number) => void; onTeam: (id: string, season: string, round: number) => void }) {
  const selectedSeason = seasons.find((season) => String(season.startYear) === filters.season);
  const [scope, setScope] = useState<"season" | "matchday">("season");
  const [history, setHistory] = useState<History | null>(null);
  const [seasonDashboard, setSeasonDashboard] = useState<Dashboard | null>(null);
  const [seasonEleven, setSeasonEleven] = useState<BestEleven | null>(null);
  const [archive, setArchive] = useState<Dashboard | null>(null);
  const [archiveEleven, setArchiveEleven] = useState<BestEleven | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [seasonError, setSeasonError] = useState<string | null>(null);
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
    if (!filters.season || seasonDetailRound < 1) return;
    const controller = new AbortController();
    const params = new URLSearchParams({ league: filters.league, season: filters.season, round: String(seasonDetailRound) });
    const bestParams = new URLSearchParams(params);
    bestParams.set("scope", "season");
    setSeasonError(null);
    Promise.all([api.dashboard(params, controller.signal), api.bestEleven(bestParams, controller.signal)])
      .then(([dashboard, eleven]) => { setSeasonDashboard(dashboard); setSeasonEleven(eleven); })
      .catch((reason: Error) => { if (!isAbort(reason)) { setSeasonDashboard(null); setSeasonEleven(null); setSeasonError(reason.message); } });
    return () => controller.abort();
  }, [filters.league, filters.season, seasonDetailRound]);

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
  const activeDashboard = scope === "season" ? seasonDashboard : archive;
  const activeEleven = scope === "season" ? seasonEleven : archiveEleven;
  const activeError = scope === "season" ? seasonError : archiveError;
  const activeRound = scope === "season" ? seasonDetailRound : archiveRound;
  return (
    <div className="history-view">
      <PageHeader title="Historie" description="Gesamtsaison und einzelne Spieltage" className="history-page-header" controls={<div className="history-toolbar" aria-label="Historienauswahl">
        <div className="scope-switch acorn-segmented-control" aria-label="Zeitraum">
          <button className={`acorn-segment ${scope === "season" ? "active is-selected" : ""}`} onClick={() => setScope("season")}>Gesamtsaison</button>
          <button className={`acorn-segment ${scope === "matchday" ? "active is-selected" : ""}`} onClick={() => setScope("matchday")}>Spieltag</button>
        </div>
        <StepperSelect label="Liga" value={filters.league} options={leagues.map((league) => ({ value: league.code, label: league.name }))} onChange={(value) => onFilter("league", value)} />
        <StepperSelect label="Saison" value={filters.season} options={[...seasons].reverse().map((season) => ({ value: String(season.startYear), label: season.displayName }))} onChange={(value) => onFilter("season", value)} />
        {scope === "matchday" && <StepperSelect label="Spieltag" value={String(archiveRound)} options={Array.from({ length: archiveMaximum }, (_, index) => ({ value: String(index + 1), label: `Spieltag ${index + 1}` }))} onChange={(value) => onFilter("round", value)} />}
      </div>} />
      {activeError ? <ErrorState message={activeError} /> : activeDashboard && activeEleven ? <>
        <div className="history-hero-grid">
          <section className="detail-section history-section history-top-list">
            <SimpleCardHead title={scope === "season" ? "Beste Saisonleistungen · Top 30" : `Spieltagsrangliste · Spieltag ${archiveRound}`} />
            {scope === "season"
              ? <HistoricalRanking players={history.leaderboards.overall} metric="points" onPlayer={(id) => onPlayer(id, filters.season, seasonDetailRound)} />
              : <PlayerRanking players={activeDashboard.matchdayLeaderboards.overall} metric="points" scope="matchday" scrollable onPlayer={(id) => onPlayer(id, filters.season, archiveRound)} />}
          </section>
          <HistoryBestEleven eleven={activeEleven} context={scope === "season" ? selectedSeason?.displayName ?? "Gesamtsaison" : `Spieltag ${archiveRound}`} onPlayer={(id) => onPlayer(id, filters.season, activeRound)} />
        </div>

        <HistoryTables
          history={history}
          dashboard={activeDashboard}
          scope={scope}
          onPlayer={(id) => onPlayer(id, filters.season, activeRound)}
          onTeam={(id) => onTeam(id, filters.season, activeRound)}
        />
      </> : <LoadingState />}
    </div>
  );
}

function HistoryBestEleven({ eleven, context, onPlayer }: { eleven: BestEleven; context: string; onPlayer: (id: string) => void }) {
  const grouped = groupBestEleven(eleven.players);
  return <section className="detail-section history-eleven"><div className="simple-card-head"><h2>Beste Elf · {context}</h2><div className="best-inline-summary"><strong>{eleven.points}</strong><span>Punkte · {eleven.formation}</span></div></div><div className="best-pitch compact-pitch">{(["FWD", "MID", "DEF", "GK"] as Position[]).map((position) => <div className="best-row" key={position}>{grouped[position].map((player) => <BestPlayerCard key={player.id} player={player} onClick={() => onPlayer(player.id)} />)}</div>)}</div></section>;
}

function HistoricalRanking({ players, metric, onPlayer }: { players: HistoricalPlayer[]; metric: "points" | "grade" | "goals" | "assists"; onPlayer: (id: string) => void }) {
  const value = (player: HistoricalPlayer) => metric === "grade" ? player.averageGrade?.toFixed(2) ?? "—" : metric === "goals" ? player.goals : metric === "assists" ? player.assists : player.points;
  const suffix = metric === "grade" ? "Note" : metric === "points" ? "Pkt." : metric === "goals" ? "Tore" : "Vorlagen";
  return <ol className="historical-ranking">{players.map((player, index) => <li key={player.id}><button onClick={() => onPlayer(player.id)}><span className="history-rank">{String(index + 1).padStart(2, "0")}</span><PlayerPortrait name={player.name} url={player.photoUrl} teamCode={player.teamCode} teamLogoUrl={player.logoUrl} /><span className="player-identity"><strong>{player.name}</strong><small>{player.team} · {positionName[player.position]}</small></span><span className="ranking-value"><strong>{value(player)}</strong><small>{suffix}</small></span></button></li>)}</ol>;
}

type HistoryTableRow = HistoricalPlayer;
type HistoryMetricSort = "grade" | "goals" | "assists";

function HistoryTables({ history, dashboard, scope, onPlayer, onTeam }: { history: History; dashboard: Dashboard; scope: "season" | "matchday"; onPlayer: (id: string) => void; onTeam: (id: string) => void }) {
  const [playerQuery, setPlayerQuery] = useState("");
  const [playerPosition, setPlayerPosition] = useState("");
  const [metricQuery, setMetricQuery] = useState("");
  const [metricPosition, setMetricPosition] = useState("");
  const [metricSort, setMetricSort] = useState<HistoryMetricSort>("grade");
  const [teamQuery, setTeamQuery] = useState("");
  const [teamSort, setTeamSort] = useState<TeamMetric>("overall");
  const [teamDirection, setTeamDirection] = useState<"asc" | "desc">("desc");

  const players = useMemo(() => {
    const merged = new Map<string, HistoryTableRow>();
    if (scope === "season") {
      const lists = [
        history.leaderboards.overall,
        ...Object.values(history.leaderboards.positions),
        history.leaderboards.grades,
        history.leaderboards.goals,
        history.leaderboards.assists,
      ];
      lists.flat().forEach((player) => merged.set(player.id, player));
    } else {
      const lists = [
        dashboard.matchdayLeaderboards.overall,
        ...Object.values(dashboard.matchdayLeaderboards.positions),
        dashboard.matchdayLeaderboards.grades,
        dashboard.matchdayLeaderboards.goals,
        dashboard.matchdayLeaderboards.assists,
      ];
      lists.flat().forEach((player) => merged.set(player.id, {
        id: player.id,
        name: player.name,
        team: player.team,
        teamCode: player.teamCode,
        logoUrl: player.logoUrl,
        photoUrl: player.photoUrl,
        position: player.position,
        points: player.roundPoints,
        averageGrade: player.roundGrade,
        gradedMatches: player.roundGrade == null ? 0 : 1,
        goals: player.roundGoals,
        assists: player.roundAssists,
      }));
    }
    return [...merged.values()];
  }, [dashboard, history, scope]);

  const normalizedPlayerQuery = playerQuery.trim().toLocaleLowerCase("de");
  const pointRows = players
    .filter((player) => (!playerPosition || player.position === playerPosition) && (!normalizedPlayerQuery || `${player.name} ${player.team}`.toLocaleLowerCase("de").includes(normalizedPlayerQuery)))
    .sort((left, right) => right.points - left.points || left.name.localeCompare(right.name, "de"));
  const normalizedMetricQuery = metricQuery.trim().toLocaleLowerCase("de");
  const metricRows = players
    .filter((player) => (!metricPosition || player.position === metricPosition) && (!normalizedMetricQuery || `${player.name} ${player.team}`.toLocaleLowerCase("de").includes(normalizedMetricQuery)))
    .sort((left, right) => {
      if (metricSort === "grade") {
        if (left.averageGrade == null) return 1;
        if (right.averageGrade == null) return -1;
        return left.averageGrade - right.averageGrade || right.points - left.points;
      }
      return right[metricSort] - left[metricSort] || right.points - left.points;
    });

  const teams = (scope === "season" ? dashboard.seasonTeams : dashboard.matchdayTeams)
    .filter((team) => team.name.toLocaleLowerCase("de").includes(teamQuery.trim().toLocaleLowerCase("de")))
    .sort((left, right) => {
      const difference = left[teamSort] - right[teamSort];
      return difference ? (teamDirection === "asc" ? difference : -difference) : left.name.localeCompare(right.name, "de");
    });
  const positionOptions = [{ value: "", label: "Alle Positionen" }, ...(["GK", "DEF", "MID", "FWD"] as Position[]).map((position) => ({ value: position, label: positionName[position] }))];

  function sortTeams(metric: TeamMetric) {
    if (metric === teamSort) setTeamDirection((direction) => direction === "desc" ? "asc" : "desc");
    else { setTeamSort(metric); setTeamDirection("desc"); }
  }

  const identityColumn: DataTableColumn<HistoryTableRow> = {
    id: "player",
    label: "Spieler",
    width: "55%",
    render: (player, index) => <div className="table-player"><span className="rank">{index + 1}</span><PlayerPortrait name={player.name} url={player.photoUrl} teamCode={player.teamCode} teamLogoUrl={player.logoUrl} /><span><strong>{player.name}</strong><small>{player.team}</small></span></div>,
  };
  const playerColumns: DataTableColumn<HistoryTableRow>[] = [
    identityColumn,
    { id: "position", label: "Position", render: (player) => <PositionTag position={player.position} /> },
    { id: "points", label: "Punkte", numeric: true, className: "primary-num", render: (player) => player.points },
  ];
  const metricColumns: DataTableColumn<HistoryTableRow>[] = [
    { ...identityColumn, width: "40%" },
    { id: "position", label: "Position", render: (player) => <PositionTag position={player.position} /> },
    { id: "grade", label: "Ø-Note", numeric: true, render: (player) => player.averageGrade?.toFixed(2) ?? "—" },
    { id: "goals", label: "Tore", numeric: true, render: (player) => player.goals },
    { id: "assists", label: "Vorlagen", numeric: true, render: (player) => player.assists },
    { id: "graded", label: "Benotet", numeric: true, render: (player) => player.gradedMatches },
  ];
  const teamColumns: DataTableColumn<TeamScore>[] = [
    { id: "team", label: "Verein", width: "36%", render: (team, index) => <div className="table-team"><span className="rank">{index + 1}</span><TeamLogo code={team.code} url={team.logoUrl} large /><span><strong>{team.name}</strong><small>{team.sampleSize} Spieler mit Wertung</small></span></div> },
    ...teamMetrics.map((metric): DataTableColumn<TeamScore> => ({
      id: metric.key,
      label: metric.label,
      numeric: true,
      className: "team-points-cell",
      sort: { active: teamSort === metric.key, direction: teamDirection, onSort: () => sortTeams(metric.key) },
      render: (team) => <TeamMetricCell value={team[metric.key]} label={metric.label} players={team.topPlayers[metric.leaders]} contextLabel={scope === "season" ? "Saisonpunkte" : "Spieltagspunkte"} />,
    })),
  ];

  return <div className="history-table-stack">
    <section className="history-table-block">
      <div className="section-copy"><p className="kicker">{scope === "season" ? "Gesamtsaison" : "Ausgewählter Spieltag"}</p><h2>Spielerwertungen</h2></div>
      <DataTable ariaLabel="Spielerwertungen" rows={pointRows} columns={playerColumns} getRowKey={(player) => player.id} search={{ value: playerQuery, onChange: setPlayerQuery, placeholder: "Spieler oder Mannschaft suchen" }} filters={[{ id: "position", label: "Position", value: playerPosition, onChange: setPlayerPosition, options: positionOptions }]} countLabel={`${pointRows.length} Spieler`} emptyMessage="Keine Spieler entsprechen diesen Filtern." minWidth="720px" maxVisibleRows={10} onRowClick={(player) => onPlayer(player.id)} />
    </section>
    <section className="history-table-block">
      <div className="section-copy"><p className="kicker">Leistungsdaten</p><h2>Noten, Tore und Vorlagen</h2></div>
      <DataTable ariaLabel="Leistungsdaten der Spieler" rows={metricRows} columns={metricColumns} getRowKey={(player) => player.id} search={{ value: metricQuery, onChange: setMetricQuery, placeholder: "Spieler oder Mannschaft suchen" }} filters={[
        { id: "position", label: "Position", value: metricPosition, onChange: setMetricPosition, options: positionOptions },
        { id: "metric", label: "Sortierung", value: metricSort, onChange: (value) => setMetricSort(value as HistoryMetricSort), options: [{ value: "grade", label: "Nach Note" }, { value: "goals", label: "Nach Toren" }, { value: "assists", label: "Nach Vorlagen" }] },
      ]} countLabel={`${metricRows.length} Spieler`} emptyMessage="Keine Leistungsdaten entsprechen diesen Filtern." minWidth="880px" maxVisibleRows={10} onRowClick={(player) => onPlayer(player.id)} />
    </section>
    <section className="history-table-block">
      <div className="section-copy"><p className="kicker">{scope === "season" ? "Gesamtsaison" : "Ausgewählter Spieltag"}</p><h2>Mannschaftswertungen</h2></div>
      <DataTable ariaLabel="Mannschaftswertungen" rows={teams} columns={teamColumns} getRowKey={(team) => team.id} search={{ value: teamQuery, onChange: setTeamQuery, placeholder: "Verein suchen" }} countLabel={`${teams.length} Vereine`} emptyMessage="Keine Mannschaftswertungen verfügbar." minWidth="900px" onRowClick={(team) => onTeam(team.id)} />
    </section>
  </div>;
}

function PlayersView({ filters, onPlayer }: { filters: Filters; onPlayer: (id: string) => void }) {
  const [query, setQuery] = useState("");
  const [position, setPosition] = useState("");
  const [team, setTeam] = useState("");
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

  const teamOptions = useMemo(() => [...new Set(players.map((player) => player.team))].sort((left, right) => left.localeCompare(right, "de")), [players]);
  const visiblePlayers = team ? players.filter((player) => player.team === team) : players;
  const columns: DataTableColumn<Player>[] = [
    { id: "player", label: "Spieler", width: "29%", sort: { active: sort === "name", direction, onSort: () => sortBy("name") }, render: (player, index) => <div className="table-player"><span className="rank">{index + 1}</span><PlayerPortrait name={player.name} url={player.photoUrl} teamCode={player.teamCode} teamLogoUrl={player.logoUrl} /><span><strong>{player.name}</strong><small>{player.team}</small></span></div> },
    { id: "position", label: "Position", sort: { active: sort === "position", direction, onSort: () => sortBy("position") }, render: (player) => <PositionTag position={player.position} /> },
    { id: "price", label: "Marktwert", numeric: true, sort: { active: sort === "price", direction, onSort: () => sortBy("price") }, render: (player) => formatMarketValue(player.priceM) },
    { id: "round", label: `Spieltag ${filters.round}`, numeric: true, className: "matchday-score", sort: { active: sort === "round", direction, onSort: () => sortBy("round") }, render: (player) => player.roundPoints },
    { id: "points", label: `Gesamt bis Spieltag ${filters.round}`, numeric: true, className: "primary-num", sort: { active: sort === "points", direction, onSort: () => sortBy("points") }, render: (player) => player.observedPoints },
    { id: "goals", label: "Tore", numeric: true, sort: { active: sort === "goals", direction, onSort: () => sortBy("goals") }, render: (player) => player.goals },
    { id: "assists", label: "Vorlagen", numeric: true, sort: { active: sort === "assists", direction, onSort: () => sortBy("assists") }, render: (player) => player.assists },
    { id: "grade", label: "Ø-Note", numeric: true, sort: { active: sort === "grade", direction, onSort: () => sortBy("grade") }, render: (player) => player.averageGrade?.toFixed(2) ?? "—" },
    { id: "value", label: "Wert · Pkt. / Mio. €", numeric: true, sort: { active: sort === "value", direction, onSort: () => sortBy("value") }, render: (player) => formatPlayerValue(player.value) },
  ];

  return (
    <section className="data-page-section">
      {error ? <ErrorState message={error} /> : <DataTable
        ariaLabel="Spielerwertung"
        rows={visiblePlayers}
        columns={columns}
        getRowKey={(player) => player.id}
        search={{ value: query, onChange: setQuery, placeholder: "Spieler oder Mannschaft" }}
        filters={[
          { id: "position", label: "Position", value: position, onChange: setPosition, options: [{ value: "", label: "Alle Positionen" }, ...(["GK", "DEF", "MID", "FWD"] as Position[]).map((item) => ({ value: item, label: positionName[item] }))] },
          { id: "team", label: "Mannschaft", value: team, onChange: setTeam, options: [{ value: "", label: "Alle Mannschaften" }, ...teamOptions.map((item) => ({ value: item, label: item }))] },
        ]}
        countLabel={`${visiblePlayers.length} Spieler`}
        emptyMessage="Keine Spieler entsprechen diesen Filtern."
        loading={loading}
        minWidth="1120px"
        onRowClick={(player) => onPlayer(player.id)}
      />}
    </section>
  );
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
        <div className="profile-copy"><p className="kicker">{positionName[detail.position]}</p><h2>{detail.name}</h2><div className="profile-context"><button className="profile-team-link" onClick={() => onTeam(detail.teamId)}>{detail.team}</button><span>{detail.league} · {detail.season}</span></div><div className="profile-links"><a href={detail.kickerUrl} target="_blank" rel="noreferrer">kicker-Profil ↗</a>{detail.ligaInsiderUrl && <a href={detail.ligaInsiderUrl} target="_blank" rel="noreferrer">LigaInsider ↗</a>}<a href={detail.transfermarktUrl} target="_blank" rel="noreferrer">Transfermarkt ↗</a></div></div>
        <div className="profile-stats">
          <span><strong>{detail.seasonPoints}</strong><small>Saisonpunkte</small></span>
          <span><strong>{formatMarketValue(detail.priceM)}</strong><small>Marktwert</small></span>
          <span><strong>{formatPlayerValue(detail.value)}</strong><small>Wert · Pkt. / Mio. €</small></span>
        </div>
      </header>
      {detail.availability && (
        <aside className={`availability-alert ${detail.availability.status}`}>
          <div><p className="kicker">Aktueller Verfügbarkeitsstatus</p><strong>{availabilityStatusName[detail.availability.status]}{detail.availability.reason ? ` · ${detail.availability.reason}` : ""}</strong><small>{detail.availability.absentSince ? `Fehlt seit ${detail.availability.absentSince}. ` : ""}{detail.availability.expectedReturn ? `Erwartete Rückkehr: ${formatDate(detail.availability.expectedReturn)}.` : "Kein bestätigtes Rückkehrdatum."}</small></div>
          <a href={detail.availability.sourceUrl} target="_blank" rel="noreferrer">{detail.availability.source} · Stand {formatDate(detail.availability.generatedAt)} ↗</a>
        </aside>
      )}
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
  const remainingProjection = Boolean(
    recommendation?.currentSeasonEvidence?.realizedPointsExcludedFromSelectionObjective
    && recommendation.currentSeasonEvidence.throughMatchday > 0,
  );
  const optimizationStartsAt = recommendation?.currentSeasonEvidence?.optimizationStartsAtMatchday
    ?? ((recommendation?.currentSeasonEvidence?.throughMatchday ?? 0) + 1);
  const methodology = recommendation ? (recommendation.modelVersion === 2
    ? recommendation.mode === "classic"
      ? remainingProjection
        ? `Der Kader maximiert die verfügbarkeitsbereinigten Punkte ab Spieltag ${optimizationStartsAt} mit festen Starter- und Reserveslots; bereits erzielte Punkte beeinflussen die Auswahl nicht.`
        : "Der September-Kader maximiert verfügbarkeitsbereinigte Saisonpunkte mit festen Starter- und Reserveslots; die drei möglichen Winterwechsel werden erst am echten Stichtag mit den dann bekannten Informationen festgelegt."
      : remainingProjection
        ? `Punkte- und Rollenprognosen wählen den Kader ab Spieltag ${optimizationStartsAt} gemeinsam mit der besten zulässigen Elf je Spieltag. Bereits erzielte Punkte beeinflussen die Auswahl nicht.`
        : "Punkte- und Rollenprognosen wählen den Kader gemeinsam mit der besten zulässigen Elf je Spieltag. Alle drei Torhüter kommen als Ausfallversicherung vom selben Verein."
    : "Optimiert nach Punkteprognose sowie Positions-, Formations- und Vereinsregeln.") : "";
  return (
    <div className="manager-view">
      <div className="manager-toolbar">
        <div className="scope-switch" aria-label="Spielmodus">
          <button className={mode === "classic" ? "active" : ""} onClick={() => setMode("classic")}>Classic</button>
          <button className={mode === "interactive" ? "active" : ""} onClick={() => setMode("interactive")}>Interactive</button>
        </div>
        <p>{mode === "classic" ? "15 Spieler · feste 4-4-2-Aufstellung" : "22 Spieler · beste Elf und Formation für jeden Spieltag"}</p>
      </div>
      {loading || !recommendation ? <LoadingState /> : (
        <>
          <div className="manager-content-grid">
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
          </div>
          <details className="manager-methodology">
            <summary>Methodik &amp; Datenstand</summary>
            <div><p>{methodology} Prognosen sind Erwartungswerte, keine Garantie.</p>
              {recommendation.availabilityAudit && <p>
                {recommendation.currentSeasonEvidence && recommendation.currentSeasonEvidence.throughMatchday > 0 && <><strong>Aktuelle Saison berücksichtigt:</strong> {recommendation.currentSeasonEvidence.completedMatches} Spiele und {recommendation.currentSeasonEvidence.roleObservations} Rollenbeobachtungen bis Spieltag {recommendation.currentSeasonEvidence.throughMatchday}; Kaderauswahl ab Spieltag {optimizationStartsAt}. </>}
                <strong>Verfügbarkeit geprüft:</strong> {recommendation.availabilityAudit.excludedPlayerCount} aktuell verletzte, im Aufbautraining befindliche oder nicht berücksichtigte Kandidaten wurden ausgeschlossen. <a href={recommendation.availabilityAudit.sourceUrl} target="_blank" rel="noreferrer">{recommendation.availabilityAudit.provider} · Stand {formatDate(recommendation.availabilityAudit.generatedAt)} ↗</a>
              </p>}
            </div>
          </details>
        </>
      )}
    </div>
  );
}

function ManagerPlayerCard({ player, onClick }: { player: ManagerRecommendation["players"][number]; onClick: () => void }) {
  return <button className="manager-player-card" onClick={onClick} title={`${player.name} · ${player.team}`}><PlayerPortrait name={player.name} url={player.photoUrl} teamCode={player.teamCode} teamLogoUrl={player.logoUrl} /><span><strong>{lastName(player.name)}</strong><small>{player.team}</small></span><b>{player.currentPoints} Pkt.<small>aktuell</small></b>{player.promotionAdjusted && <em>Ligastufe korrigiert</em>}</button>;
}

function ManagerPlayerRow({ player, onClick }: { player: ManagerRecommendation["players"][number]; onClick: () => void }) {
  const confidence = ({ high: "hoch", medium: "mittel", low: "gering" } as const)[player.confidence];
  return <button onClick={onClick}><PlayerPortrait name={player.name} url={player.photoUrl} teamCode={player.teamCode} teamLogoUrl={player.logoUrl} /><span><strong>{player.name}</strong><small>{positionName[player.position]} · {player.team}{player.promotionAdjusted ? " · Ligastufe korrigiert" : ""}</small></span><span><b>{player.currentPoints} Pkt.</b><small>Aktuell</small></span><em className={`confidence ${player.confidence}`}>{confidence}</em></button>;
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
      <td className="num"><ActionValue points={game.points} /></td>
      <td className="num"><ActionValue value={game.grade?.toFixed(2) ?? "Keine Note"} points={game.pointsGrade} /></td>
      <td className="num"><ActionValue value={`${game.goals} ${game.goals === 1 ? "Tor" : "Tore"}`} points={game.pointsGoals} /></td>
      <td className="num"><ActionValue value={`${game.assists} ${game.assists === 1 ? "Vorlage" : "Vorlagen"}`} points={game.pointsAssists} /></td>
      <td className="num"><ActionValue points={game.pointsCleanSheet} /></td>
      <td className="num"><ActionValue points={game.pointsStarter} /></td>
      <td className="num"><CardActionValue points={game.pointsCards} /></td>
      <td className="num"><ActionValue points={game.pointsMvp} /></td>
      <td className="num"><ActionValue points={game.pointsJoker} /></td>
    </tr>
  );
}

function ActionValue({ value, points }: { value?: string | number; points: number }) {
  return <span className="action-value">
    <span className="action-point-total"><strong className={points < 0 ? "negative" : ""}>{formatSignedPoints(points)}</strong><small>Pkt.</small></span>
    {value != null && <small className="action-detail">{value}</small>}
  </span>;
}

function CardActionValue({ points }: { points: number }) {
  const label = points === -3 ? "Gelb-Rot" : points === -6 ? "Rot" : points < 0 ? "Platzverweis" : "—";
  return <ActionValue value={points < 0 ? label : undefined} points={points} />;
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
  const positionTotals: { label: string; value: number }[] = [
    { label: "Torwart", value: detail.matches.reduce((sum, match) => sum + match.goalkeeperPoints, 0) },
    { label: "Abwehr", value: detail.matches.reduce((sum, match) => sum + match.defencePoints, 0) },
    { label: "Mittelfeld", value: detail.matches.reduce((sum, match) => sum + match.midfieldPoints, 0) },
    { label: "Sturm", value: detail.matches.reduce((sum, match) => sum + match.forwardPoints, 0) },
  ];
  const strongestPart = [...positionTotals].sort((left, right) => right.value - left.value)[0];
  const rosterColumns: DataTableColumn<TeamDetail["players"][number]>[] = [
    {
      id: "player",
      label: "Spieler",
      width: "78%",
      render: (player, index) => <div className="table-player">
        <span className="rank">{index + 1}</span>
        <PlayerPortrait name={player.name} url={player.photoUrl} teamCode={detail.code} teamLogoUrl={detail.logoUrl} />
        <span><strong>{player.name}</strong><small>{positionName[player.position]}</small></span>
      </div>,
    },
    {
      id: "points",
      label: "Punkte",
      numeric: true,
      className: "point-value",
      width: "22%",
      render: (player) => <>{player.points}<small>Pkt.</small></>,
    },
  ];
  return (
    <div className="team-detail-view">
      <section className="detail-section team-detail-section">
        <button className="back-button" onClick={onBack}>← {backLabel}</button>
        <header className="team-profile">
          <TeamLogo code={detail.code} url={detail.logoUrl} large />
          <div><p className="kicker">Mannschaftsprofil</p><h2>{detail.name}</h2><span>Alle Wertungen der ausgewählten Saison</span></div>
          <div className="team-profile-stats"><span><strong>{totalPoints}</strong><small>Gesamtpunkte</small></span><span><strong>{detail.players.length}</strong><small>Spieler</small></span><span><strong>{strongestPart.label}</strong><small>Stärkster Mannschaftsteil</small></span></div>
        </header>
        <div className="team-detail-grid">
          <article className="team-roster-card">
            <CardHead eyebrow="Kader" title="Spieler und Punkte" subtitle="Klicken für das Spielerprofil" />
            <div className="team-roster-table">
              <DataTable
                ariaLabel={`${detail.name}: Spieler und Punkte`}
                rows={detail.players}
                columns={rosterColumns}
                getRowKey={(player) => player.id}
                emptyMessage="Keine Spieler für diese Saison verfügbar."
                minWidth="100%"
                maxVisibleRows={11}
                onRowClick={(player) => onPlayer(player.id)}
              />
            </div>
          </article>
          <article className="team-season-summary">
            <CardHead eyebrow="Saisonverlauf" title="Jedes Spiel im Detail" subtitle="Punkte nach Mannschaftsteil und Aktion" />
            <div className="team-match-list">
              {detail.matches.map((match) => <TeamMatchCard key={match.matchday} match={match} onTeam={onTeam} onPlayer={onPlayer} />)}
            </div>
          </article>
        </div>
        {detail.externalSources && (
          <section className="player-news team-source-news" aria-labelledby="team-news-title">
            <div className="section-copy news-heading">
              <div><p className="kicker">Medienbeobachtung</p><h3 id="team-news-title">Aktuelle Mannschaftsthemen</h3></div>
              <div className="news-actions"><span>Quellenstand {formatDate(detail.externalSources.generatedAt)}</span><a href={detail.externalSources.ligaInsiderUrl} target="_blank" rel="noreferrer">LigaInsider ↗</a><a href={detail.externalSources.transfermarktUrl} target="_blank" rel="noreferrer">Transfermarkt ↗</a></div>
            </div>
            <ol className="news-list">{detail.externalSources.headlines.map((article) => <li key={article.url}><a href={article.url} target="_blank" rel="noreferrer"><span><b>{article.source}</b></span><strong>{article.title}</strong><small>ligainsider.de ↗</small></a></li>)}</ol>
          </section>
        )}
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
    <details className="team-match-card">
      <summary>
        <span className="matchday-badge">Spieltag {match.matchday}</span>
        <span className="team-match-opponent"><TeamLogo code={match.opponentCode} url={match.opponentLogoUrl} /><span><strong>{match.opponent}</strong><small>{formatDate(match.scheduledAt)} · {formatVenue(match.venue)}</small></span></span>
        <span className="team-match-result"><strong>{result}</strong></span>
        <span className="team-match-total"><strong>{match.totalPoints}</strong><small>Punkte</small></span>
        <span className="team-match-toggle" aria-hidden="true">⌄</span>
      </summary>
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
      <button className="match-opponent-link" onClick={() => onTeam(match.opponentId)}>{match.opponent} öffnen →</button>
    </details>
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
  const [query, setQuery] = useState("");
  const [sortMetric, setSortMetric] = useState<TeamMetric>("overall");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const sortedTeams = useMemo(() => teams.filter((team) => team.name.toLocaleLowerCase("de").includes(query.trim().toLocaleLowerCase("de"))).sort((left, right) => {
    const difference = left[sortMetric] - right[sortMetric];
    if (difference !== 0) return sortDirection === "asc" ? difference : -difference;
    return left.name.localeCompare(right.name, "de");
  }), [teams, query, sortMetric, sortDirection]);

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
  const columns: DataTableColumn<TeamScore>[] = [
    { id: "team", label: "Verein", width: "36%", render: (team, index) => <div className="table-team"><span className="rank">{index + 1}</span><TeamLogo code={team.code} url={team.logoUrl} large /><span><strong>{team.name}</strong><small>{team.sampleSize} Spieler mit Wertung</small></span></div> },
    ...teamMetrics.map((metric): DataTableColumn<TeamScore> => ({
      id: metric.key,
      label: metric.label,
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
        countLabel={`${sortedTeams.length} Vereine`}
        emptyMessage="Für diese Saison liegen keine Mannschaftswertungen vor."
        loading={loading}
        minWidth="900px"
        onRowClick={(team) => onTeam(team.id)}
      />
    </section>
  );
}

function TeamMetricCell({ value, label, players, contextLabel = "Saisonpunkte" }: { value: number; label: string; players: TeamPlayerScore[]; contextLabel?: string }) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const tooltipId = useId();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const open = hovered || focused;
  return (
    <div ref={anchorRef} className="team-metric-cell" tabIndex={0} aria-describedby={open ? tooltipId : undefined} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}>
      <div className="team-score"><strong>{value || "—"}</strong><span>Pkt.</span></div>
      <FloatingScorePopover anchorRef={anchorRef} open={open} id={tooltipId} className="metric-popover" preferredWidth={315}>
        <header><strong>{label}</strong><span>{contextLabel}</span></header>
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
  const [position, setPosition] = useState<Position | "">("");

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
      <StepperSelect label="Liga" value={filters.league} options={leagues.map((league) => ({ value: league.code, label: league.name }))} onChange={(value) => onFilter("league", value)} />
      <StepperSelect label="Position" value={position} options={[{ value: "", label: "Alle Positionen" }, ...(["GK", "DEF", "MID", "FWD"] as Position[]).map((item) => ({ value: item, label: positionName[item] }))]} onChange={(value) => setPosition(value as Position | "")} />
      <StepperSelect label="Sortierung" value={sort} options={[
        { value: "previous", label: "Punkte Vorsaison" },
        { value: "average", label: "Saisonschnitt" },
        { value: "value", label: "Preis-Leistung" },
        { value: "trend", label: "Jüngster Trend" },
        { value: "price", label: "Marktwert" },
      ]} onChange={(value) => setSort(value as TopPlayerSort)} />
    </div>
  );

  const visiblePlayers = data ? sortTopPlayers(
    (["GK", "DEF", "MID", "FWD"] as Position[]).filter((item) => !position || item === position).flatMap((item) => data.positions[item]),
    sort,
  ) : [];
  const columns: DataTableColumn<TopPlayerAnalysis>[] = [
    { id: "player", label: "Spieler", width: "31%", render: (player, index) => <div className="table-player"><span className="rank">{index + 1}</span><PlayerPortrait name={player.name} url={player.photoUrl} teamCode={player.teamCode} teamLogoUrl={player.logoUrl} /><span><strong>{player.name}</strong><small>{player.team}</small></span></div> },
    { id: "position", label: "Position", render: (player) => <PositionTag position={player.position} /> },
    { id: "price", label: "Marktwert", numeric: true, render: (player) => formatMarketValue(player.priceM) },
    { id: "previous", label: "Vorsaison", numeric: true, className: "point-value", render: (player) => <>{player.previousPoints ?? "—"}<small>{player.previousSeason ?? "keine Historie"}</small></> },
    { id: "average", label: "Ø Punkte", numeric: true, className: "point-value", render: (player) => player.averagePoints ?? "—" },
    { id: "value", label: "Pkt. / Mio. €", numeric: true, render: (player) => formatPlayerValue(player.value) },
    { id: "history", label: "Verlauf", render: (player) => {
      const historyLabel = player.history.map((season) => `${season.season} · ${season.league}: ${season.points} Punkte`).join("\n");
      const maxPoints = Math.max(1, ...player.history.map((season) => Math.max(0, season.points)));
      return <span className="top-player-history table-history" title={historyLabel} aria-label={historyLabel || "Keine Vergleichssaison"}>{player.history.map((season) => <i key={`${season.season}-${season.league}`} style={{ height: `${Math.max(12, Math.round((Math.max(0, season.points) / maxPoints) * 100))}%` }} />)}</span>;
    } },
    { id: "signal", label: "Einordnung", render: (player) => <span className="player-signal">{player.signal}</span> },
  ];

  return (
    <div className="top-players-view">
      <PageHeader title="Topspieler" description="Kaufbarer Spielerpool auf Basis abgeschlossener Saisons" controls={controls} />
      {data && <p className="top-players-context-inline"><strong>{data.context.playerCount} kaufbare Spieler</strong><span>{data.context.cutoffSeason ? `Leistungsdaten bis einschließlich ${data.context.cutoffSeason}` : "noch keine abgeschlossene Vorsaison importiert"}</span></p>}
      {error ? <ErrorState message={error} /> : loading || !data ? <LoadingState /> : <DataTable ariaLabel="Topspieler" rows={visiblePlayers} columns={columns} getRowKey={(player) => player.id} emptyMessage="Für diese Position sind keine kaufbaren Spieler importiert." minWidth="1120px" onRowClick={(player) => onPlayer(player.id)} />}
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
function formatSignedPoints(value: number) { return value > 0 ? `+${value}` : value < 0 ? `−${Math.abs(value)}` : "0"; }
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
