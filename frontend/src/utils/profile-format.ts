export function formatJoined(joinedAt: string, seasonStartYear: number, now = new Date()) {
  const joined = new Date(joinedAt);
  if (Number.isNaN(joined.getTime())) return joinedAt;
  const seasonEnd = new Date(Date.UTC(seasonStartYear + 1, 5, 30, 12));
  const reference = now < seasonEnd ? now : seasonEnd;
  let years = reference.getUTCFullYear() - joined.getUTCFullYear();
  const beforeAnniversary = reference.getUTCMonth() < joined.getUTCMonth()
    || (reference.getUTCMonth() === joined.getUTCMonth() && reference.getUTCDate() < joined.getUTCDate());
  if (beforeAnniversary) years -= 1;
  const date = new Intl.DateTimeFormat("de-DE", { month: "2-digit", year: "numeric", timeZone: "UTC" }).format(joined);
  return years >= 1 ? `${date} · ${years} ${years === 1 ? "Jahr" : "Jahre"}` : date;
}
