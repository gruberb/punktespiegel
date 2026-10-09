import type { LikelyEleven, Position, TeamDetail, TeamDetailMatch, TeamDetailPlayer, TeamMatchContributor } from "../../types/models";
import type { SeasonIndex, StaticClubProfiles, StaticRoleSignals } from "./contracts";

// Once matches have been played, the likely starting eleven is derived from
// actual lineups. Before kickoff, Bundesliga role signals provide a preseason
// fallback so a possible eleven remains useful on the current-season page.
function likelyEleven(index: SeasonIndex, teamId: string, roleSignals: StaticRoleSignals | null, eligiblePlayers: Set<string> | null = null): LikelyEleven | null {
  const starts = new Map<string, number>();
  const points = new Map<string, number>();
  const evaluatedMatches = new Set<string>();
  for (const score of index.season.scores) {
    if (score.teamId !== teamId) continue;
    evaluatedMatches.add(score.matchId);
    points.set(score.playerId, (points.get(score.playerId) ?? 0) + score.totalPoints);
    if (score.pointsStarter > 0) starts.set(score.playerId, (starts.get(score.playerId) ?? 0) + 1);
  }
  const useRoleSnapshot = !starts.size
    && roleSignals?.league === index.season.leagueCode
    && roleSignals.season === index.season.startYear;
  if (!starts.size && !useRoleSnapshot) return null;
  const candidates: LikelyEleven["players"] = useRoleSnapshot
    ? [...index.players.values()].flatMap((player) => {
        const signal = roleSignals.players[player.id];
        if (player.teamId !== teamId || !signal || (eligiblePlayers && !eligiblePlayers.has(player.id))) return [];
        return [{ id: player.id, name: player.name, position: player.position, photoUrl: player.photoUrl, starts: signal.role === "starter" ? 1 : 0, points: 0, role: signal.role }];
      })
    : [...starts].flatMap(([id, count]) => {
        if (eligiblePlayers && !eligiblePlayers.has(id)) return [];
        const player = index.players.get(id);
        return player ? [{ id, name: player.name, position: player.position, photoUrl: player.photoUrl, starts: count, points: points.get(id) ?? 0, role: null }] : [];
      });
  const formations = [[3, 4, 3], [4, 3, 3], [3, 5, 2], [4, 4, 2], [4, 5, 1], [5, 3, 2], [5, 4, 1]] as const;
  let best: { starts: number; formation: string; players: LikelyEleven["players"] } | null = null;
  for (const [defenders, midfielders, forwards] of formations) {
    const counts: [Position, number][] = [["GK", 1], ["DEF", defenders], ["MID", midfielders], ["FWD", forwards]];
    const eleven = counts.flatMap(([position, count]) => candidates.filter((player) => player.position === position)
      .sort((left, right) => {
        const roleWeight = (role: LikelyEleven["players"][number]["role"]) => role === "starter" ? 2 : role === "alternative" ? 1 : 0;
        return right.starts - left.starts || roleWeight(right.role) - roleWeight(left.role) || right.points - left.points || left.name.localeCompare(right.name, "de");
      })
      .slice(0, count));
    if (eleven.length !== 11) continue;
    const total = eleven.reduce((sum, player) => sum + player.starts, 0);
    if (!best || total > best.starts) best = { starts: total, formation: `${defenders}–${midfielders}–${forwards}`, players: eleven };
  }
  if (!best) return null;
  return { formation: best.formation, evaluatedMatches: evaluatedMatches.size, source: useRoleSnapshot ? "roleSnapshot" : "seasonStarts", players: best.players };
}

export function teamDetail(index: SeasonIndex, teamId: string, roleSignals: StaticRoleSignals | null, clubProfiles: StaticClubProfiles | null): TeamDetail {
  const team = index.teams.get(teamId);
  if (!team) throw new Error("Mannschaft wurde in dieser Saison nicht gefunden.");
  const snapshot = clubProfiles?.leagueCode === index.season.leagueCode && clubProfiles.season === index.season.startYear
    ? clubProfiles.teams[teamId] ?? null
    : null;
  const points = new Map<string, number>();
  for (const score of index.season.scores) {
    if (score.teamId === teamId) points.set(score.playerId, (points.get(score.playerId) ?? 0) + score.totalPoints);
  }
  const rosterIds = snapshot
    ? new Set([
        ...Object.keys(snapshot.squad),
        ...index.season.players.filter((player) => player.teamId === teamId && player.active).map((player) => player.id),
      ])
    : new Set([...index.season.players.filter((player) => player.teamId === teamId).map((player) => player.id), ...points.keys()]);
  const players = [...rosterIds].flatMap((id): TeamDetailPlayer[] => {
    const player = index.players.get(id);
    return player ? [{ id, name: player.name, position: player.position, points: points.get(id) ?? 0, photoUrl: player.photoUrl }] : [];
  }).sort((left, right) => right.points - left.points || left.name.localeCompare(right.name, "de"));

  const matches = index.season.matches.filter((match) => match.homeTeamId === teamId || match.awayTeamId === teamId).map((match): TeamDetailMatch => {
    const home = match.homeTeamId === teamId;
    const opponent = index.teams.get(home ? match.awayTeamId : match.homeTeamId);
    if (!opponent) throw new Error("Gegner wurde in der Saisondatei nicht gefunden.");
    const scores = index.season.scores.filter((score) => score.matchId === match.id && score.teamId === teamId);
    const byPosition = (position: Position) => scores.filter((score) => index.players.get(score.playerId)?.position === position).reduce((sum, score) => sum + score.totalPoints, 0);
    const contributors = scores.filter((score) => score.totalPoints !== 0).flatMap((score): TeamMatchContributor[] => {
      const player = index.players.get(score.playerId);
      return player ? [{ id: player.id, name: player.name, position: player.position, points: score.totalPoints, photoUrl: player.photoUrl }] : [];
    }).sort((left, right) => right.points - left.points || left.name.localeCompare(right.name, "de"));
    return {
      matchId: match.id,
      matchday: match.round,
      scheduledAt: match.scheduledAt,
      opponentId: opponent.id,
      opponent: opponent.name,
      opponentCode: opponent.code,
      opponentLogoUrl: opponent.logoUrl,
      venue: home ? "Home" : "Away",
      homeScore: match.homeScore,
      awayScore: match.awayScore,
      totalPoints: scores.reduce((sum, score) => sum + score.totalPoints, 0),
      goalkeeperPoints: byPosition("GK"),
      defencePoints: byPosition("DEF"),
      midfieldPoints: byPosition("MID"),
      forwardPoints: byPosition("FWD"),
      gradePoints: scores.reduce((sum, score) => sum + score.pointsGrade, 0),
      goalPoints: scores.reduce((sum, score) => sum + score.pointsGoals, 0),
      assistPoints: scores.reduce((sum, score) => sum + score.pointsAssists, 0),
      cleanSheetPoints: scores.reduce((sum, score) => sum + score.pointsCleanSheet, 0),
      starterPoints: scores.reduce((sum, score) => sum + score.pointsStarter, 0),
      cardPoints: scores.reduce((sum, score) => sum + score.pointsCards, 0),
      yellowRedCards: scores.filter((score) => score.pointsCards === -3).length,
      redCards: scores.filter((score) => score.pointsCards === -6).length,
      mvpPoints: scores.reduce((sum, score) => sum + score.pointsMvp, 0),
      jokerPoints: scores.reduce((sum, score) => sum + score.pointsJoker, 0),
      players: contributors,
    };
  }).sort((left, right) => left.matchday - right.matchday);
  const source = roleSignals?.league === index.season.leagueCode && roleSignals.season === index.season.startYear
    ? roleSignals.teams[teamId]
    : null;
  return {
    id: team.id,
    name: team.name,
    code: team.code,
    startYear: index.season.startYear,
    logoUrl: team.logoUrl,
    players,
    matches,
    profile: snapshot ? {
      generatedAt: clubProfiles!.generatedAt,
      provider: clubProfiles!.provider,
      transfermarktUrl: snapshot.transfermarktUrl,
      coach: snapshot.coach,
      captainPlayerId: snapshot.captainPlayerId,
      squad: snapshot.squad,
      arrivals: snapshot.arrivals,
      departures: snapshot.departures,
    } : null,
    likelyEleven: likelyEleven(index, teamId, roleSignals, snapshot ? rosterIds : null),
    externalSources: source ? { generatedAt: roleSignals!.generatedAt, ...source } : null,
  };
}
