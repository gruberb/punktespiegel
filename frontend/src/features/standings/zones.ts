export type LeagueZone = { from: number; to: number; tone: "up" | "up-soft" | "down-soft" | "down"; label: string };

export const leagueZones: Record<string, LeagueZone[]> = {
  "0001": [
    { from: 1, to: 4, tone: "up", label: "Champions League (1–4)" },
    { from: 5, to: 6, tone: "up-soft", label: "Europapokal (5–6)" },
    { from: 16, to: 16, tone: "down-soft", label: "Relegation (16)" },
    { from: 17, to: 18, tone: "down", label: "Abstieg (17–18)" },
  ],
  "0002": [
    { from: 1, to: 2, tone: "up", label: "Aufstieg (1–2)" },
    { from: 3, to: 3, tone: "up-soft", label: "Aufstiegsrelegation (3)" },
    { from: 16, to: 16, tone: "down-soft", label: "Abstiegsrelegation (16)" },
    { from: 17, to: 18, tone: "down", label: "Abstieg (17–18)" },
  ],
  "0003": [
    { from: 1, to: 2, tone: "up", label: "Aufstieg (1–2)" },
    { from: 3, to: 3, tone: "up-soft", label: "Aufstiegsrelegation (3)" },
    { from: 17, to: 20, tone: "down", label: "Abstieg (17–20)" },
  ],
};

export function zoneForRank(league: string, rank: number) {
  return (leagueZones[league] ?? []).find((zone) => rank >= zone.from && rank <= zone.to) ?? null;
}
