import type { Dashboard, LeagueStandings, PlayerTableRow, RoundInsights } from "../../types/models";
import { abortable } from "../abortable";
import { leagueStandings, matchDetail } from "./match-models";
import { playerDetail } from "./player-models";
import { analyzePlayerHistory, previousSeasonPointsByPlayer } from "./player-table";
import { latestImportedRound } from "./rounds";
import { bestEleven, buildLeaderboards, buildTeamScores, selectedRound, summarizePlayers } from "./scoring";
import { availabilitySignalsCache, catalogCache, currentSeasonStartYear, loadClubProfiles, loadInsights, loadPlayerCareers, loadSeason, newsCache, roleSignalsCache } from "./snapshots";
import { teamDetail } from "./team-models";

export const api = {
  catalog: (signal?: AbortSignal) => abortable(catalogCache.then(({ leagues, seasons }) => ({ leagues, seasons })), signal),
  dashboard: (params: URLSearchParams, signal?: AbortSignal) => abortable(loadSeason(params).then((index): Dashboard => {
    const round = selectedRound(params, index.season);
    const { players } = summarizePlayers(index, round);
    return {
      context: { league: index.season.leagueCode, season: index.season.displayName, round, lastSyncedAt: index.season.generatedAt, playerCount: index.season.players.length },
      leaderboards: buildLeaderboards(players, false),
      matchdayLeaderboards: buildLeaderboards(players, true),
      seasonTeams: buildTeamScores(index, { kind: "through", round }),
      matchdayTeams: buildTeamScores(index, { kind: "exact", round }),
    };
  }), signal),
  standings: (params: URLSearchParams, signal?: AbortSignal): Promise<LeagueStandings> => abortable(loadSeason(params).then((index) => leagueStandings(index, selectedRound(params, index.season))), signal),
  players: (params: URLSearchParams, signal?: AbortSignal) => abortable(Promise.all([loadSeason(params), catalogCache]).then(([index, catalog]) => {
    const { players } = summarizePlayers(index, latestImportedRound(index.season));
    const previousSeason = previousSeasonPointsByPlayer(catalog, index.season.startYear);
    return players.map((player): PlayerTableRow => ({
      ...player,
      previousSeasonPoints: previousSeason.points.get(player.id) ?? null,
      analysis: analyzePlayerHistory(catalog, player, index.season.leagueCode, index.season.startYear),
    }));
  }), signal),
  player: (playerId: string, params: URLSearchParams, signal?: AbortSignal) => {
    const league = params.get("league") ?? "0001";
    const season = Number(params.get("season") ?? currentSeasonStartYear());
    return abortable(Promise.all([loadSeason(params), catalogCache, newsCache, roleSignalsCache, availabilitySignalsCache, loadClubProfiles(league, season), loadPlayerCareers(league, season)]).then(([index, catalog, news, roleSignals, availabilitySignals, clubProfiles, playerCareers]) => playerDetail(index, playerId, catalog, news, roleSignals, availabilitySignals, clubProfiles, playerCareers)), signal);
  },
  teams: (params: URLSearchParams, signal?: AbortSignal) => abortable(loadSeason(params).then((index) => buildTeamScores(index, { kind: "all" })), signal),
  team: (teamId: string, params: URLSearchParams, signal?: AbortSignal) => {
    const league = params.get("league") ?? "0001";
    const season = Number(params.get("season") ?? currentSeasonStartYear());
    return abortable(Promise.all([loadSeason(params), roleSignalsCache, loadClubProfiles(league, season)]).then(([index, roleSignals, clubProfiles]) => teamDetail(index, teamId, roleSignals, clubProfiles)), signal);
  },
  insights: (params: URLSearchParams, signal?: AbortSignal): Promise<RoundInsights | null> => abortable(loadInsights(params).then((rounds) => {
    const round = Number(params.get("round"));
    return rounds.find((entry) => entry.round === round) ?? null;
  }), signal),
  match: (matchId: string, params: URLSearchParams, signal?: AbortSignal) => abortable(loadSeason(params).then((index) => matchDetail(index, matchId)), signal),
  bestEleven: (params: URLSearchParams, signal?: AbortSignal) => abortable(loadSeason(params).then((index) => bestEleven(index, params.get("scope") === "season" ? "season" : "matchday", selectedRound(params, index.season))), signal),
};
