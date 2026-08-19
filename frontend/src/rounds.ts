type RoundAvailability = {
  roundCount: number;
  latestRound: number;
};

export function latestAvailableRound(season: RoundAvailability) {
  const roundCount = Math.max(1, Math.trunc(season.roundCount));
  const latestRound = Number.isFinite(season.latestRound) ? Math.trunc(season.latestRound) : 0;
  return Math.min(Math.max(latestRound, 1), roundCount);
}

export function latestImportedRound(season: RoundAvailability) {
  const roundCount = Math.max(1, Math.trunc(season.roundCount));
  const latestRound = Number.isFinite(season.latestRound) ? Math.trunc(season.latestRound) : 0;
  return Math.min(Math.max(latestRound, 0), roundCount);
}

export function initialAvailableRound(season: RoundAvailability, requestedRound: number | null) {
  const latestRound = latestAvailableRound(season);
  return requestedRound !== null && Number.isInteger(requestedRound) && requestedRound >= 1 && requestedRound <= latestRound
    ? requestedRound
    : latestRound;
}
