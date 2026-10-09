import type { MoneyValue, PlayerGame } from "../types/models";

export function initialsOf(name: string) {
  return name.split(/\s+/).filter((part) => /^\p{L}/u.test(part)).map((part) => part[0]).slice(0, 3).join("").toUpperCase();
}

export function formatPlayerValue(value: number | null) { return value == null ? "—" : value.toFixed(1); }

export function formatMarketValue(valueInMillions: number) { return valueInMillions >= 999 ? "–" : `€${valueInMillions.toFixed(1)}m`; }

export function formatEur(eur: number | null) {
  if (eur == null) return "—";
  if (eur >= 1_000_000) return `${(eur / 1_000_000).toLocaleString("de-DE", { maximumFractionDigits: 2 })} Mio. €`;
  if (eur >= 1_000) return `${Math.round(eur / 1_000)} Tsd. €`;
  return `${eur} €`;
}

export function formatMoney(value: MoneyValue | null | undefined) {
  if (!value) return "—";
  if (value.kind === "free") return "ablösefrei";
  if (value.kind === "loanEnd") return "Leih-Ende";
  if (value.kind === "loan") return value.eur != null && value.eur > 0 ? `Leihe · ${formatEur(value.eur)}` : "Leihe";
  return value.eur != null ? formatEur(value.eur) : value.raw;
}

export function formatHeight(heightCm: number | null) {
  return heightCm == null ? "—" : `${(heightCm / 100).toLocaleString("de-DE", { minimumFractionDigits: 2 })} m`;
}

export function formatSeason(startYear: number) { return `${startYear}/${String(startYear + 1).slice(-2)}`; }

export function formatPenalty(value: number) { return value < 0 ? `−${Math.abs(value)}` : String(value); }

export function formatSignedPoints(value: number) { return value > 0 ? `+${value}` : value < 0 ? `−${Math.abs(value)}` : "0"; }

export function formatCardCounts(redCards: number, yellowRedCards: number) {
  const parts = [redCards > 0 ? `${redCards}× Rot` : "", yellowRedCards > 0 ? `${yellowRedCards}× Gelb-Rot` : ""].filter(Boolean);
  return parts.length ? parts.join(" · ") : "keine Platzverweise";
}

export function formatDate(value: string | null) { return value ? new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "short" }).format(new Date(value)) : "—"; }

export function formatDateWithYear(value: string | null) { return value ? new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(value)) : "—"; }

export function formatFixtureSlot(value: string | null) {
  if (!value) return "Termin noch offen";
  return new Intl.DateTimeFormat("de-DE", { weekday: "long", day: "2-digit", month: "long", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

export function formatNewsDate(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}

export function formatVenue(value: PlayerGame["venue"]) { return value === "Home" ? "Heim" : "Auswärts"; }

export function lastName(name: string) { return name.split(" ").at(-1) ?? name; }
