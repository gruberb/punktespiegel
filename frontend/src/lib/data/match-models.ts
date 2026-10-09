import type { LeagueStandings, LeagueTableRow, LeagueTableTeam, MatchDetail, MatchPlayer, MatchSide, MatchdayContributor, MatchdayFixture, Position } from "../../types/models";
import type { SeasonIndex, StaticScore } from "./contracts";
import { scoreCountsAsAppearance } from "./scoring";
import { computeTable, crossTable, formLastN, formPoints, positionsByRound, trendVsRound } from "./standings";

export function leagueStandings(index: SeasonIndex, round: number): LeagueStandings {
  const matches = index.season.matches;
  const teamIds = index.season.teams.map((team) => team.id);
  const teamName = (teamId: string) => index.teams.get(teamId)?.name ?? teamId;
  const toTeam = (teamId: string): LeagueTableTeam => {
    const team = index.teams.get(teamId);
    return { id: teamId, name: team?.name ?? "Unbekannter Verein", code: team?.code ?? "—", logoUrl: team?.logoUrl ?? null };
  };
  const table = computeTable(matches, teamIds, round, teamName);
  const positions = positionsByRound(matches, teamIds, round, teamName);
  const rows = table.map((row): LeagueTableRow => {
    const form = formLastN(matches, row.teamId, round, 5);
    const teamPositions = positions.get(row.teamId) ?? [];
    return {
      team: toTeam(row.teamId),
      rank: row.rank,
      played: row.played,
      wins: row.wins,
      draws: row.draws,
      losses: row.losses,
      goalsFor: row.goalsFor,
      goalsAgainst: row.goalsAgainst,
      goalDifference: row.goalDifference,
      points: row.points,
      trend: trendVsRound(teamPositions, round),
      form: form.map((result) => ({
        round: result.round,
        outcome: result.outcome,
        score: `${result.goalsFor}:${result.goalsAgainst}`,
        home: result.home,
        opponent: toTeam(result.opponentId),
      })),
      formPoints: formPoints(form),
      positions: teamPositions,
    };
  });
  const scoresByMatch = new Map<string, StaticScore[]>();
  for (const score of index.season.scores) {
    const matchScores = scoresByMatch.get(score.matchId);
    if (matchScores) matchScores.push(score);
    else scoresByMatch.set(score.matchId, [score]);
  }
  const fixtures = matches.filter((match) => match.round === round)
    .sort((left, right) => (left.scheduledAt ?? "").localeCompare(right.scheduledAt ?? "") || left.id.localeCompare(right.id))
    .map((match): MatchdayFixture => {
      const matchScores = scoresByMatch.get(match.id) ?? [];
      const contributors = (teamId: string, key: "goals" | "assists"): MatchdayContributor[] => matchScores
        .filter((score) => score.teamId === teamId && score[key] > 0)
        .map((score) => {
          const player = index.players.get(score.playerId);
          return { id: score.playerId, name: player?.name ?? "Unbekannt", photoUrl: player?.photoUrl ?? null, count: score[key] };
        })
        .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name, "de"));
      const side = (teamId: string) => ({ team: toTeam(teamId), goals: contributors(teamId, "goals"), assists: contributors(teamId, "assists") });
      return {
        id: match.id,
        scheduledAt: match.scheduledAt,
        state: match.state,
        homeScore: match.homeScore,
        awayScore: match.awayScore,
        home: side(match.homeTeamId),
        away: side(match.awayTeamId),
      };
    });

  const venueRows = (venue: "home" | "away") => computeTable(matches, teamIds, round, teamName, venue).map((row) => ({ ...row, team: toTeam(row.teamId) }));
  return {
    venues: { home: venueRows("home"), away: venueRows("away") },
    context: {
      league: index.season.leagueCode,
      leagueName: index.season.leagueName,
      season: index.season.displayName,
      round,
      roundCount: index.season.roundCount,
      playedMatchCount: matches.filter((match) => match.round <= round && match.homeScore != null && match.awayScore != null).length,
    },
    rows,
    fixtures,
    cross: {
      order: rows.map((row) => row.team.id),
      cells: Object.fromEntries(crossTable(matches, round)),
    },
  };
}

const positionOrder: Record<Position, number> = { GK: 0, DEF: 1, MID: 2, FWD: 3 };

export function matchDetail(index: SeasonIndex, matchId: string): MatchDetail {
  const match = index.matches.get(matchId);
  if (!match) throw new Error("Dieses Spiel ist in der gewählten Saison nicht enthalten.");
  const toTeam = (teamId: string): LeagueTableTeam => {
    const team = index.teams.get(teamId);
    return { id: teamId, name: team?.name ?? "Unbekannter Verein", code: team?.code ?? "—", logoUrl: team?.logoUrl ?? null };
  };
  const teamName = (teamId: string) => index.teams.get(teamId)?.name ?? teamId;
  const played = match.homeScore != null && match.awayScore != null;
  const table = played ? computeTable(index.season.matches, index.season.teams.map((team) => team.id), match.round, teamName) : [];
  const scores = index.season.scores.filter((score) => score.matchId === matchId && scoreCountsAsAppearance(score));
  const toPlayer = (score: StaticScore): MatchPlayer => {
    const player = index.players.get(score.playerId);
    return {
      id: score.playerId,
      name: player?.name ?? "Unbekannt",
      photoUrl: player?.photoUrl ?? null,
      position: player?.position ?? "MID",
      grade: score.grade != null && score.grade > 0 ? score.grade / 100 : null,
      goals: score.goals,
      assists: score.assists,
      points: score.totalPoints,
      // kicker awards Startelf points only to starters; substitutes appear without them.
      starter: score.pointsStarter > 0,
      mvp: score.pointsMvp > 0,
      card: score.pointsCards === -6 ? "Rot" : score.pointsCards === -3 ? "Gelb-Rot" : null,
    };
  };
  const side = (teamId: string): MatchSide => {
    const players = scores.filter((score) => score.teamId === teamId).map(toPlayer)
      .sort((left, right) => positionOrder[left.position] - positionOrder[right.position] || right.points - left.points || left.name.localeCompare(right.name, "de"));
    const graded = players.filter((player) => player.grade != null);
    return {
      team: toTeam(teamId),
      rankAfter: table.find((row) => row.teamId === teamId)?.rank ?? null,
      averageGrade: graded.length ? graded.reduce((sum, player) => sum + player.grade!, 0) / graded.length : null,
      points: players.reduce((sum, player) => sum + player.points, 0),
      players,
    };
  };
  const home = side(match.homeTeamId);
  const away = side(match.awayTeamId);
  const mvpEntry = [...home.players.map((player) => ({ player, team: home.team })), ...away.players.map((player) => ({ player, team: away.team }))]
    .find(({ player }) => player.mvp);
  return {
    id: match.id,
    league: index.season.leagueCode,
    leagueName: index.season.leagueName,
    season: index.season.displayName,
    round: match.round,
    scheduledAt: match.scheduledAt,
    homeScore: match.homeScore,
    awayScore: match.awayScore,
    home,
    away,
    mvp: mvpEntry ? { ...mvpEntry.player, team: mvpEntry.team } : null,
    roundMatches: index.season.matches.filter((entry) => entry.round === match.round)
      .sort((left, right) => (left.scheduledAt ?? "").localeCompare(right.scheduledAt ?? "") || left.id.localeCompare(right.id))
      .map((entry) => ({ id: entry.id, scheduledAt: entry.scheduledAt, home: toTeam(entry.homeTeamId), away: toTeam(entry.awayTeamId), homeScore: entry.homeScore, awayScore: entry.awayScore })),
  };
}
