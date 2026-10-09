import { CardHead } from "@gruberb/fun-ui";
import { PlayerName, PlayerPortrait, positionName } from "../../components/player-identity";
import type { Position, TeamDetail } from "../../types/models";
import { formatDateWithYear, formatHeight, formatMoney, lastName } from "../../utils/format";
import { formatJoined } from "../../utils/profile-format";

const positionSectionOrder: Position[] = ["GK", "DEF", "MID", "FWD"];

export function TeamSquadByPosition({ detail, onPlayer }: { detail: TeamDetail; onPlayer: (id: string) => void }) {
  const squad = detail.profile?.squad ?? {};
  const hasBio = Object.keys(squad).length > 0;
  return (
    <section className="team-squad-groups" aria-label="Kader nach Position">
      <CardHead eyebrow="Kader" title="Spieler nach Position" subtitle={hasBio ? "Punkte aus kicker-Wertungen, Profildaten von Transfermarkt" : "Punkte aus kicker-Wertungen"} />
      {positionSectionOrder.map((position) => {
        const players = detail.players.filter((player) => player.position === position);
        if (!players.length) return null;
        return (
          <div className="squad-group" key={position}>
            <h4>{positionName[position]}</h4>
            <div className="table-shell squad-table">
              <table>
                <thead><tr><th>Spieler</th><th className="fui-num">Alter</th><th>Nationalität</th><th className="fui-num">Größe</th><th>Im Verein seit</th><th>Vertrag bis</th><th className="fui-num">Marktwert</th><th className="fui-num">Punkte</th></tr></thead>
                <tbody>
                  {players.map((player) => {
                    const bio = squad[player.id];
                    const isCaptain = detail.profile?.captainPlayerId === player.id;
                    return (
                      <tr key={player.id} className="clickable-row" tabIndex={0} onClick={() => onPlayer(player.id)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") onPlayer(player.id); }}>
                        <td><span className="squad-player"><b className="squad-number">{bio?.shirtNumber ?? ""}</b><PlayerPortrait name={player.name} url={player.photoUrl} teamCode={detail.code} teamLogoUrl={detail.logoUrl} /><span><PlayerName name={player.name} />{isCaptain && <em className="captain-badge" title="Mannschaftskapitän">Kapitän</em>}<small>{bio?.positionDetail ?? positionName[player.position]}</small></span></span></td>
                        <td className="fui-num">{bio?.age ?? "—"}</td>
                        <td><span title={bio?.nationalities.join(", ")}>{bio?.nationalities[0] ?? "—"}{bio && bio.nationalities.length > 1 ? ` +${bio.nationalities.length - 1}` : ""}</span></td>
                        <td className="fui-num">{formatHeight(bio?.heightCm ?? null)}</td>
                        <td>{bio?.joinedAt ? formatJoined(bio.joinedAt, detail.startYear) : "—"}</td>
                        <td>{bio?.contractUntil ? formatDateWithYear(bio.contractUntil) : "—"}</td>
                        <td className="fui-num">{formatMoney(bio?.marketValue ?? null)}</td>
                        <td className="fui-num fui-data-table__primary">{player.points}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </section>
  );
}

export function TeamLikelyEleven({ eleven, teamCode, teamLogoUrl, onPlayer }: { eleven: NonNullable<TeamDetail["likelyEleven"]>; teamCode: string; teamLogoUrl: string | null; onPlayer: (id: string) => void }) {
  const groups = eleven.players.reduce<Record<Position, typeof eleven.players>>((accumulator, player) => {
    accumulator[player.position].push(player);
    return accumulator;
  }, { GK: [], DEF: [], MID: [], FWD: [] });
  return (
    <section className="team-likely-eleven" aria-label="Mögliche Startelf">
      <CardHead eyebrow="Mögliche Startelf" title={`Formation ${eleven.formation}`} subtitle={eleven.source === "roleSnapshot" ? "Aktuelle Rollenprognose von LigaInsider vor dem Saisonstart" : `Meiste Startelfeinsätze in ${eleven.evaluatedMatches} gewerteten ${eleven.evaluatedMatches === 1 ? "Spiel" : "Spielen"} dieser Saison`} />
      <div className="likely-eleven-rows">
        {positionSectionOrder.map((position) => groups[position].length > 0 && (
          <div className="likely-eleven-row" key={position}>
            <h4>{positionName[position]}</h4>
            <div>
              {groups[position].map((player) => (
                <button key={player.id} className="likely-player" onClick={() => onPlayer(player.id)} title={eleven.source === "roleSnapshot" ? `${player.name} · ${player.role === "starter" ? "Startelf-Tipp" : player.role === "alternative" ? "Alternative" : "Kader"}` : `${player.name} · ${player.starts}× Startelf`}>
                  <PlayerPortrait name={player.name} url={player.photoUrl} teamCode={teamCode} teamLogoUrl={teamLogoUrl} />
                  <strong>{lastName(player.name)}</strong>
                  <small>{eleven.source === "roleSnapshot" ? (player.role === "starter" ? "Startelf-Tipp" : player.role === "alternative" ? "Alternative" : "Kader") : `${player.starts}× Startelf`}</small>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
