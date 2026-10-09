import { useEffect, useRef, useState } from "react";
import { useResource } from "../hooks/use-resource";
import { api } from "../lib/data/api";
import { initialAvailableRound, latestAvailableRound, latestImportedRound, latestPlayedSeason } from "../lib/data/rounds";
import type { PlayerColumns } from "../lib/navigation/routes";
import { hrefForView, pathForView, playerColumnsFromLocation } from "../lib/navigation/routes";
import type { Filters, InfoView, NavView, View } from "../lib/navigation/scope";
import { isInfoView, scopeQuery } from "../lib/navigation/scope";
import type { ViewLocation } from "./navigation";
import { initialFilters, initialView, playerSeasonMembership, requestedInitialRound, seasonsForLeague, seasonsForPlayer, seasonsForTeam, viewBackLabel } from "./navigation";
import { nav } from "./navigation-items";
import { usePageMetadata } from "./use-page-metadata";

export function useAppModel() {
  const { data: catalog, error: catalogError } = useResource(api.catalog);
  const [filters, setFilters] = useState(initialFilters);
  const [view, setViewState] = useState<View>(initialView);
  const [playerColumns, setPlayerColumns] = useState<PlayerColumns>(() => playerColumnsFromLocation(window.location.pathname, new URLSearchParams(window.location.search)));
  const [playerId, setPlayerId] = useState<string | null>(() => new URLSearchParams(window.location.search).get("player"));
  const [teamId, setTeamId] = useState<string | null>(() => new URLSearchParams(window.location.search).get("team"));
  const [matchId, setMatchId] = useState<string | null>(() => new URLSearchParams(window.location.search).get("match"));
  const [backStack, setBackStack] = useState<ViewLocation[]>([]);
  const [overviewScope, setOverviewScope] = useState<"through" | "matchday">("through");
  const navigationToken = useRef(0);
  const initialSeasonRequest = useRef(new URLSearchParams(window.location.search).get("season"));
  const initialRoundRequest = useRef(requestedInitialRound());
  const initialSelectionResolved = useRef(false);

  useEffect(() => {
    const currentParams = new URLSearchParams(window.location.search);
    const hasLegacyViewParam = currentParams.has("view");
    const hasIrrelevantRound = view !== "table" && currentParams.has("round");
    const currentPath = window.location.pathname.replace(/\/+$/, "") || "/";
    if (!hasLegacyViewParam && !hasIrrelevantRound && currentPath === pathForView(view)) return;
    syncUrl(filters, view, playerId, teamId, playerColumns, matchId);
  }, []);

  const seasons = seasonsForLeague(catalog, filters.league);
  const teamSeasons = seasonsForTeam(catalog, teamId);
  const playerSeasons = seasonsForPlayer(catalog, playerId);
  const playerSeasonCandidates = catalog?.seasons.filter((season) => playerId && playerSeasonMembership(season, playerId)) ?? [];
  const newestSeason = seasons[0];
  const latestPublishedSeason = latestPlayedSeason(seasons);
  const requestedSeason = seasons.find((season) => String(season.startYear) === filters.season);
  const selectedTeamSeason = teamSeasons.find((season) => String(season.startYear) === filters.season) ?? teamSeasons[0];
  const selectedPlayerSeason = playerSeasonCandidates.find((season) => season.leagueCode === filters.league && String(season.startYear) === filters.season)
    ?? playerSeasons.find((season) => String(season.startYear) === filters.season)
    ?? playerSeasons[0];
  const selectedSeason = view === "table" ? latestPublishedSeason : view === "team" ? selectedTeamSeason : view === "player" ? selectedPlayerSeason : requestedSeason;
  const latestRound = selectedSeason ? latestImportedRound(selectedSeason) : 0;
  const hasSeasonPoints = latestRound > 0;
  const hasPreviousSeason = Boolean(selectedSeason && catalog?.seasons.some((season) => season.startYear === selectedSeason.startYear - 1));
  const overviewRound = Math.min(Math.max(1, Number(filters.round) || 1), Math.max(1, latestRound));
  const teamSelectionPending = Boolean(selectedTeamSeason)
    && (filters.league !== selectedTeamSeason?.leagueCode || filters.season !== String(selectedTeamSeason?.startYear));
  const playerSelectionPending = Boolean(selectedPlayerSeason)
    && (filters.league !== selectedPlayerSeason?.leagueCode || filters.season !== String(selectedPlayerSeason?.startYear));

  usePageMetadata({ catalog, filters, matchId, playerId, teamId, view, seasonName: selectedSeason?.displayName });

  useEffect(() => {
    if (initialSelectionResolved.current) return;
    const useLatestPlayedSeason = initialSeasonRequest.current === null
      && view !== "players"
      && view !== "team"
      && view !== "player"
      && !isInfoView(view);
    const initialSeason = initialSeasonRequest.current === null && view === "players"
      ? newestSeason
      : useLatestPlayedSeason ? latestPublishedSeason : selectedSeason;
    if (!initialSeason) return;
    initialSelectionResolved.current = true;
    const season = String(initialSeason.startYear);
    const round = String(initialAvailableRound(initialSeason, initialRoundRequest.current));
    if (season === filters.season && round === filters.round) return;
    const next = { ...filters, season, round };
    setFilters(next);
    syncUrl(next, view, playerId, teamId);
  }, [latestPublishedSeason?.id, newestSeason?.id, selectedSeason?.id]);

  useEffect(() => {
    if (view !== "table" || !latestPublishedSeason || filters.season === String(latestPublishedSeason.startYear)) return;
    const next = { ...filters, season: String(latestPublishedSeason.startYear), round: String(Math.max(1, latestPublishedSeason.latestRound)) };
    setFilters(next);
    syncUrl(next, "table", null, null);
  }, [view, filters.league, filters.season, latestPublishedSeason?.startYear, latestPublishedSeason?.latestRound]);

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

  function syncUrl(nextFilters: Filters, nextView: View, nextPlayer: string | null, nextTeam: string | null, columns = playerColumns, nextMatch: string | null = matchId) {
    const params = isInfoView(nextView) ? new URLSearchParams() : scopeQuery(nextFilters, nextView === "table");
    if (nextView === "players" && columns === "history") params.set("columns", "history");
    if (nextView === "player" && nextPlayer) params.set("player", nextPlayer);
    if (nextView === "team" && nextTeam) params.set("team", nextTeam);
    if (nextView === "match" && nextMatch) params.set("match", nextMatch);
    window.history.replaceState({}, "", hrefForView(nextView, params));
  }

  function updatePlayerColumns(columns: PlayerColumns) {
    setPlayerColumns(columns);
    syncUrl(filters, "players", null, null, columns);
  }

  function replaceMatch(id: string) {
    setMatchId(id);
    syncUrl(filters, "match", null, null, playerColumns, id);
    scrollToTop();
  }

  function rememberCurrentLocation() {
    setBackStack((stack) => [...stack, { view, filters: { ...filters }, playerId, teamId, matchId, scrollY: window.scrollY }]);
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
      const defaultSeason = view === "players" ? available[0] : latestPlayedSeason(available);
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
    const overviewSeason = requestedSeason && latestImportedRound(requestedSeason) > 0
      ? requestedSeason
      : latestPublishedSeason;
    const nextFilters = next === "table" && latestPublishedSeason
      ? { ...filters, season: String(latestPublishedSeason.startYear), round: String(Math.max(1, latestPublishedSeason.latestRound)) }
      : (next === "overview" || next === "matchday") && overviewSeason
        ? { ...filters, season: String(overviewSeason.startYear), round: String(latestAvailableRound(overviewSeason)) }
        : filters;
    if (nextFilters !== filters) setFilters(nextFilters);
    setViewState(next);
    setPlayerId(null);
    setTeamId(null);
    setMatchId(null);
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

  function openMatch(id: string) {
    rememberCurrentLocation();
    setPlayerId(null);
    setTeamId(null);
    setMatchId(id);
    setViewState("match");
    syncUrl(filters, "match", null, null, playerColumns, id);
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
    setMatchId(previous.matchId);
    setViewState(previous.view);
    syncUrl(previous.filters, previous.view, previous.playerId, previous.teamId, playerColumns, previous.matchId);
    restoreScrollPosition(previous.scrollY);
  }

  const infoTitle: Record<InfoView, string> = {
    about: "Über Punktespiegel",
    methodology: "Daten & Methodik",
    sources: "Quellen",
    faq: "Häufige Fragen",
  };
  const title = isInfoView(view) ? infoTitle[view] : view === "overview" ? "Überblick" : view === "player" ? "Spielerprofil" : view === "team" ? "Mannschaftsprofil" : view === "match" ? "Spielbericht" : nav.find((item) => item.id === view)?.label;
  const description = view === "table"
    ? latestRound > 0
      ? `${selectedSeason?.displayName ?? "Gewählte Saison"} · ${overviewScope === "matchday" ? `nur Spieltag ${overviewRound}` : `kumuliert bis Spieltag ${overviewRound}`}`
      : `${selectedSeason?.displayName ?? "Gewählte Saison"} · noch ohne abgeschlossenen Spieltag`
    : view === "teams"
      ? `${selectedSeason?.displayName ?? "Gewählte Saison"} · gesamte Saison`
      : view === "players"
        ? latestRound > 0
          ? `${selectedSeason?.displayName ?? "Gewählte Saison"} · kumuliert bis Spieltag ${latestRound}`
          : `${selectedSeason?.displayName ?? "Gewählte Saison"} · Saisonkader vor dem ersten Spieltag`
      : view === "team"
        ? "Kader und Saisonverlauf"
      : view === "overview"
        ? "Tabellenstand, Verlauf und Form"
        : `${selectedSeason?.displayName ?? "Gewählte Saison"} · Spieltag ${filters.round}`;
  const navActive: NavView | null = isInfoView(view) ? null : view === "player" ? "players" : view === "team" ? "teams" : view === "match" ? "overview" : view;
  const previousView = backStack.at(-1)?.view;
  const backLabel = previousView ? `Zurück ${viewBackLabel(previousView)}` : view === "team" ? "Zurück zu den Mannschaften" : view === "match" ? "Zurück zum Überblick" : "Zurück zu den Spielern";
  return {
    view, navActive, setView, filters, title,
    description, catalog, updateFilter, selectedTeamSeason, teamSeasons,
    updateTeamSeason, selectedPlayerSeason, playerSeasons, updatePlayerSeason, seasons,
    latestRound, overviewScope, setOverviewScope, overviewRound, catalogError,
    selectedSeason, openPlayer, openTeam, hasSeasonPoints, hasPreviousSeason,
    playerColumns, updatePlayerColumns, playerId, playerSelectionPending, backLabel,
    goBack, teamId, teamSelectionPending, openMatch, matchId,
    replaceMatch,
  };
}
