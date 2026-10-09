import { CardHead } from "@gruberb/fun-ui";
import type { ClubTransfer, TeamDetail } from "../../types/models";
import { formatDate, formatMoney } from "../../utils/format";

export function TeamTransferLedger({ profile, onPlayer }: { profile: NonNullable<TeamDetail["profile"]>; onPlayer: (id: string) => void }) {
  const list = (label: string, transfers: ClubTransfer[], direction: "in" | "out") => (
    <div className="transfer-column">
      <h4>{label}</h4>
      {transfers.length ? (
        <ol className="transfer-list">
          {transfers.map((transfer, index) => {
            const inner = <>
              <span className="transfer-player"><strong>{transfer.name}</strong><small>{transfer.club ? (direction === "in" ? `von ${transfer.club}` : `zu ${transfer.club}`) : "Verein unbekannt"}{transfer.age != null ? ` · ${transfer.age} Jahre` : ""}</small></span>
              <b className={`transfer-fee ${transfer.fee?.kind ?? "unknown"}`}>{formatMoney(transfer.fee)}</b>
            </>;
            return (
              <li key={`${transfer.tmId}-${transfer.club ?? ""}-${index}`}>
                {transfer.playerId
                  ? <button className="transfer-row" onClick={() => onPlayer(transfer.playerId!)}>{inner}</button>
                  : <span className="transfer-row static">{inner}</span>}
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
