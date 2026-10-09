import { EntityLink } from "../../components/entity-link";
import { LogoTile } from "@gruberb/fun-ui";
import { PlayerPortrait, positionName } from "../../components/player-identity";
import type { Position, TeamDetailMatch, TeamMatchContributor } from "../../types/models";
import { formatCardCounts, formatDate, formatPenalty, formatVenue } from "../../utils/format";

const teamMatchActions: { key: keyof TeamDetailMatch; label: string }[] = [
  { key: "gradePoints", label: "Noten" },
  { key: "goalPoints", label: "Tore" },
  { key: "assistPoints", label: "Vorlagen" },
  { key: "cleanSheetPoints", label: "Zu null" },
  { key: "starterPoints", label: "Startelf" },
  { key: "mvpPoints", label: "SdS" },
  { key: "jokerPoints", label: "Joker" },
];

export function TeamMatchCard({ match, onTeam, onPlayer, onMatch }: { match: TeamDetailMatch; onTeam: (id: string) => void; onPlayer: (id: string) => void; onMatch: (id: string) => void }) {
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
        <span className="team-match-opponent"><LogoTile code={match.opponentCode} url={match.opponentLogoUrl} /><span><strong><EntityLink kind="team" id={match.opponentId}>{match.opponent}</EntityLink></strong><small>{formatDate(match.scheduledAt)} · {formatVenue(match.venue)}</small></span></span>
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
      <div className="match-card-links">
        <button className="match-opponent-link" onClick={() => onMatch(match.matchId)}>Spielbericht öffnen →</button>
        <button className="match-opponent-link" onClick={() => onTeam(match.opponentId)}>{match.opponent} öffnen →</button>
      </div>
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
