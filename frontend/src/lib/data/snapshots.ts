import type { RoundInsights } from "../../types/models";
import type { SeasonIndex, StaticAvailabilitySignals, StaticCatalog, StaticClubProfiles, StaticPlayerCareers, StaticRoleSignals, StaticSeason } from "./contracts";
import type { NewsArtifact } from "./news";

export const catalogCache = loadJson<StaticCatalog>(asset("data/catalog.json"));

export const newsCache = loadJson<NewsArtifact>(asset("data/news.json")).catch((): NewsArtifact => ({
  schemaVersion: 1,
  generatedAt: "",
  provider: "",
  players: {},
  loadFailed: true,
}));

export const roleSignalsCache = loadJson<StaticRoleSignals>(asset("data/current-role-signals.json")).catch(() => null);

export const availabilitySignalsCache = loadJson<StaticAvailabilitySignals>(asset("data/current-availability-signals.json")).catch(() => null);

const seasonCache = new Map<string, Promise<SeasonIndex>>();

const clubProfilesCache = new Map<string, Promise<StaticClubProfiles | null>>();

const playerCareersCache = new Map<string, Promise<StaticPlayerCareers | null>>();

const insightsCache = new Map<string, Promise<RoundInsights[]>>();

function asset(path: string) {
  return `${import.meta.env.BASE_URL}${path}`;
}

async function loadJson<T>(path: string): Promise<T> {
  const response = await fetch(path, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`Datendatei konnte nicht geladen werden (${response.status})`);
  return response.json() as Promise<T>;
}

export function loadSeason(params: URLSearchParams): Promise<SeasonIndex> {
  const league = params.get("league") ?? "0001";
  const year = params.get("season") ?? String(currentSeasonStartYear());
  const id = `se-k${league}${year}`;
  let pending = seasonCache.get(id);
  if (!pending) {
    pending = loadJson<StaticSeason>(asset(`data/seasons/${id}.json`)).then((season) => {
      if (season.schemaVersion !== 2) throw new Error("Die Datendatei verwendet einen unbekannten Vertrag.");
      return {
        season,
        teams: new Map(season.teams.map((team) => [team.id, team])),
        players: new Map(season.players.map((player) => [player.id, player])),
        matches: new Map(season.matches.map((match) => [match.id, match])),
      };
    });
    seasonCache.set(id, pending);
    void pending.catch(() => { if (seasonCache.get(id) === pending) seasonCache.delete(id); });
  }
  return pending;
}

// Matchday texts are optional: a season without a generated file (older
// deployments, a build without the generator step) shows the page without them.
export function loadInsights(params: URLSearchParams): Promise<RoundInsights[]> {
  const league = params.get("league") ?? "0001";
  const year = params.get("season") ?? String(currentSeasonStartYear());
  const id = `se-k${league}${year}`;
  let pending = insightsCache.get(id);
  if (!pending) {
    pending = loadJson<{ schemaVersion: number; rounds: RoundInsights[] }>(asset(`data/insights/${id}.json`))
      .then((file) => (file.schemaVersion === 1 ? file.rounds : []))
      .catch(() => []);
    insightsCache.set(id, pending);
  }
  return pending;
}

// Profile snapshots are versioned by league and season. The legacy current-
// season filename remains a fallback while older deployments are cached.
export function loadClubProfiles(league: string, season: number): Promise<StaticClubProfiles | null> {
  const key = `${league}-${season}`;
  let pending = clubProfilesCache.get(key);
  if (!pending) {
    pending = loadJson<StaticClubProfiles>(asset(`data/club-profiles/${key}.json`))
      .catch(() => loadJson<StaticClubProfiles>(asset(`data/club-profiles/${league}.json`)).catch(() => null));
    clubProfilesCache.set(key, pending);
  }
  return pending;
}

export function loadPlayerCareers(league: string, season: number): Promise<StaticPlayerCareers | null> {
  const key = `${league}-${season}`;
  let pending = playerCareersCache.get(key);
  if (!pending) {
    pending = loadJson<StaticPlayerCareers>(asset(`data/player-careers/${key}.json`))
      .catch(() => loadJson<StaticPlayerCareers>(asset(`data/player-careers/${league}.json`)).catch(() => null));
    playerCareersCache.set(key, pending);
  }
  return pending;
}

export function currentSeasonStartYear() {
  const today = new Date();
  return today.getUTCMonth() >= 6 ? today.getUTCFullYear() : today.getUTCFullYear() - 1;
}
