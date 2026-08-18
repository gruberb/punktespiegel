// Type contract of the local v1 baseline model and its recommendation
// artifacts. The website no longer displays these squads; the types live here
// so the recommender tooling stays self-contained.
import type { Position } from "../frontend/src/types.ts";

export type ManagerMode = "classic" | "interactive";
export type ProjectionConfidence = "high" | "medium" | "low";

export type ManagerPickPlayer = {
  id: string;
  name: string;
  teamId: string;
  team: string;
  teamCode: string;
  logoUrl: string | null;
  photoUrl: string | null;
  position: Position;
  priceM: number;
  projectedPoints: number;
  currentPoints: number;
  pStart?: number;
  pSub?: number;
  pDnp?: number;
  confidence: ProjectionConfidence;
  seasonsUsed: number;
  appearancesUsed: number;
  promotionAdjusted: boolean;
  role: "start" | "reserve";
};

export type ManagerMatchdayPlayer = {
  id: string;
  name: string;
  team: string;
  teamCode: string;
  logoUrl: string | null;
  photoUrl: string | null;
  position: Position;
  points: number;
};

export type ManagerMatchday = {
  matchday: number;
  totalPoints: number;
  positionPoints: Record<Position, number>;
  players: ManagerMatchdayPlayer[];
};

export type ManagerProjectedMatchdayPlayer = Omit<ManagerMatchdayPlayer, "points"> & {
  opponentId: string;
  opponent: string;
  opponentCode: string;
  opponentLogoUrl: string | null;
  home: boolean;
  pStart: number;
  pSub: number;
  pDnp: number;
  meanPoints: number;
  p10Points: number;
  medianPoints: number;
  p90Points: number;
};

export type ManagerProjectedMatchday = {
  matchday: number;
  formation: string;
  expectedPoints: number;
  expectedReservePoints?: number;
  players: ManagerProjectedMatchdayPlayer[];
};

export type ManagerAvailabilityStatus = "injured" | "rehab" | "suspended" | "not_considered" | "unavailable";

export type ManagerRecommendation = {
  modelVersion?: number;
  deploymentModel?: "two-stage-v2" | "scenario-recourse-v2" | "fixed-v1-champion" | "availability-aware-stable-v2";
  league: string;
  leagueName: string;
  season: string;
  mode: ManagerMode;
  budgetM: number;
  spentM: number;
  remainingM: number;
  winterPlan?: {
    startMatchday: number;
    transferLimit: number;
    transferCount: number;
    spentM: number;
    strategy?: string;
    scenarioCount?: number;
    openingCandidates?: number;
    likelySales?: {
      playerId: string;
      count: number;
      frequency: number;
      name: string;
      position: Position;
      team: string;
      priceM: number;
    }[];
    likelyTargets?: {
      playerId: string;
      count: number;
      frequency: number;
      name: string;
      position: Position;
      team: string;
      priceM: number;
    }[];
    transfers: {
      position: Position;
      role?: "start" | "reserve";
      sell: { id: string; name: string; team: string; priceM: number };
      buy: { id: string; name: string; team: string; priceM: number };
    }[];
  };
  formation: string;
  projectedStartingPoints: number;
  currentStartingPoints: number;
  matchdays: ManagerMatchday[];
  projectedMatchdays?: ManagerProjectedMatchday[];
  generatedAt: string;
  currentSeasonEvidence?: {
    throughMatchday: number;
    optimizationStartsAtMatchday?: number;
    realizedPointsExcludedFromSelectionObjective?: boolean;
    completedMatches: number;
    roleObservations: number;
    explicitScoreRows?: number;
    inferredDnpObservations?: number;
    starts: number;
    substituteAppearances: number;
    dnpObservations: number;
    source: string;
    sourceGeneratedAt: string;
    method: string;
  };
  availabilityAudit?: {
    generatedAt: string;
    provider: string;
    sourceUrl: string;
    policy: string;
    checkedPlayerCount: number;
    excludedPlayerCount: number;
    unmatchedSourcePlayers: string[];
    excludedPlayers: {
      id: string;
      name: string;
      team: string;
      position: Position;
      status: ManagerAvailabilityStatus;
      reason: string | null;
      expectedReturn: string | null;
      source: string;
      sourceUrl: string;
    }[];
  };
  rules: {
    squadSize: number;
    positions: Record<Position, number>;
    maxFromTeam: number | null;
    goalkeepersFromSameTeam?: boolean;
    availabilityPolicy?: string;
  };
  players: ManagerPickPlayer[];
};
