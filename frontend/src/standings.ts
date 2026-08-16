export type StandingsMatch = {
  round: number;
  homeTeamId: string;
  awayTeamId: string;
  scheduledAt: string | null;
  homeScore: number | null;
  awayScore: number | null;
};

export type StandingsRow = {
  teamId: string;
  rank: number;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
};

export type FormResult = {
  round: number;
  outcome: "S" | "U" | "N";
  goalsFor: number;
  goalsAgainst: number;
  opponentId: string;
  home: boolean;
};

export type CrossTableCell = {
  round: number;
  scheduledAt: string | null;
  homeScore: number | null;
  awayScore: number | null;
};

type TeamName = (teamId: string) => string;

function isPlayed(match: StandingsMatch) {
  return match.homeScore != null && match.awayScore != null;
}

function playedThrough(matches: StandingsMatch[], throughRound: number) {
  return matches.filter((match) => match.round <= throughRound && isPlayed(match));
}

export function computeTable(matches: StandingsMatch[], teamIds: string[], throughRound: number, teamName: TeamName): StandingsRow[] {
  const rows = new Map<string, StandingsRow>(teamIds.map((teamId) => [teamId, {
    teamId,
    rank: 0,
    played: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    goalDifference: 0,
    points: 0,
  }]));
  for (const match of playedThrough(matches, throughRound)) {
    const home = rows.get(match.homeTeamId);
    const away = rows.get(match.awayTeamId);
    if (!home || !away) continue;
    const homeScore = match.homeScore!;
    const awayScore = match.awayScore!;
    home.played += 1;
    away.played += 1;
    home.goalsFor += homeScore;
    home.goalsAgainst += awayScore;
    away.goalsFor += awayScore;
    away.goalsAgainst += homeScore;
    if (homeScore > awayScore) {
      home.wins += 1;
      home.points += 3;
      away.losses += 1;
    } else if (homeScore < awayScore) {
      away.wins += 1;
      away.points += 3;
      home.losses += 1;
    } else {
      home.draws += 1;
      away.draws += 1;
      home.points += 1;
      away.points += 1;
    }
  }
  const table = [...rows.values()];
  for (const row of table) row.goalDifference = row.goalsFor - row.goalsAgainst;
  table.sort((left, right) => right.points - left.points
    || right.goalDifference - left.goalDifference
    || right.goalsFor - left.goalsFor
    || teamName(left.teamId).localeCompare(teamName(right.teamId), "de"));
  table.forEach((row, index) => { row.rank = index + 1; });
  return table;
}

export function positionsByRound(matches: StandingsMatch[], teamIds: string[], throughRound: number, teamName: TeamName): Map<string, number[]> {
  const positions = new Map<string, number[]>(teamIds.map((teamId) => [teamId, []]));
  for (let round = 1; round <= throughRound; round += 1) {
    for (const row of computeTable(matches, teamIds, round, teamName)) {
      positions.get(row.teamId)?.push(row.rank);
    }
  }
  return positions;
}

export function formLastN(matches: StandingsMatch[], teamId: string, throughRound: number, count: number): FormResult[] {
  return playedThrough(matches, throughRound)
    .filter((match) => match.homeTeamId === teamId || match.awayTeamId === teamId)
    .sort((left, right) => left.round - right.round)
    .slice(-count)
    .map((match) => {
      const home = match.homeTeamId === teamId;
      const goalsFor = home ? match.homeScore! : match.awayScore!;
      const goalsAgainst = home ? match.awayScore! : match.homeScore!;
      return {
        round: match.round,
        outcome: goalsFor > goalsAgainst ? "S" : goalsFor < goalsAgainst ? "N" : "U",
        goalsFor,
        goalsAgainst,
        opponentId: home ? match.awayTeamId : match.homeTeamId,
        home,
      };
    });
}

export function formPoints(form: FormResult[]) {
  return form.reduce((sum, result) => sum + (result.outcome === "S" ? 3 : result.outcome === "U" ? 1 : 0), 0);
}

export function trendVsRound(positions: number[], throughRound: number, span = 5): number | null {
  const compareRound = Math.max(1, throughRound - span);
  if (compareRound >= throughRound) return null;
  const earlier = positions[compareRound - 1];
  const current = positions[throughRound - 1];
  if (earlier == null || current == null) return null;
  return earlier - current;
}

export function crossTable(matches: StandingsMatch[], throughRound: number): Map<string, CrossTableCell> {
  const cells = new Map<string, CrossTableCell>();
  for (const match of matches) {
    const revealed = match.round <= throughRound && isPlayed(match);
    cells.set(`${match.homeTeamId}|${match.awayTeamId}`, {
      round: match.round,
      scheduledAt: match.scheduledAt,
      homeScore: revealed ? match.homeScore : null,
      awayScore: revealed ? match.awayScore : null,
    });
  }
  return cells;
}
