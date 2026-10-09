import type { Catalog, ClubProfile, PlayerCareer, Position } from "../../types/models";

export type StaticCatalog = Catalog & { schemaVersion: number; generatedAt: string };

export type StaticClubProfiles = {
  schemaVersion: number;
  generatedAt: string;
  leagueCode: string;
  season: number;
  provider: string;
  teams: Record<string, ClubProfile & {
    name: string;
    transfermarktClubId: number;
    unmatchedSquad: { tmName: string; tmId: number }[];
    unmatchedKicker: { playerId: string; name: string }[];
  }>;
};

export type StaticPlayerCareers = {
  schemaVersion: number;
  generatedAt: string;
  leagueCode: string;
  season: number;
  provider: string;
  players: Record<string, { tmId: number; tmUrl: string; clubs: PlayerCareer["clubs"]; seasons?: PlayerCareer["seasons"] }>;
};

export type StaticRoleSignals = {
  schemaVersion: number;
  generatedAt: string;
  league: string;
  season: number;
  players: Record<string, {
    role: "starter" | "alternative" | "squad";
    sourceUrl: string;
    sourceUpdatedAt: string;
  }>;
  teams: Record<string, {
    ligaInsiderUrl: string;
    transfermarktUrl: string;
    headlines: { source: string; title: string; url: string }[];
  }>;
};

export type StaticAvailabilitySignals = {
  schemaVersion: number;
  generatedAt: string;
  season: number;
  leagues: Record<string, {
    provider: string;
    sourceUrl: string;
    players: Record<string, {
      status: "injured" | "rehab" | "suspended" | "not_considered" | "unavailable";
      reason: string | null;
      absentSince: string | null;
      expectedReturn: string | null;
      source: string;
      sourceUrl: string;
      profileUrl: string | null;
    }>;
  }>;
};

export type StaticSeason = {
  schemaVersion: number;
  generatedAt: string;
  id: string;
  leagueCode: string;
  leagueName: string;
  startYear: number;
  displayName: string;
  roundCount: number;
  latestRound: number;
  rounds: { id: string; number: number; name: string; startAt: string | null; endAt: string | null; phase: string }[];
  teams: StaticTeam[];
  players: StaticPlayer[];
  matches: StaticMatch[];
  scores: StaticScore[];
};

type StaticTeam = { id: string; name: string; code: string; logoUrl: string | null };

type StaticPlayer = {
  id: string;
  name: string;
  teamId: string;
  position: Position;
  priceM: number;
  active: boolean;
  selectable: boolean;
  photoUrl: string | null;
};

type StaticMatch = {
  id: string;
  round: number;
  homeTeamId: string;
  awayTeamId: string;
  scheduledAt: string | null;
  state: string;
  homeScore: number | null;
  awayScore: number | null;
};

export type StaticScore = {
  matchId: string;
  playerId: string;
  teamId: string;
  totalPoints: number;
  grade: number | null;
  goals: number;
  assists: number;
  pointsCleanSheet: number;
  pointsGrade: number;
  pointsGoals: number;
  pointsCards: number;
  pointsAssists: number;
  pointsStarter: number;
  pointsMvp: number;
  pointsJoker: number;
};

export type SeasonIndex = {
  season: StaticSeason;
  teams: Map<string, StaticTeam>;
  players: Map<string, StaticPlayer>;
  matches: Map<string, StaticMatch>;
};
