import { EntityLink } from "../../components/entity-link";
import { CardHead } from "@gruberb/fun-ui";
import type { ClubTransfer, TeamDetail } from "../../types/models";
import { formatDate, formatMoney } from "../../utils/format";

export function TeamTransferLedger({ profile }: { profile: NonNullable<TeamDetail["profile"]> }) {
  const list = (label: string, transfers: ClubTransfer[], direction: "in" | "out") => (
    <div className="transfer-column">
      <h4>{label}</h4>
      {transfers.length ? (
        <ol className="transfer-list">
          {transfers.map((transfer, index) => {
            const inner = <>
              <span className="transfer-player"><strong>{transfer.playerId ? <EntityLink kind="player" id={transfer.playerId}>{transfer.name}</EntityLink> : <a className="text-link" href={`https://www.transfermarkt.de/-/profil/spieler/${transfer.tmId}`} target="_blank" rel="noreferrer">{transfer.name} ↗</a>}</strong><small>{transfer.club ? <>{direction === "in" ? "von" : "zu"} <a className="text-link" href={`https://www.transfermarkt.de/schnellsuche/ergebnis/schnellsuche?query=${encodeURIComponent(transfer.club)}`} target="_blank" rel="noreferrer">{transfer.club} ↗</a></> : "Verein unbekannt"}{transfer.age != null ? ` · ${transfer.age} Jahre` : ""}</small></span>
              <b className={`transfer-fee ${transfer.fee?.kind ?? "unknown"}`}>{formatMoney(transfer.fee)}</b>
            </>;
            return (
              <li key={`${transfer.tmId}-${transfer.club ?? ""}-${index}`}>
                <div className="transfer-row">{inner}</div>
              </li>
            );
          })}
        </ol>
      ) : <p className="transfer-empty">Keine Bewegungen registriert.</p>}
    </div>
  );
  return (
    <section className="team-transfers" aria-label="Transfers der Saison">
      <CardHead eyebrow="Transfers" title="Zugänge und Abgänge" subtitle={`${profile.provider} · Stand ${formatDate(profile.generatedAt)}`} />
      <div className="transfer-grid">
        {list("Zugänge", profile.arrivals, "in")}
        {list("Abgänge", profile.departures, "out")}
      </div>
    </section>
  );
}
