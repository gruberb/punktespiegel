import type { RoundInsights } from "../../types/models";
import type { SeasonIndex } from "./contracts";

// Older generated insights omit navigation IDs. Resolve them from canonical
// fixtures, never from abbreviated display names or the order of match tiles.
export function linkInsights(insights: RoundInsights, index: SeasonIndex): RoundInsights {
  return { ...insights, cards: insights.cards.map((card) => {
    const visual = card.visual;
    if (visual.type === "outcomes") return { ...card, visual: { ...visual, matches: visual.matches?.map((entry) => {
      const matches = index.season.matches.filter((match) => match.round === insights.round && match.homeTeamId === entry.home.id && match.awayTeamId === entry.away.id);
      return { ...entry, matchId: matches.length === 1 ? matches[0].id : undefined };
    }) } };
    const subject = card.subject;
    const playerMatches = subject?.kind === "player"
        ? new Set(index.season.scores.filter((score) => score.playerId === subject.id).map((score) => score.matchId))
        : null;
    const linkRow = <T extends { round: number }>(row: T): T & { matchId?: string; opponentId?: string } => {
      const matches = index.season.matches.filter((match) => match.round === row.round && (playerMatches
        ? playerMatches.has(match.id)
        : subject?.kind === "team" && (match.homeTeamId === subject.id || match.awayTeamId === subject.id)));
      if (matches.length !== 1) return row;
      const match = matches[0];
      const teamId = subject?.kind === "team" ? subject.id : index.season.scores.find((score) => score.matchId === match.id && score.playerId === subject?.id)?.teamId;
      return { ...row, matchId: match.id, opponentId: teamId === match.homeTeamId ? match.awayTeamId : match.homeTeamId };
    };
    return visual.type === "results"
      ? { ...card, visual: { ...visual, rows: visual.rows.map(linkRow) } }
      : { ...card, visual: { ...visual, rows: visual.rows.map(linkRow) } };
  }) };
}
