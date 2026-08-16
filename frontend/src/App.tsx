import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, ReactNode, RefObject } from "react";
import { createPortal } from "react-dom";
import { api } from "./api";
import { DataTable } from "./DataTable";
import { applyManagerLocation, managerLocationFromSearch } from "./manager-location";
import { newsAttribution, newsSourceLabel } from "./news";
import { hrefForView, pathForView, viewFromPathname } from "./routes";
import type { DataTableColumn } from "./DataTable";
import type { ManagerLocation, ManagerSection } from "./manager-location";
import type { RouteView } from "./routes";
import { initialAvailableRound, latestAvailableRound } from "./rounds";
import type {
  BestEleven,
  BestElevenPlayer,
  Catalog,
  Dashboard,
  LeagueStandings,
  LeagueTableFormEntry,
  LeagueTableRow,
  MatchdayContributor,
  MatchdayFixture,
  MatchdayFixtureSide,
  ManagerMode,
  ManagerFixture,
  ManagerRecommendation,
  ManagerScheduleRound,
  NewsArticle,
  Player,
  PlayerDetail,
  PlayerGame,
  Position,
  SquadNews,
  SquadNewsArticle,
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
type View = RouteView;
type NavView = Exclude<View, "player" | "team">;
type Filters = { league: string; season: string; round: string };
type ViewLocation = { view: View; filters: Filters; playerId: string | null; teamId: string | null; managerLocation: ManagerLocation; scrollY: number };
type TeamMetric = "overall" | "goalkeeper" | "defence" | "midfield" | "forward";
type PlayerSort = "name" | "position" | "price" | "round" | "points" | "grade" | "goals" | "assists" | "value" | "roundGrade" | "roundGoals" | "roundAssists";
type PlayerScope = "season" | "round";
type TopPlayerSort = "current" | "previous" | "average" | "value" | "trend" | "price";
type Theme = "light" | "dark";

const themeStorageKey = "punktespiegel-theme";
const siteBaseUrl = "https://punktespiegel.org/";

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
const nav = [
  { id: "overview", label: "Überblick" },
  { id: "table", label: "Tabelle" },
  { id: "players", label: "Spieler" },
  { id: "teams", label: "Mannschaften" },
  { id: "top", label: "Topspieler" },
  { id: "manager", label: "Fantasy Team" },
] satisfies { id: NavView; label: string }[];
const navMobile: Record<(typeof nav)[number]["id"], { label: string; icon: ReactNode }> = {
  overview: {
    label: "Überblick",
    icon: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3.7 10.9 8.3-7 8.3 7" /><path d="M6 9.7V20h12V9.7" /></svg>,
  },
  table: {
    label: "Tabelle",
    icon: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 20V9.5h6V20" /><path d="M3.5 20v-6.7H9" /><path d="M20.5 20v-5.2H15" /><path d="M2.5 20h19" /></svg>,
  },
  players: {
    label: "Spieler",
    icon: <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="7.7" r="3.5" /><path d="M5.3 20c.9-3.7 3.6-5.7 6.7-5.7s5.8 2 6.7 5.7" /></svg>,
  },
  teams: {
    label: "Teams",
    icon: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.3 5.4 5.7v5.6c0 4.2 2.7 7.3 6.6 8.8 3.9-1.5 6.6-4.6 6.6-8.8V5.7Z" /></svg>,
  },
  top: {
    label: "Topspieler",
    icon: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3.7 2.4 5 5.5.8-4 3.9.9 5.5-4.8-2.6-4.8 2.6.9-5.5-4-3.9 5.5-.8Z" /></svg>,
  },
  manager: {
    label: "Fantasy",
    icon: <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4.4" y="3.4" width="15.2" height="17.2" rx="2.2" /><path d="M4.4 12h15.2" /><circle cx="12" cy="12" r="2.4" /></svg>,
  },
};
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
  const playerId = params.get("player");
  const teamId = params.get("team");
  const pathView = viewFromPathname(window.location.pathname, playerId, teamId);
  const legacyView = params.get("view");
  const value = pathView === "overview" && legacyView ? legacyView : pathView ?? legacyView;
  if (value === "player" && !params.get("player")) return "players";
  if (value === "team" && !params.get("team")) return "teams";
  if (value === "history") return "table";
  return (["overview", "table", "players", "player", "teams", "team", "top", "manager", ...infoViews] as View[]).includes(value as View)
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
  const params = isInfoView(view) ? new URLSearchParams() : scopeQuery(filters, view === "players");
  return hrefForView(view, params);
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
    table: "zur Tabelle",
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
  const [managerLocation, setManagerLocation] = useState<ManagerLocation>(() => managerLocationFromSearch(window.location.search));
  const [backStack, setBackStack] = useState<ViewLocation[]>([]);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [dashboardError, setDashboardError] = useState<string | null>(null);
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [overviewScope, setOverviewScope] = useState<"through" | "matchday">("through");
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
    const hasLegacyViewParam = new URLSearchParams(window.location.search).has("view");
    const currentPath = window.location.pathname.replace(/\/+$/, "") || "/";
    if (!hasLegacyViewParam && currentPath === pathForView(view)) return;
    syncUrl(filters, view, playerId, teamId, managerLocation);
  }, []);

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
  const overviewRound = Math.min(Math.max(1, Number(filters.round) || 1), Math.max(1, latestRound));
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
      table: {
        title: `Tabelle & Formkurve ${leagueName} ${seasonName}`,
        description: `Tabelle der ${leagueName} ${seasonName} nach Spieltag: Platzierungsverlauf, Form der letzten fünf Spiele und Kreuztabelle aller Paarungen.`,
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

    const canonical = new URL(pathForView(view), siteBaseUrl);
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
    api.dashboard(scopeQuery({ ...filters, season: String(selectedSeason.startYear), round: String(overviewRound) }), controller.signal)
      .then(setDashboard)
      .catch((reason: Error) => { if (!isAbort(reason)) setDashboardError(reason.message); })
      .finally(() => setDashboardLoading(false));
    return () => controller.abort();
  }, [filters.league, filters.season, overviewRound, latestRound, selectedSeason, view]);

  const showMatchday = view === "players";

  function syncUrl(nextFilters: Filters, nextView: View, nextPlayer: string | null, nextTeam: string | null, nextManagerLocation = managerLocation) {
    const params = isInfoView(nextView) ? new URLSearchParams() : scopeQuery(nextFilters);
    if (nextView === "player" && nextPlayer) params.set("player", nextPlayer);
    if (nextView === "team" && nextTeam) params.set("team", nextTeam);
    if (nextView === "manager") applyManagerLocation(params, nextManagerLocation);
    window.history.replaceState({}, "", hrefForView(nextView, params));
  }

  function updateManagerLocation(nextManagerLocation: ManagerLocation) {
    setManagerLocation(nextManagerLocation);
    syncUrl(filters, "manager", null, null, nextManagerLocation);
  }

  function rememberCurrentLocation() {
    setBackStack((stack) => [...stack, { view, filters: { ...filters }, playerId, teamId, managerLocation: { ...managerLocation }, scrollY: window.scrollY }]);
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
      : next === "table" && requestedSeason
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

  function openTeam(id: string) {
    rememberCurrentLocation();
    setPlayerId(null);
    setTeamId(id);
    setViewState("team");
    syncUrl(filters, "team", null, id);
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
    setManagerLocation(previous.managerLocation);
    setViewState(previous.view);
    syncUrl(previous.filters, previous.view, previous.playerId, previous.teamId, previous.managerLocation);
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
    ? latestRound > 0
      ? `${selectedSeason?.displayName ?? "Gewählte Saison"} · ${overviewScope === "matchday" ? `nur Spieltag ${overviewRound}` : `kumuliert bis Spieltag ${overviewRound}`}`
      : `${selectedSeason?.displayName ?? "Gewählte Saison"} · noch ohne abgeschlossenen Spieltag`
    : view === "teams"
      ? `${selectedSeason?.displayName ?? "Gewählte Saison"} · gesamte Saison`
      : view === "team"
        ? "Kader und Saisonverlauf"
      : view === "table"
        ? "Tabellenstand, Verlauf und Form"
        : view === "manager"
          ? `${newestSeason?.displayName ?? "Aktuelle Saison"} · Classic und Interactive`
        : view === "top"
          ? `${newestSeason?.displayName ?? "Aktuelle Saison"} · kaufbarer Spielerpool`
          : `${selectedSeason?.displayName ?? "Gewählte Saison"} · Spieltag ${filters.round}`;
  const navActive: NavView | null = isInfoView(view) ? null : view === "player" ? "players" : view === "team" ? "teams" : view;
  const previousView = backStack.at(-1)?.view;
  const backLabel = previousView ? `Zurück ${viewBackLabel(previousView)}` : view === "team" ? "Zurück zu den Mannschaften" : "Zurück zu den Spielern";

  return (
    <div className={`app-shell view-${view}`}>
      <header className="site-header">
        <a className="brand" href={viewHref("overview", filters)} onClick={(event) => { event.preventDefault(); setView("overview"); }} aria-label="Punktespiegel Startseite">
          <img src={`${import.meta.env.BASE_URL}brand/punktespiegel-mark.svg`} alt="" aria-hidden="true" />
          <span>Punktespiegel</span>
        </a>
        <nav className="main-nav" aria-label="Bereiche">
          {nav.map((item) => (
            <a key={item.id} href={viewHref(item.id, filters)} className={navActive === item.id ? "active" : ""} aria-current={navActive === item.id ? "page" : undefined} onClick={(event) => { event.preventDefault(); setView(item.id); }}>
              {item.label}
            </a>
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
        {!isInfoView(view) && view !== "table" && view !== "top" && <PageHeader title={title ?? ""} description={description} controls={<div className="selectors">
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
            {view === "overview" && latestRound > 0 && <>
              <div className="scope-switch acorn-segmented-control header-scope-switch" aria-label="Zeitraum">
                <button className={`acorn-segment ${overviewScope === "through" ? "active is-selected" : ""}`} onClick={() => setOverviewScope("through")}>Gesamt</button>
                <button className={`acorn-segment ${overviewScope === "matchday" ? "active is-selected" : ""}`} onClick={() => setOverviewScope("matchday")}>Nur Spieltag</button>
              </div>
              <StepperSelect label="Spieltag" value={String(overviewRound)} options={Array.from({ length: Math.max(1, latestRound) }, (_, index) => ({ value: String(index + 1), label: `Spieltag ${index + 1}` }))} onChange={(value) => updateFilter("round", value)} />
            </>}
          </div>} />}

        {isInfoView(view) ? <InfoPage view={view} filters={filters} onView={setView} /> : catalogError ? <ErrorState message={catalogError} /> : !catalog ? <LoadingState /> : (
          <>
            {view === "overview" && (
              latestRound < 1 ? <section className="detail-section"><Empty message="Für diese Saison liegen noch keine Daten eines abgeschlossenen Spieltags vor." /></section>
                : dashboardError ? <ErrorState message={dashboardError} />
                : dashboardLoading || !dashboard ? <LoadingState />
                  : <Overview data={dashboard} scope={overviewScope} eleven={{ league: filters.league, season: String(selectedSeason?.startYear ?? filters.season), round: overviewRound }} onView={setView} onPlayer={openPlayer} onTeam={openTeam} />
            )}
            {view === "players" && <PlayersView filters={filters} onPlayer={openPlayer} />}
            {view === "player" && playerId && (playerSelectionPending ? <LoadingState /> : <PlayerDetailView filters={filters} playerId={playerId} backLabel={backLabel} onBack={() => goBack("players")} onTeam={openTeam} onSeason={(year) => updatePlayerSeason(String(year))} />)}
            {view === "teams" && <TeamsView filters={filters} onTeam={openTeam} />}
            {view === "team" && teamId && (teamSelectionPending ? <LoadingState /> : <TeamDetailView filters={filters} teamId={teamId} backLabel={backLabel} onBack={() => goBack("teams")} onPlayer={openPlayer} onTeam={openTeam} />)}
            {view === "table" && <TabelleView filters={filters} leagues={catalog.leagues} seasons={seasons} onFilter={updateFilter} onTeam={openTeam} onPlayer={openPlayer} />}
            {view === "top" && <TopPlayersView filters={filters} leagues={catalog.leagues} onFilter={updateFilter} onPlayer={openPlayer} />}
            {view === "manager" && <ManagerPicksView
              filters={filters}
              section={managerLocation.section}
              selectedMatchday={managerLocation.matchday}
              onSection={(section) => updateManagerLocation({ ...managerLocation, section })}
              onMatchday={(matchday) => updateManagerLocation({ ...managerLocation, matchday })}
              onPlayer={openPlayer}
            />}
          </>
        )}
        <SiteFooter currentView={view} filters={filters} onView={setView} />
      </main>
      <MobileNav active={navActive} filters={filters} onView={setView} />
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

function MobileNav({ active, filters, onView }: { active: NavView | null; filters: Filters; onView: (view: NavView) => void }) {
  return <nav className="mobile-nav" aria-label="Bereiche">
    {nav.map((item) => (
      <a key={item.id} href={viewHref(item.id, filters)} className={active === item.id ? "active" : ""} aria-current={active === item.id ? "page" : undefined} onClick={(event) => { event.preventDefault(); onView(item.id); }}>
        <span className="mobile-nav-icon" aria-hidden="true">{navMobile[item.id].icon}</span>
        <span>{navMobile[item.id].label}</span>
      </a>
    ))}
  </nav>;
}

function Overview({ data, scope, eleven, onView, onPlayer, onTeam }: { data: Dashboard; scope: "through" | "matchday"; eleven: { league: string; season: string; round: number }; onView: (view: NavView) => void; onPlayer: (id: string) => void; onTeam: (id: string) => void }) {
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
    <section className="overview-grid" aria-label="Saisonüberblick">
      <article className="dashboard-card team-pulse-card">
        <CardHead eyebrow={matchdayOnly ? `Nur Spieltag ${round}` : `Bis einschließlich Spieltag ${round}`} title="Mannschaftswertung" subtitle={matchdayOnly ? "Punkte aller Spieler des Vereins an diesem Spieltag" : "Gesamtpunkte aller Spieler des Vereins"} action={<button onClick={() => onView("teams")}>Alle Mannschaften</button>} />
        <TeamRanking teams={matchdayOnly ? data.matchdayTeams : data.seasonTeams} matchday={round} scope={matchdayOnly ? "matchday" : "through"} onTeam={onTeam} />
      </article>
      <article className="dashboard-card">
        <CardHead eyebrow={matchdayOnly ? `Spieltag ${round}` : "Gesamt"} title={matchdayOnly ? "Spieltagsrangliste" : "Aktuelle Rangliste"} subtitle={matchdayOnly ? `Punkte an Spieltag ${round}` : `Gesamtpunkte bis Spieltag ${round}`} action={<button onClick={() => onView("players")}>Alle Spieler</button>} />
        <PlayerRanking players={leaderboards.overall} metric="points" scope={playerScope} onPlayer={onPlayer} />
      </article>
      <article className="dashboard-card position-card">
        <SimpleCardHead title="Nach Position" action={<div className="metric-tabs overview-tabs" aria-label="Position">
          {(["GK", "DEF", "MID", "FWD"] as Position[]).map((item) => <button key={item} className={position === item ? "active" : ""} onClick={() => setPosition(item)}>{positionName[item]}</button>)}
        </div>} />
        <div className="overview-tab-panel">
          <OverviewPlayerTable players={leaderboards.positions[position] ?? []} metric="points" scope={playerScope} onPlayer={onPlayer} />
        </div>
      </article>
      <article className="dashboard-card overview-metrics-card">
        <SimpleCardHead title="Wertungen" action={<div className="metric-tabs overview-tabs metric-overflow" aria-label="Wertung">
          {metrics.map((item) => <button key={item.id} className={metric === item.id ? "active" : ""} onClick={() => setMetric(item.id)}>{item.label}</button>)}
        </div>} />
        <div className="overview-tab-panel">
          <OverviewPlayerTable players={activeMetric.players} metric={activeMetric.id} scope={playerScope} onPlayer={onPlayer} />
        </div>
      </article>
      <OverviewBestEleven league={eleven.league} season={eleven.season} round={eleven.round} scope={matchdayOnly ? "matchday" : "season"} onPlayer={onPlayer} />
    </section>
  );
}

function OverviewBestEleven({ league, season, round, scope, onPlayer }: { league: string; season: string; round: number; scope: "season" | "matchday"; onPlayer: (id: string) => void }) {
  const [eleven, setEleven] = useState<BestEleven | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setError(null);
    api.bestEleven(new URLSearchParams({ league, season, round: String(round), scope }), controller.signal)
      .then(setEleven)
      .catch((reason: Error) => { if (!isAbort(reason)) { setEleven(null); setError(reason.message); } });
    return () => controller.abort();
  }, [league, season, round, scope]);

  const grouped = eleven ? groupBestEleven(eleven.players) : null;
  return (
    <article className="dashboard-card overview-eleven-card">
      <SimpleCardHead title={scope === "season" ? `Beste Elf · bis Spieltag ${round}` : `Beste Elf · Spieltag ${round}`} />
      {error ? <Empty message={error} /> : !eleven || !grouped ? <LoadingState /> : <>
        <p className="overview-eleven-summary"><strong>{eleven.points}</strong> Punkte · Formation {eleven.formation} · {scope === "season" ? "beste Elf der Saison" : `beste Elf von Spieltag ${round}`}</p>
        <div className="best-pitch compact-pitch">
          {(["FWD", "MID", "DEF", "GK"] as Position[]).map((position) => <div className="best-row" key={position}>
            {grouped[position].map((player) => <BestPlayerCard key={player.id} player={player} onClick={() => onPlayer(player.id)} />)}
          </div>)}
        </div>
      </>}
    </article>
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
        <section className="info-card info-card-wide"><h2>Ein Überblick, der Details nicht versteckt</h2><p>Ranglisten führen direkt zu Spieler- und Mannschaftsprofilen. Saison- und Spieltagsfilter machen Entwicklungen sichtbar; die Tabelle zeigt Platzierungsverlauf, Formkurve und Kreuztabelle jeder Liga, auch für vergangene Saisons. Die Fantasy-Ansicht ergänzt datenbasierte Beispielkader für kicker Manager Interactive und Classic.</p></section>
        <section className="info-card"><h2>Drei Ligen, mehrere Saisons</h2><p>Bundesliga, 2. Bundesliga und 3. Liga verwenden dieselben Tabellen und Metriken. So lassen sich Positionen, Vereine und Spieltage konsistent vergleichen.</p></section>
        <section className="info-card"><h2>Unabhängig und transparent</h2><p>Punktespiegel ist ein unabhängiges Analyseprojekt und nicht mit kicker verbunden. Quellen, Modellgrenzen und Aktualisierungswege werden offen beschrieben.</p></section>
      </div>
      <nav className="info-actions" aria-label="Punktespiegel entdecken">{link("players", "Spielerdaten durchsuchen →")}{link("table", "Tabelle öffnen →")}{link("manager", "Fantasy-Teams ansehen →")}</nav>
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
    { view: "table", label: "Tabelle" },
    { view: "players", label: "Spieler" },
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

function OverviewPlayerTable({ players, metric, scope = "season", onPlayer }: { players: Player[]; metric: RankingMetric; scope?: "season" | "matchday"; onPlayer: (id: string) => void }) {
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
    { id: "team", label: "Team", width: "28%", render: (player) => <span className="overview-table-text" title={player.team}>{player.team}</span> },
    { id: "position", label: "Position", shortLabel: "Pos.", width: "17%", render: (player) => <span className="overview-table-text" title={positionName[player.position]}>{positionName[player.position]}</span> },
    {
      id: "value",
      label: playerRankingColumnLabel(metric),
      shortLabel: metric === "points" ? "Pkt." : undefined,
      numeric: true,
      className: "point-value",
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

type LeagueZone = { from: number; to: number; tone: "up" | "up-soft" | "down-soft" | "down"; label: string };

const leagueZones: Record<string, LeagueZone[]> = {
  "0001": [
    { from: 1, to: 4, tone: "up", label: "Champions League (1–4)" },
    { from: 5, to: 6, tone: "up-soft", label: "Europapokal (5–6)" },
    { from: 16, to: 16, tone: "down-soft", label: "Relegation (16)" },
    { from: 17, to: 18, tone: "down", label: "Abstieg (17–18)" },
  ],
  "0002": [
    { from: 1, to: 2, tone: "up", label: "Aufstieg (1–2)" },
    { from: 3, to: 3, tone: "up-soft", label: "Aufstiegsrelegation (3)" },
    { from: 16, to: 16, tone: "down-soft", label: "Abstiegsrelegation (16)" },
    { from: 17, to: 18, tone: "down", label: "Abstieg (17–18)" },
  ],
  "0003": [
    { from: 1, to: 2, tone: "up", label: "Aufstieg (1–2)" },
    { from: 3, to: 3, tone: "up-soft", label: "Aufstiegsrelegation (3)" },
    { from: 17, to: 20, tone: "down", label: "Abstieg (17–20)" },
  ],
};

function zoneForRank(league: string, rank: number) {
  return (leagueZones[league] ?? []).find((zone) => rank >= zone.from && rank <= zone.to) ?? null;
}

function TabelleView({ filters, leagues, seasons, onFilter, onTeam, onPlayer }: { filters: Filters; leagues: Catalog["leagues"]; seasons: Catalog["seasons"]; onFilter: (key: keyof Filters, value: string) => void; onTeam: (id: string) => void; onPlayer: (id: string) => void }) {
  const selectedSeason = seasons.find((season) => String(season.startYear) === filters.season);
  const maximumRound = Math.max(1, selectedSeason?.latestRound ?? 0);
  const round = Math.min(maximumRound, Math.max(1, Number(filters.round) || 1));
  const [standings, setStandings] = useState<LeagueStandings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    api.standings(new URLSearchParams({ league: filters.league, season: filters.season, round: String(round) }), controller.signal)
      .then(setStandings)
      .catch((reason: Error) => { if (!isAbort(reason)) { setStandings(null); setError(reason.message); } })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [filters.league, filters.season, round]);

  return (
    <div className="tabelle-view">
      <PageHeader title="Tabelle" description={`${selectedSeason?.displayName ?? "Gewählte Saison"} · Stand nach Spieltag ${round}`} controls={<div className="selectors">
        <StepperSelect label="Liga" value={filters.league} options={leagues.map((league) => ({ value: league.code, label: league.name }))} onChange={(value) => onFilter("league", value)} />
        <StepperSelect label="Saison" value={filters.season} options={[...seasons].reverse().map((season) => ({ value: String(season.startYear), label: season.displayName }))} onChange={(value) => onFilter("season", value)} />
        <StepperSelect label="Spieltag" value={String(round)} options={Array.from({ length: maximumRound }, (_, index) => ({ value: String(index + 1), label: `Spieltag ${index + 1}` }))} onChange={(value) => onFilter("round", value)} />
      </div>} />
      {error ? <ErrorState message={error} />
        : loading || !standings ? <LoadingState />
          : standings.context.playedMatchCount < 1 ? <section className="detail-section"><Empty message="Für diese Auswahl liegen noch keine gespielten Partien vor." /></section>
            : <>
              <MatchdayFixturesCard standings={standings} onTeam={onTeam} onPlayer={onPlayer} />
              <FormTableCard standings={standings} league={filters.league} onTeam={onTeam} />
              <BumpChartCard standings={standings} zones={leagueZones[filters.league] ?? []} />
              <CrossTableCard standings={standings} onTeam={onTeam} />
            </>}
    </div>
  );
}

function MatchdayFixturesCard({ standings, onTeam, onPlayer }: { standings: LeagueStandings; onTeam: (id: string) => void; onPlayer: (id: string) => void }) {
  if (!standings.fixtures.length) return null;
  const groups: { slot: string | null; fixtures: MatchdayFixture[] }[] = [];
  for (const fixture of standings.fixtures) {
    const last = groups[groups.length - 1];
    if (last && last.slot === fixture.scheduledAt) last.fixtures.push(fixture);
    else groups.push({ slot: fixture.scheduledAt, fixtures: [fixture] });
  }
  return (
    <section className="tabelle-block">
      <div className="section-copy"><p className="kicker">Spieltag {standings.context.round}</p><h2>Spiele des Spieltags</h2></div>
      <div className="detail-section fixtures-card">
        {groups.map((group) => (
          <div className="fixture-slot" key={group.slot ?? "offen"}>
            <h4>{formatFixtureSlot(group.slot)}</h4>
            {group.fixtures.map((fixture) => <TabelleFixture key={fixture.id} fixture={fixture} onTeam={onTeam} onPlayer={onPlayer} />)}
          </div>
        ))}
      </div>
    </section>
  );
}

function TabelleFixture({ fixture, onTeam, onPlayer }: { fixture: MatchdayFixture; onTeam: (id: string) => void; onPlayer: (id: string) => void }) {
  const played = fixture.homeScore != null && fixture.awayScore != null;
  const contributorCount = fixture.home.goals.length + fixture.home.assists.length + fixture.away.goals.length + fixture.away.assists.length;
  const teamButton = (side: MatchdayFixtureSide, align: "home" | "away") => (
    <span className={`fixture-team ${align}`}>
      {align === "away" && <TeamLogo code={side.team.code} url={side.team.logoUrl} />}
      <button onClick={(event) => { event.preventDefault(); event.stopPropagation(); onTeam(side.team.id); }} title={`${side.team.name}: Mannschaftsprofil öffnen`}>
        <span className="player-name-full">{side.team.name}</span><span className="player-name-short">{side.team.code}</span>
      </button>
      {align === "home" && <TeamLogo code={side.team.code} url={side.team.logoUrl} />}
    </span>
  );
  const head = <>
    {teamButton(fixture.home, "home")}
    <span className={`fixture-score ${played ? "" : "fixture-score-open"}`}>{played ? `${fixture.homeScore} : ${fixture.awayScore}` : "– : –"}</span>
    {teamButton(fixture.away, "away")}
  </>;
  if (!played || contributorCount === 0) {
    return <div className="fixture-card fixture-card-flat">{head}<span className="fixture-toggle" aria-hidden="true" /></div>;
  }
  return (
    <details className="fixture-card">
      <summary>{head}<span className="fixture-toggle" aria-hidden="true">⌄</span></summary>
      <div className="fixture-detail">
        <FixtureSideDetail side={fixture.home} align="home" onPlayer={onPlayer} />
        <FixtureSideDetail side={fixture.away} align="away" onPlayer={onPlayer} />
      </div>
    </details>
  );
}

function FixtureSideDetail({ side, align, onPlayer }: { side: MatchdayFixtureSide; align: "home" | "away"; onPlayer: (id: string) => void }) {
  const list = (label: string, contributors: MatchdayContributor[]) => contributors.length > 0 && (
    <p><span className="fixture-detail-label">{label}</span>{contributors.map((contributor, index) => <span key={contributor.id}>{index > 0 && ", "}<button onClick={() => onPlayer(contributor.id)}>{contributor.name}{contributor.count > 1 ? ` (${contributor.count})` : ""}</button></span>)}</p>
  );
  const empty = !side.goals.length && !side.assists.length;
  return (
    <div className={`fixture-side ${align}`}>
      {list("Tore", side.goals)}
      {list("Vorlagen", side.assists)}
      {empty && <p className="fixture-detail-none">–</p>}
    </div>
  );
}

function defaultBumpSelection(standings: LeagueStandings) {
  const leader = standings.rows[0];
  if (!leader) return [];
  const climber = standings.rows.reduce((best, row) => ((row.trend ?? -Infinity) > (best.trend ?? -Infinity) ? row : best), leader);
  return climber.team.id !== leader.team.id && (climber.trend ?? 0) > 0
    ? [leader.team.id, climber.team.id]
    : [leader.team.id];
}

function BumpChartCard({ standings, zones }: { standings: LeagueStandings; zones: LeagueZone[] }) {
  const rounds = standings.context.round;
  const teamCount = standings.rows.length;
  const [pinned, setPinned] = useState<string[]>(() => defaultBumpSelection(standings));
  const [hovered, setHovered] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const seasonKey = `${standings.context.league}:${standings.context.season}`;

  useEffect(() => {
    setPinned(defaultBumpSelection(standings));
  }, [seasonKey]);

  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollLeft = node.scrollWidth;
  }, [seasonKey]);

  function toggleTeam(teamId: string) {
    setPinned((current) => current.includes(teamId)
      ? current.filter((id) => id !== teamId)
      : [...current.slice(current.length >= 3 ? current.length - 2 : 0), teamId]);
  }

  const columnWidth = Math.max(24, Math.min(72, Math.floor(1010 / Math.max(1, rounds - 1))));
  const rowHeight = 27;
  const leftPad = 30;
  const labelGutter = 170;
  const topPad = 14;
  const bottomPad = 30;
  const width = leftPad + Math.max(1, rounds - 1) * columnWidth + labelGutter;
  const height = topPad + (teamCount - 1) * rowHeight + bottomPad;
  const x = (matchday: number) => leftPad + (matchday - 1) * columnWidth;
  const y = (rank: number) => topPad + (rank - 1) * rowHeight;
  const tickStep = columnWidth >= 34 ? 1 : columnWidth >= 28 ? 2 : 5;

  const emphasisClass = (teamId: string) => {
    const pinIndex = pinned.indexOf(teamId);
    return `${pinIndex >= 0 ? ` is-pinned pin-${pinIndex}` : ""}${hovered === teamId ? " is-hovered" : ""}`;
  };
  const paintOrder = [...standings.rows].sort((left, right) => {
    const weight = (row: LeagueTableRow) => (pinned.includes(row.team.id) ? 2 : 0) + (hovered === row.team.id ? 3 : 0);
    return weight(left) - weight(right);
  });
  const emphasized = standings.rows.filter((row) => pinned.includes(row.team.id) || hovered === row.team.id);

  return (
    <section className="detail-section bump-card">
      <CardHead eyebrow="Saisonverlauf" title="Platzierung je Spieltag" subtitle="Der Weg jedes Teams durch die Tabelle · antippen hebt bis zu drei Teams hervor" action={zones.length ? <div className="bump-legend" aria-hidden="true">{zones.map((zone) => <span key={zone.label}><i className={`bump-legend-swatch bump-zone-${zone.tone}`} />{zone.label}</span>)}</div> : undefined} />
      <div className="bump-scroll" ref={scrollRef}>
        <svg className="bump-chart" width={width} height={height} role="img" aria-label={`Platzierungsverlauf über ${rounds} Spieltage`}>
          {zones.filter((zone) => zone.from <= teamCount).map((zone) => (
            <rect key={zone.label} className={`bump-zone bump-zone-${zone.tone}`} x="0" y={y(zone.from) - rowHeight / 2 + 2} width={width - labelGutter + 62} height={(Math.min(zone.to, teamCount) - zone.from + 1) * rowHeight - 4} rx="6" />
          ))}
          {Array.from({ length: rounds }, (_, index) => index + 1).map((matchday) => (
            <g key={matchday}>
              <line className="bump-grid" x1={x(matchday)} y1={topPad - 6} x2={x(matchday)} y2={height - bottomPad + 8} />
              {(matchday % tickStep === 0 || matchday === 1 || matchday === rounds) && <text className="bump-tick" x={x(matchday)} y={height - 8} textAnchor="middle">{matchday}</text>}
            </g>
          ))}
          {paintOrder.map((row) => rounds === 1
            ? <circle key={row.team.id} className={`bump-line${emphasisClass(row.team.id)}`} cx={x(1)} cy={y(row.positions[0] ?? row.rank)} r="3.4" onMouseEnter={() => setHovered(row.team.id)} onMouseLeave={() => setHovered(null)} onClick={() => toggleTeam(row.team.id)} />
            : <polyline
                key={row.team.id}
                className={`bump-line${emphasisClass(row.team.id)}`}
                points={row.positions.map((rank, index) => `${x(index + 1)},${y(rank)}`).join(" ")}
                onMouseEnter={() => setHovered(row.team.id)}
                onMouseLeave={() => setHovered(null)}
                onClick={() => toggleTeam(row.team.id)}
              ><title>{row.team.name}</title></polyline>)}
          {emphasized.map((row) => row.positions.map((rank, index) => (
            <circle key={`${row.team.id}-${index}`} className={`bump-dot${emphasisClass(row.team.id)}`} cx={x(index + 1)} cy={y(rank)} r="3">
              <title>{`${row.team.name} · Spieltag ${index + 1}: Platz ${rank}`}</title>
            </circle>
          )))}
          {standings.rows.map((row) => (
            <g key={row.team.id} className={`bump-label${emphasisClass(row.team.id)}`} transform={`translate(${x(rounds) + 12}, ${y(row.rank)})`} onMouseEnter={() => setHovered(row.team.id)} onMouseLeave={() => setHovered(null)} onClick={() => toggleTeam(row.team.id)}>
              <rect className="bump-label-hit" x="-4" y={-rowHeight / 2} width={labelGutter - 10} height={rowHeight} fill="transparent" stroke="none" />
              <text className="bump-rank" x="0" y="3.5">{String(row.rank).padStart(2, "0")}</text>
              {row.team.logoUrl && <image href={row.team.logoUrl} x="22" y="-9" width="18" height="18" />}
              <text className="bump-code" x="46" y="3.5">{row.team.code}</text>
              <title>{row.team.name}</title>
            </g>
          ))}
          <text className="bump-tick bump-axis" x="4" y={height - 8} textAnchor="start">ST</text>
        </svg>
      </div>
    </section>
  );
}

type FormTableSort = "rank" | "form" | "difference";

function FormTableCard({ standings, league, onTeam }: { standings: LeagueStandings; league: string; onTeam: (id: string) => void }) {
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
    { id: "trend", label: "Trend", shortLabel: "±", render: (row) => <TrendBadge trend={row.trend} /> },
    { id: "team", label: "Verein", width: "24%", render: (row) => <div className="table-team tabelle-team"><TeamLogo code={row.team.code} url={row.team.logoUrl} /><span><strong><span className="player-name-full">{row.team.name}</span><span className="player-name-short">{row.team.code}</span></strong></span></div> },
    { id: "played", label: "Spiele", shortLabel: "Sp", numeric: true, render: (row) => row.played },
    { id: "wins", label: "S", numeric: true, render: (row) => row.wins },
    { id: "draws", label: "U", numeric: true, render: (row) => row.draws },
    { id: "losses", label: "N", numeric: true, render: (row) => row.losses },
    { id: "goals", label: "Tore", numeric: true, render: (row) => `${row.goalsFor}:${row.goalsAgainst}` },
    { id: "difference", label: "Tordifferenz", shortLabel: "TD", numeric: true, sort: sortProps("difference"), render: (row) => row.goalDifference > 0 ? `+${row.goalDifference}` : row.goalDifference },
    { id: "points", label: "Punkte", shortLabel: "Pkt", numeric: true, className: "primary-num", render: (row) => row.points },
    { id: "form", label: "Letzte 5", shortLabel: "Form", sort: sortProps("form"), render: (row) => <span className="form-cell"><FormChips form={row.form} /><small>{row.formPoints}/{row.form.length * 3}</small></span> },
    { id: "course", label: "Verlauf", render: (row) => <RankSparkline positions={row.positions} teamCount={standings.rows.length} /> },
  ];

  return (
    <section className="tabelle-block">
      <div className="section-copy"><p className="kicker">Stand nach Spieltag {standings.context.round}</p><h2>Formtabelle</h2></div>
      <DataTable
        ariaLabel={`Tabelle der ${standings.context.leagueName}`}
        rows={rows}
        columns={columns}
        getRowKey={(row) => row.team.id}
        emptyMessage="Für diese Auswahl liegen keine Tabellendaten vor."
        minWidth="1080px"
        mobileMinWidth="640px"
        onRowClick={(row) => onTeam(row.team.id)}
      />
    </section>
  );
}

function TrendBadge({ trend }: { trend: number | null }) {
  const title = trend == null ? "Noch kein Vergleich möglich" : "Plätze gewonnen oder verloren gegenüber dem Stand vor fünf Spieltagen";
  if (trend == null) return <span className="trend-badge trend-flat" title={title}>–</span>;
  if (trend > 0) return <span className="trend-badge trend-up" title={title}>▲{trend}</span>;
  if (trend < 0) return <span className="trend-badge trend-down" title={title}>▼{Math.abs(trend)}</span>;
  return <span className="trend-badge trend-flat" title={title}>＝</span>;
}

function FormChips({ form }: { form: LeagueTableFormEntry[] }) {
  if (!form.length) return <span className="form-chips-empty">—</span>;
  return <span className="form-chips">{form.map((entry) => (
    <i key={entry.round} className={`form-chip form-chip-${entry.outcome.toLowerCase()}`} title={`Spieltag ${entry.round} · ${entry.home ? "gegen" : "bei"} ${entry.opponent.name} · ${entry.score}`}>{entry.outcome}</i>
  ))}</span>;
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

function CrossTableCard({ standings, onTeam }: { standings: LeagueStandings; onTeam: (id: string) => void }) {
  const teams = standings.rows.map((row) => row.team);
  const nameById = new Map(teams.map((team) => [team.id, team.name]));
  return (
    <section className="tabelle-block">
      <div className="section-copy cross-copy">
        <div><p className="kicker">Direktvergleich</p><h2>Kreuztabelle</h2></div>
        <div className="cross-legend"><span><i className="cross-swatch cross-cell-s" />Heimsieg</span><span><i className="cross-swatch cross-cell-u" />Unentschieden</span><span><i className="cross-swatch cross-cell-n" />Auswärtssieg</span></div>
      </div>
      <div className="detail-section cross-card">
        <div className="cross-scroll">
          <table className="cross-table">
            <thead>
              <tr>
                <th className="cross-corner">Heim \ Ausw.</th>
                {teams.map((team) => <th key={team.id} title={team.name}><TeamLogo code={team.code} url={team.logoUrl} /></th>)}
              </tr>
            </thead>
            <tbody>
              {teams.map((home) => (
                <tr key={home.id}>
                  <th scope="row"><button className="cross-row-head" onClick={() => onTeam(home.id)} title={`${home.name}: Mannschaftsprofil öffnen`}><TeamLogo code={home.code} url={home.logoUrl} /><span>{home.code}</span></button></th>
                  {teams.map((away) => {
                    if (home.id === away.id) return <td key={away.id} className="cross-self" />;
                    const cell = standings.cross.cells[`${home.id}|${away.id}`];
                    if (!cell || cell.homeScore == null || cell.awayScore == null) {
                      const planned = cell ? `${home.name} – ${nameById.get(away.id)} · Spieltag ${cell.round}${cell.scheduledAt ? ` · ${formatDateWithYear(cell.scheduledAt)}` : ""}` : `${home.name} – ${nameById.get(away.id)}`;
                      return <td key={away.id} className="cross-open" title={planned}>–</td>;
                    }
                    const outcome = cell.homeScore > cell.awayScore ? "s" : cell.homeScore < cell.awayScore ? "n" : "u";
                    return <td key={away.id} className={`cross-cell-${outcome}`} title={`${home.name} ${cell.homeScore}:${cell.awayScore} ${nameById.get(away.id)} · Spieltag ${cell.round}`}>{cell.homeScore}:{cell.awayScore}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function PlayersView({ filters, onPlayer }: { filters: Filters; onPlayer: (id: string) => void }) {
  const [query, setQuery] = useState("");
  const [position, setPosition] = useState("");
  const [team, setTeam] = useState("");
  const [scope, setScope] = useState<PlayerScope>("season");
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
      setDirection(column === "name" || column === "position" || column === "grade" || column === "roundGrade" ? "asc" : "desc");
    }
  }

  function switchScope(next: PlayerScope) {
    if (next === scope) return;
    setScope(next);
    const mapping: Partial<Record<PlayerSort, PlayerSort>> = next === "round"
      ? { points: "round", grade: "roundGrade", goals: "roundGoals", assists: "roundAssists", value: "round" }
      : { round: "points", roundGrade: "grade", roundGoals: "goals", roundAssists: "assists" };
    const mapped = mapping[sort];
    if (mapped) {
      setSort(mapped);
      setDirection(mapped === "grade" || mapped === "roundGrade" ? "asc" : "desc");
    }
  }

  const teamOptions = useMemo(() => [...new Set(players.map((player) => player.team))].sort((left, right) => left.localeCompare(right, "de")), [players]);
  const visiblePlayers = (team ? players.filter((player) => player.team === team) : players)
    .filter((player) => scope === "season"
      || player.roundGrade != null
      || player.roundPoints !== 0
      || player.roundGoals > 0
      || player.roundAssists > 0
      || player.roundStarterPoints > 0);
  const sortProps = (column: PlayerSort) => ({ active: sort === column, direction, onSort: () => sortBy(column) });
  const identityColumns: DataTableColumn<Player>[] = [
    { id: "player", label: "Spieler", width: "29%", sort: sortProps("name"), render: (player, index) => <div className="table-player"><span className="rank">{index + 1}</span><PlayerPortrait name={player.name} url={player.photoUrl} teamCode={player.teamCode} teamLogoUrl={player.logoUrl} /><span><PlayerName name={player.name} /><small>{player.team}</small></span></div> },
    { id: "position", label: "Position", shortLabel: "Pos.", sort: sortProps("position"), render: (player) => <PositionTag position={player.position} /> },
    { id: "price", label: "Marktwert", shortLabel: "Wert", numeric: true, sort: sortProps("price"), render: (player) => formatMarketValue(player.priceM) },
  ];
  const columns: DataTableColumn<Player>[] = scope === "round" ? [
    ...identityColumns,
    { id: "round", label: `Punkte · Spieltag ${filters.round}`, shortLabel: "Punkte", numeric: true, className: "primary-num", sort: sortProps("round"), render: (player) => player.roundPoints },
    { id: "roundGrade", label: "Note", numeric: true, sort: sortProps("roundGrade"), render: (player) => player.roundGrade?.toFixed(2) ?? "—" },
    { id: "roundGoals", label: "Tore", numeric: true, sort: sortProps("roundGoals"), render: (player) => player.roundGoals },
    { id: "roundAssists", label: "Vorlagen", shortLabel: "Vorl.", numeric: true, sort: sortProps("roundAssists"), render: (player) => player.roundAssists },
  ] : [
    ...identityColumns,
    { id: "round", label: `Spieltag ${filters.round}`, shortLabel: `ST ${filters.round}`, numeric: true, className: "matchday-score", sort: sortProps("round"), render: (player) => player.roundPoints },
    { id: "points", label: `Gesamt bis Spieltag ${filters.round}`, shortLabel: "Gesamt", numeric: true, className: "primary-num", sort: sortProps("points"), render: (player) => player.observedPoints },
    { id: "goals", label: "Tore", numeric: true, sort: sortProps("goals"), render: (player) => player.goals },
    { id: "assists", label: "Vorlagen", shortLabel: "Vorl.", numeric: true, sort: sortProps("assists"), render: (player) => player.assists },
    { id: "grade", label: "Ø-Note", shortLabel: "Note", numeric: true, sort: sortProps("grade"), render: (player) => player.averageGrade?.toFixed(2) ?? "—" },
    { id: "value", label: "Wert · Pkt. / Mio. €", shortLabel: "Pkt./Mio.", numeric: true, sort: sortProps("value"), render: (player) => formatPlayerValue(player.value) },
  ];

  return (
    <section className="data-page-section">
      {error ? <ErrorState message={error} /> : <DataTable
        ariaLabel="Spielerwertung"
        rows={visiblePlayers}
        columns={columns}
        getRowKey={(player) => player.id}
        leading={<div className="scope-switch acorn-segmented-control players-scope-switch" aria-label="Zeitraum">
          <button className={`acorn-segment ${scope === "season" ? "active is-selected" : ""}`} onClick={() => switchScope("season")}>Bis Spieltag {filters.round}</button>
          <button className={`acorn-segment ${scope === "round" ? "active is-selected" : ""}`} onClick={() => switchScope("round")}>Nur Spieltag {filters.round}</button>
        </div>}
        search={{ value: query, onChange: setQuery, placeholder: "Spieler oder Mannschaft" }}
        filters={[
          { id: "position", label: "Position", value: position, onChange: setPosition, options: [{ value: "", label: "Alle Positionen" }, ...(["GK", "DEF", "MID", "FWD"] as Position[]).map((item) => ({ value: item, label: positionName[item] }))] },
          { id: "team", label: "Mannschaft", value: team, onChange: setTeam, options: [{ value: "", label: "Alle Mannschaften" }, ...teamOptions.map((item) => ({ value: item, label: item }))] },
        ]}
        countLabel={`${visiblePlayers.length} Spieler`}
        emptyMessage={scope === "round" ? "Für diesen Spieltag liegen keine Wertungen vor." : "Keine Spieler entsprechen diesen Filtern."}
        loading={loading}
        minWidth={scope === "round" ? "880px" : "1120px"}
        mobileMinWidth={scope === "round" ? "560px" : "700px"}
        variant="compact"
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
      <PlayerNewsSection news={detail.news} kickerNewsUrl={detail.kickerNewsUrl} kickerNewsDirect={detail.kickerNewsDirect} />
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

function PlayerNewsSection({ news, kickerNewsUrl, kickerNewsDirect }: {
  news: PlayerDetail["news"];
  kickerNewsUrl: string;
  kickerNewsDirect: boolean;
}) {
  const visibleArticles = [...news.articles, ...news.clubArticles]
    .sort((left, right) => Date.parse(right.publishedAt) - Date.parse(left.publishedAt));
  const emptyMessage = news.status === "failed"
    ? `Der automatische Nachrichtenimport konnte nicht geladen werden. ${kickerNewsDirect ? "Das kicker-Spielerarchiv ist über den Link oben weiterhin direkt erreichbar." : "Über den Link oben kann gezielt nach der kicker-Spielerseite gesucht werden."}`
    : news.status === "stale"
      ? `Im letzten verfügbaren, derzeit veralteten Datenstand gibt es keine passende Meldung. ${kickerNewsDirect ? "Das kicker-Spielerarchiv ist über den Link oben erreichbar." : "Über den Link oben kann gezielt bei kicker gesucht werden."}`
      : `Der Nachrichtenfeed wurde erfolgreich geprüft, enthält aber aktuell keinen sicheren Spielerbezug. ${kickerNewsDirect ? "Das kicker-Spielerarchiv ist über den Link oben erreichbar." : "Über den Link oben kann gezielt bei kicker gesucht werden."}`;
  return (
    <section className="player-news" aria-labelledby="player-news-title">
      <div className="section-copy news-heading">
        <div><p className="kicker">Medienbeobachtung</p><h3 id="player-news-title">In den Nachrichten</h3></div>
        <div className="news-actions">
          {news.generatedAt && <span>Stand {formatNewsDate(news.generatedAt)}</span>}
          <a href={kickerNewsUrl} target="_blank" rel="noreferrer">{kickerNewsDirect ? "Alle kicker-Spieler-News" : "Spieler-News bei kicker suchen"} ↗</a>
        </div>
      </div>
      <NewsHealthNotice status={news.status} feedSummary={news.feedSummary} />
      <ClubFeedStatusNotice status={news.clubFeedStatus} />
      {visibleArticles.length
        ? <NewsList articles={visibleArticles} />
        : <p className={`news-empty news-empty--${news.status}`}>{emptyMessage}</p>}
    </section>
  );
}

function NewsHealthNotice({ status, feedSummary, includeUnmapped = false }: Pick<PlayerDetail["news"], "status" | "feedSummary"> & { includeUnmapped?: boolean }) {
  if (status === "healthy" && feedSummary.error === 0 && (!includeUnmapped || feedSummary.unmapped === 0)) return null;
  const issues = [
    feedSummary.error > 0 ? `${feedSummary.error} Quelle${feedSummary.error === 1 ? "" : "n"} nicht erreichbar` : "",
    includeUnmapped && feedSummary.unmapped > 0 ? `${feedSummary.unmapped} Feed${feedSummary.unmapped === 1 ? "" : "s"} keinem Verein zugeordnet` : "",
  ].filter(Boolean).join("; ");
  const message = status === "failed"
    ? `Beim letzten Lauf war keine nutzbare Nachrichtenquelle verfügbar${issues ? `: ${issues}` : ""}.`
    : status === "stale"
      ? `Der Nachrichtenstand ist älter als 36 Stunden${issues ? `; zusätzlich: ${issues}` : ""}.`
      : `Der Datenstand ist aktuell, jedoch sind einzelne Quellen eingeschränkt: ${issues}.`;
  return <p className={`news-health news-health--${status}`} role={status === "failed" ? "alert" : "status"}>{message}</p>;
}

function ClubFeedStatusNotice({ status }: { status: PlayerDetail["news"]["clubFeedStatus"] }) {
  if (status === "ok" || status === "unknown") return null;
  const label = status === "error" ? "Abruffehler" : "Nicht verfügbar";
  const message = status === "error"
    ? "Der Vereinsfeed konnte beim letzten Lauf nicht gelesen werden; es wird kein neuer Vereinskontext ergänzt."
    : "Für diesen Verein ist derzeit kein Vereinsfeed im kicker-Feedkatalog vorhanden.";
  return <p className={`club-feed-status club-feed-status--${status}`}><strong>Vereinsfeed: {label}.</strong> {message}</p>;
}

function NewsList<Article extends NewsArticle>({ articles, context }: {
  articles: Article[];
  context?: (article: Article) => string;
}) {
  return (
    <ol className="news-list news-list--scroll">
      {articles.map((article) => {
        const articleRelation = article.relation ?? "automatic";
        const relationLabel = articleRelation === "team" ? "Vereinsumfeld" : articleRelation === "player" ? "Spielerbezug" : "Automatisch zugeordnet";
        const sourceLabel = newsSourceLabel(article);
        return (
          <li key={article.url}>
            <a href={article.url} target="_blank" rel="noreferrer">
              <span className="news-meta">
                <time dateTime={article.publishedAt}>{formatNewsDate(article.publishedAt)}</time>
                {sourceLabel && <b>{sourceLabel}</b>}
                <em className={`news-relation ${articleRelation}`} title={article.matchedAlias ? `Erkannter Name: ${article.matchedAlias}` : undefined}>{relationLabel}</em>
              </span>
              <span className="news-article-copy"><strong>{article.title}</strong>{context && <small>{context(article)}</small>}</span>
              <small className="news-attribution">{newsAttribution(article)} ↗</small>
            </a>
          </li>
        );
      })}
    </ol>
  );
}

function ManagerPicksView({ filters, section, selectedMatchday, onSection, onMatchday, onPlayer }: {
  filters: Filters;
  section: ManagerSection;
  selectedMatchday: number | null;
  onSection: (section: ManagerSection) => void;
  onMatchday: (matchday: number) => void;
  onPlayer: (id: string) => void;
}) {
  const [mode, setMode] = useState<ManagerMode>("classic");
  const [recommendation, setRecommendation] = useState<ManagerRecommendation | null>(null);
  const [schedule, setSchedule] = useState<ManagerScheduleRound[]>([]);
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [squadNews, setSquadNews] = useState<SquadNews | null>(null);
  const [squadNewsLoading, setSquadNewsLoading] = useState(false);
  const [squadNewsError, setSquadNewsError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setLoading(true);
    setError(null);
    setSchedule([]);
    setScheduleLoading(false);
    setScheduleError(null);
    setSquadNews(null);
    setSquadNewsLoading(false);
    setSquadNewsError(null);
    void (async () => {
      try {
        const nextRecommendation = await api.managerPicks(scopeQuery(filters, false), mode, controller.signal);
        if (!active) return;
        setRecommendation(nextRecommendation);
        setLoading(false);
        setScheduleLoading(true);
        void api.managerSchedule(scopeQuery(filters, false), nextRecommendation.players, controller.signal)
          .then((nextSchedule) => {
            if (!active) return;
            setSchedule(nextSchedule);
          })
          .catch((reason: Error) => {
            if (active && !isAbort(reason)) setScheduleError(reason.message);
          })
          .finally(() => { if (active) setScheduleLoading(false); });
        setSquadNewsLoading(true);
        try {
          const news = await api.managerNews(nextRecommendation.players, controller.signal);
          if (active) setSquadNews(news);
        } catch (reason) {
          if (active && !isAbort(reason)) setSquadNewsError(reason instanceof Error ? reason.message : "Kadernachrichten konnten nicht geladen werden.");
        } finally {
          if (active) setSquadNewsLoading(false);
        }
      } catch (reason) {
        if (active && !isAbort(reason)) setError(reason instanceof Error ? reason.message : "Kaderempfehlung konnte nicht geladen werden.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
      controller.abort();
    };
  }, [filters.league, filters.season, mode]);

  useEffect(() => {
    if (!schedule.length || (selectedMatchday !== null && schedule.some((round) => round.matchday === selectedMatchday))) return;
    const nextMatchday = (recommendation?.currentSeasonEvidence?.throughMatchday ?? 0) + 1;
    const availableMatchday = schedule.find((round) => round.matchday >= nextMatchday)?.matchday ?? schedule.at(-1)!.matchday;
    onMatchday(availableMatchday);
  }, [recommendation?.currentSeasonEvidence?.throughMatchday, schedule, selectedMatchday]);

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
      <div className="scope-switch manager-section-tabs" aria-label="Fantasy-Team-Ansicht">
        <button className={section === "overview" ? "active" : ""} aria-pressed={section === "overview"} onClick={() => onSection("overview")}>Übersicht</button>
        <button className={section === "matchdays" ? "active" : ""} aria-pressed={section === "matchdays"} onClick={() => onSection("matchdays")}>Spieltage</button>
      </div>
      {loading || !recommendation ? <LoadingState /> : (
        <>
          {section === "overview" ? <>
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
            {squadNews
              ? <SquadNewsSection news={squadNews} />
              : squadNewsLoading
                ? <SquadNewsLoadingSection />
                : squadNewsError && <SquadNewsErrorSection message={squadNewsError} />}
          </> : <ManagerScheduleView
            rounds={schedule}
            selectedMatchday={selectedMatchday}
            onMatchday={onMatchday}
            onPlayer={onPlayer}
            loading={scheduleLoading}
            error={scheduleError}
          />}
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

function SquadNewsLoadingSection() {
  return (
    <section className="detail-section manager-squad-news" aria-labelledby="manager-squad-news-loading-title" aria-busy="true">
      <div className="section-copy"><p className="kicker">Kaderbeobachtung</p><h3 id="manager-squad-news-loading-title">Neueste Entwicklungen im Kader</h3></div>
      <p className="news-empty">Kadernachrichten werden unabhängig von der bereits geladenen Empfehlung ergänzt …</p>
    </section>
  );
}

function SquadNewsErrorSection({ message }: { message: string }) {
  return (
    <section className="detail-section manager-squad-news" aria-labelledby="manager-squad-news-error-title">
      <div className="section-copy"><p className="kicker">Kaderbeobachtung</p><h3 id="manager-squad-news-error-title">Neueste Entwicklungen im Kader</h3></div>
      <p className="news-health news-health--failed" role="alert">Die optionale Nachrichtenansicht konnte nicht geladen werden: {message}</p>
    </section>
  );
}

function SquadNewsSection({ news }: { news: SquadNews }) {
  const emptyMessage = news.status === "failed"
    ? "Die Kadernachrichten konnten beim letzten Lauf nicht geladen werden."
    : news.status === "stale"
      ? "Der letzte verfügbare Nachrichtenstand ist veraltet und enthält keine Meldung zu diesem Kader."
      : "Die Quellen wurden erfolgreich geprüft; aktuell gibt es keine Meldung zu den ausgewählten Spielern oder ihren Vereinen.";
  const context = (article: SquadNewsArticle) => article.relatedPlayers.length
    ? `Spieler: ${article.relatedPlayers.join(", ")}`
    : `Verein: ${article.relatedTeams.join(", ")}`;
  return (
    <section className="detail-section manager-squad-news" aria-labelledby="manager-squad-news-title">
      <div className="section-copy news-heading">
        <div><p className="kicker">Kaderbeobachtung</p><h3 id="manager-squad-news-title">Neueste Entwicklungen im Kader</h3><p>Spielerzuordnungen und Meldungen aus dem Vereinsumfeld, URL-genau zusammengeführt.</p></div>
        <div className="news-actions">{news.generatedAt && <span>Stand {formatNewsDate(news.generatedAt)}</span>}</div>
      </div>
      <NewsHealthNotice status={news.status} feedSummary={news.feedSummary} includeUnmapped />
      {news.articles.length
        ? <NewsList articles={news.articles} context={context} />
        : <p className={`news-empty news-empty--${news.status}`}>{emptyMessage}</p>}
    </section>
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

function ManagerScheduleView({ rounds, selectedMatchday, onMatchday, onPlayer, loading, error }: {
  rounds: ManagerScheduleRound[];
  selectedMatchday: number | null;
  onMatchday: (matchday: number) => void;
  onPlayer: (id: string) => void;
  loading: boolean;
  error: string | null;
}) {
  if (loading && !rounds.length) return <LoadingState />;
  if (error) return <ErrorState message={error} />;
  const round = rounds.find((item) => item.matchday === selectedMatchday) ?? rounds[0];
  if (!round) return <section className="detail-section"><Empty message="Für diese Saison ist noch kein Spielplan verfügbar." /></section>;
  const slots = new Map<string, ManagerFixture[]>();
  for (const fixture of round.fixtures) {
    const slot = fixture.scheduledAt ?? "unknown";
    slots.set(slot, [...(slots.get(slot) ?? []), fixture]);
  }
  return (
    <section className="detail-section manager-fixtures" aria-labelledby="manager-fixtures-title">
      <header className="manager-fixtures-header">
        <div className="section-copy">
          <p className="kicker">Dein Kader im Spielplan</p>
          <h3 id="manager-fixtures-title">Spieltagswertung</h3>
          <p>Alle Partien und die zugehörigen Spieler deines Fantasy Teams. Bereits verfügbare Punkte stehen direkt am Spieler.</p>
        </div>
        <StepperSelect
          label="Spieltag"
          value={String(round.matchday)}
          options={rounds.map((item) => ({ value: String(item.matchday), label: `${item.matchday}. Spieltag` }))}
          onChange={(value) => onMatchday(Number(value))}
        />
      </header>
      <div className="manager-fixtures-round" aria-live="polite">
        <strong>{round.name}</strong>
        <span>{formatMatchdayRange(round.startAt, round.endAt)}</span>
        <em>{formatRoundPhase(round.phase)}</em>
      </div>
      <div className="manager-fixture-slots">
        {[...slots.entries()].map(([slot, fixtures]) => (
          <section className="manager-fixture-slot" key={slot}>
            <h4>{formatFixtureSlot(slot === "unknown" ? null : slot)}</h4>
            <div>{fixtures.map((fixture) => <ManagerFixtureCard key={fixture.id} fixture={fixture} onPlayer={onPlayer} />)}</div>
          </section>
        ))}
      </div>
    </section>
  );
}

function ManagerFixtureCard({ fixture, onPlayer }: { fixture: ManagerFixture; onPlayer: (id: string) => void }) {
  const result = fixture.homeScore == null || fixture.awayScore == null ? "– : –" : `${fixture.homeScore} : ${fixture.awayScore}`;
  return (
    <article className="manager-fixture-card">
      <div className="manager-fixture-matchup">
        <span className="manager-fixture-team home"><strong>{fixture.home.name}</strong><TeamLogo code={fixture.home.code} url={fixture.home.logoUrl} /></span>
        <span className={`manager-fixture-score ${fixture.state.toLocaleLowerCase()}`}>{result}</span>
        <span className="manager-fixture-team away"><TeamLogo code={fixture.away.code} url={fixture.away.logoUrl} /><strong>{fixture.away.name}</strong></span>
      </div>
      <div className="manager-fixture-squads">
        <FixturePlayers players={fixture.home.players} side="home" onPlayer={onPlayer} />
        <FixturePlayers players={fixture.away.players} side="away" onPlayer={onPlayer} />
      </div>
    </article>
  );
}

function FixturePlayers({ players, side, onPlayer }: {
  players: ManagerFixture["home"]["players"];
  side: "home" | "away";
  onPlayer: (id: string) => void;
}) {
  return (
    <ol className={`manager-fixture-players ${side}`} aria-label={`${side === "home" ? "Heimteam" : "Auswärtsteam"}: Spieler aus deinem Kader`}>
      {players.map((player) => (
        <li key={player.id}>
          <button className={player.role === "reserve" ? "reserve" : ""} onClick={() => onPlayer(player.id)} title={`${player.name} · ${positionName[player.position]} · ${player.role === "start" ? "Startelf" : "Reserve"}`}>
            <span className="manager-fixture-portrait"><PlayerPortrait name={player.name} url={player.photoUrl} teamCode={player.teamCode} teamLogoUrl={player.logoUrl} />{player.points != null && <b className={player.points < 0 ? "negative" : ""}>{formatSignedPoints(player.points)}</b>}</span>
            <small>{lastName(player.name)}</small>
          </button>
        </li>
      ))}
    </ol>
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
        <span><PlayerName name={player.name} /><small>{positionName[player.position]}</small></span>
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
        countLabel={`${sortedTeams.length} Vereine`}
        emptyMessage="Für diese Saison liegen keine Mannschaftswertungen vor."
        loading={loading}
        minWidth="900px"
        mobileMinWidth="580px"
        variant="compact"
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
        { value: "current", label: "Punkte diese Saison" },
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
    { id: "player", label: "Spieler", width: "31%", render: (player, index) => <div className="table-player"><span className="rank">{index + 1}</span><PlayerPortrait name={player.name} url={player.photoUrl} teamCode={player.teamCode} teamLogoUrl={player.logoUrl} /><span><PlayerName name={player.name} /><small>{player.team}</small></span></div> },
    { id: "position", label: "Position", render: (player) => <PositionTag position={player.position} /> },
    { id: "price", label: "Marktwert", numeric: true, render: (player) => formatMarketValue(player.priceM) },
    { id: "current", label: "Diese Saison", numeric: true, className: "point-value", render: (player) => <>{player.currentPoints ?? "—"}<small>{data?.context.currentRound ? `bis ST ${data.context.currentRound}` : "noch kein Spieltag"}</small></> },
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
      {error ? <ErrorState message={error} /> : loading || !data ? <LoadingState /> : <DataTable ariaLabel="Topspieler" rows={visiblePlayers} columns={columns} getRowKey={(player) => player.id} emptyMessage="Für diese Position sind keine kaufbaren Spieler importiert." minWidth="1200px" mobileMinWidth="880px" onRowClick={(player) => onPlayer(player.id)} />}
      <p className="top-players-note">„Diese Saison" zeigt bereits erzielte Punkte der laufenden Saison bis zum letzten importierten Spieltag. Einordnung, Schnitt und Trend verwenden weiterhin ausschließlich abgeschlossene kicker-Wertungen aus Bundesliga, 2. Bundesliga und 3. Liga; auch Spieler ohne importierte Historie bleiben sichtbar.</p>
    </div>
  );
}

function sortTopPlayers(players: TopPlayerAnalysis[], sort: TopPlayerSort) {
  function metric(player: TopPlayerAnalysis) {
    if (sort === "current") return player.currentPoints ?? -Infinity;
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
function formatDateWithYear(value: string | null) { return value ? new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(value)) : "—"; }
function formatMatchdayRange(startAt: string | null, endAt: string | null) {
  if (!startAt && !endAt) return "Termin noch offen";
  const formatter = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "long" });
  if (!startAt) return formatter.format(new Date(endAt!));
  if (!endAt) return formatter.format(new Date(startAt));
  return `${formatter.format(new Date(startAt))} – ${formatter.format(new Date(endAt))}`;
}
function formatFixtureSlot(value: string | null) {
  if (!value) return "Termin noch offen";
  return new Intl.DateTimeFormat("de-DE", { weekday: "long", day: "2-digit", month: "long", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}
function formatRoundPhase(phase: string) {
  return ({ COMPLETED: "Abgeschlossen", LIVE: "Live", SCHEDULED: "Anstehend" } as Record<string, string>)[phase] ?? phase;
}
function formatNewsDate(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}
function formatVenue(value: PlayerGame["venue"]) { return value === "Home" ? "Heim" : "Auswärts"; }
function lastName(name: string) { return name.split(" ").at(-1) ?? name; }
function PlayerName({ name }: { name: string }) {
  const short = lastName(name);
  if (short === name) return <strong>{name}</strong>;
  return <strong title={name}><span className="player-name-full">{name}</span><span className="player-name-short">{short}</span></strong>;
}
function Empty({ message }: { message: string }) { return <div className="empty"><span>○</span><p>{message}</p></div>; }
function ErrorState({ message }: { message: string }) { return <div className="state-card error-state"><span>Ansicht konnte nicht geladen werden</span><strong>{message}</strong><p>Bitte prüfen, ob die statischen Datendateien vorhanden sind, und anschließend neu laden.</p></div>; }
function LoadingState() { return <div className="loading-grid" aria-label="Dashboard wird geladen"><span /><span /><span /></div>; }
