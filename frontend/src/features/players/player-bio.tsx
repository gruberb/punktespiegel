import type { PlayerDetail } from "../../types/models";
import { formatDateWithYear, formatHeight } from "../../utils/format";
import { formatJoined } from "../../utils/profile-format";

export function PlayerBioSection({ bio, seasonStartYear }: { bio: NonNullable<PlayerDetail["bio"]>; seasonStartYear: number }) {
  const facts: { label: string; value: string; detail?: string }[] = [
    { label: "Geboren", value: bio.birthDate ? formatDateWithYear(bio.birthDate) : "—", detail: bio.age != null ? `${bio.age} Jahre` : undefined },
    { label: "Nationalität", value: bio.nationalities.join(", ") || "—" },
    { label: "Größe", value: formatHeight(bio.heightCm), detail: bio.foot ? `${bio.foot === "beidfüßig" ? "beidfüßig" : `${bio.foot}er Fuß`}` : undefined },
    { label: "Im Verein seit", value: bio.joinedAt ? formatJoined(bio.joinedAt, seasonStartYear) : "—", detail: bio.previousClub ? `zuvor ${bio.previousClub}` : undefined },
    { label: "Vertrag bis", value: bio.contractUntil ? formatDateWithYear(bio.contractUntil) : "—" },
    { label: "Rückennummer", value: bio.shirtNumber ?? "—", detail: bio.positionDetail ?? undefined },
  ];
  return (
    <section className="player-bio" aria-label="Spielerdaten">
      {facts.map((fact) => <span key={fact.label}><small>{fact.label}</small><strong>{fact.value}</strong>{fact.detail && <em>{fact.detail}</em>}</span>)}
    </section>
  );
}
