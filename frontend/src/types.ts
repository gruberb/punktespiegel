export type Position = "GK" | "DEF" | "MID" | "FWD";

export type Catalog = {
  leagues: { code: string; name: string }[];
  seasons: {
    id: string;
    leagueCode: string;
    startYear: number;
    displayName: string;
    roundCount: number;
    latestRound: number;
    dataState: string;
    teamIds: string[];
    players: { id: string; active: boolean; appearances: number; points: number }[];
  }[];
};

export type Player = {
  id: string;
  name: string;
  team: string;
  teamCode: string;
  logoUrl: string | null;
  photoUrl: string | null;
  position: Position;
  priceM: number;
  roundPoints: number;
  observedPoints: number;
  averageGrade: number | null;
  roundGrade: number | null;
  gradedMatches: number;
  goals: number;
  roundGoals: number;
  assists: number;
  roundAssists: number;
  cleanSheets: number;
  roundCleanSheets: number;
  starterPoints: number;
  roundStarterPoints: number;
  cardPoints: number;
  roundCardPoints: number;
  yellowRedCards: number;
  roundYellowRedCards: number;
  redCards: number;
  roundRedCards: number;
  mvpAwards: number;
  roundMvpAwards: number;
  jokerAwards: number;
  roundJokerAwards: number;
  value: number | null;
};

export type LeagueTableTeam = {
  id: string;
  name: string;
  code: string;
  logoUrl: string | null;
};

export type LeagueTableFormEntry = {
  round: number;
  outcome: "S" | "U" | "N";
  score: string;
  home: boolean;
  opponent: LeagueTableTeam;
};

export type LeagueTableRow = {
  team: LeagueTableTeam;
  rank: number;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
  trend: number | null;
  form: LeagueTableFormEntry[];
  formPoints: number;
  positions: number[];
};

export type LeagueStandingsCrossCell = {
  round: number;
  scheduledAt: string | null;
  homeScore: number | null;
  awayScore: number | null;
};

export type MatchdayContributor = {
  id: string;
  name: string;
  photoUrl: string | null;
  count: number;
};

export type MatchdayFixtureSide = {
  team: LeagueTableTeam;
  goals: MatchdayContributor[];
  assists: MatchdayContributor[];
};

export type MatchdayFixture = {
  id: string;
  scheduledAt: string | null;
  state: string;
  homeScore: number | null;
  awayScore: number | null;
  home: MatchdayFixtureSide;
  away: MatchdayFixtureSide;
};

export type LeagueStandings = {
  context: {
    league: string;
    leagueName: string;
    season: string;
    round: number;
    roundCount: number;
    playedMatchCount: number;
  };
  rows: LeagueTableRow[];
  fixtures: MatchdayFixture[];
  cross: {
    order: string[];
    cells: Record<string, LeagueStandingsCrossCell>;
  };
};

export type TeamPlayerScore = {
  id: string;
  name: string;
  position: Position;
  points: number;
};

export type TeamLeaders = {
  overall: TeamPlayerScore[];
  goalkeeper: TeamPlayerScore[];
  defence: TeamPlayerScore[];
  midfield: TeamPlayerScore[];
  forward: TeamPlayerScore[];
};

export type TeamScore = {
  id: string;
  name: string;
  code: string;
  logoUrl: string | null;
  overall: number;
  goalkeeper: number;
  defence: number;
  midfield: number;
  forward: number;
  sampleSize: number;
  topPlayers: TeamLeaders;
};

export type Dashboard = {
  context: {
    league: string;
    season: string;
    round: number;
    lastSyncedAt: string | null;
    playerCount: number;
  };
  leaderboards: {
    overall: Player[];
    positions: Record<Position, Player[]>;
    grades: Player[];
    goals: Player[];
    assists: Player[];
    cleanSheets: Player[];
    starterPoints: Player[];
    cardDeductions: Player[];
    mvpAwards: Player[];
    jokerAwards: Player[];
  };
  matchdayLeaderboards: Dashboard["leaderboards"];
  seasonTeams: TeamScore[];
  matchdayTeams: TeamScore[];
};

export type HistoricalPlayer = {
  id: string;
  name: string;
  team: string;
  teamCode: string;
  logoUrl: string | null;
  photoUrl: string | null;
  position: Position;
  points: number;
  averageGrade: number | null;
  gradedMatches: number;
  goals: number;
  assists: number;
};

export type History = {
  leaderboards: {
    overall: HistoricalPlayer[];
    positions: Record<Position, HistoricalPlayer[]>;
    grades: HistoricalPlayer[];
    goals: HistoricalPlayer[];
    assists: HistoricalPlayer[];
  };
};

export type PlayerGame = {
  matchday: number;
  scheduledAt: string | null;
  opponentId: string;
  opponent: string;
  opponentCode: string;
  opponentLogoUrl: string | null;
  venue: "Home" | "Away";
  homeScore: number | null;
  awayScore: number | null;
  points: number;
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

export type PlayerDetail = {
  id: string;
  name: string;
  teamId: string;
  team: string;
  teamCode: string;
  league: string;
  season: string;
  startYear: number;
  logoUrl: string | null;
  photoUrl: string | null;
  kickerUrl: string;
  kickerNewsUrl: string;
  kickerNewsDirect: boolean;
  transfermarktUrl: string;
  ligaInsiderUrl: string | null;
  position: Position;
  priceM: number;
  seasonPoints: number;
  value: number | null;
  seasons: PlayerSeasonSummary[];
  games: PlayerGame[];
  news: PlayerNews;
  availability: PlayerAvailability | null;
};

export type PlayerAvailability = {
  status: "injured" | "rehab" | "suspended" | "not_considered" | "unavailable";
  reason: string | null;
  absentSince: string | null;
  expectedReturn: string | null;
  source: string;
  sourceUrl: string;
  generatedAt: string;
};

export type NewsRelation = "player" | "team" | "automatic";
export type ClubFeedStatus = "ok" | "error" | "unavailable" | "unknown";

export type NewsArticle = {
  source: string;
  domain: string;
  title: string;
  url: string;
  publishedAt: string;
  relation?: NewsRelation;
  matchedAlias?: string;
  matchedBy?: "fullName" | "teamContextSurname" | "officialTeamFeed";
  teamId?: string | null;
};

export type NewsHealthStatus = "healthy" | "stale" | "failed";

export type NewsFeedSummary = {
  total: number;
  ok: number;
  error: number;
  unmapped: number;
};

export type PlayerNews = {
  generatedAt: string | null;
  provider: string | null;
  status: NewsHealthStatus;
  feedSummary: NewsFeedSummary;
  clubFeedStatus: ClubFeedStatus;
  articles: NewsArticle[];
  clubArticles: NewsArticle[];
};

export type SquadNewsArticle = NewsArticle & {
  relation: NewsRelation;
  relatedPlayers: string[];
  relatedTeams: string[];
};

export type SquadNews = {
  generatedAt: string | null;
  provider: string | null;
  status: NewsHealthStatus;
  feedSummary: NewsFeedSummary;
  articles: SquadNewsArticle[];
};

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

export type ManagerFixturePlayer = {
  id: string;
  name: string;
  teamCode: string;
  logoUrl: string | null;
  photoUrl: string | null;
  position: Position;
  role: "start" | "reserve";
  points: number | null;
};

export type ManagerFixtureTeam = {
  id: string;
  name: string;
  code: string;
  logoUrl: string | null;
  players: ManagerFixturePlayer[];
};

export type ManagerFixture = {
  id: string;
  scheduledAt: string | null;
  state: string;
  homeScore: number | null;
  awayScore: number | null;
  home: ManagerFixtureTeam;
  away: ManagerFixtureTeam;
};

export type ManagerScheduleRound = {
  matchday: number;
  name: string;
  startAt: string | null;
  endAt: string | null;
  phase: string;
  fixtures: ManagerFixture[];
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
      status: PlayerAvailability["status"];
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

export type PlayerSeasonSummary = {
  startYear: number;
  season: string;
  league: string;
  teams: { id: string; name: string; code: string; logoUrl: string | null }[];
  appearances: number;
  gradedAppearances: number;
  points: number;
};

export type TeamDetailPlayer = {
  id: string;
  name: string;
  position: Position;
  points: number;
  photoUrl: string | null;
};

export type TeamMatchContributor = {
  id: string;
  name: string;
  position: Position;
  points: number;
  photoUrl: string | null;
};

export type TeamDetailMatch = {
  matchday: number;
  scheduledAt: string | null;
  opponentId: string;
  opponent: string;
  opponentCode: string;
  opponentLogoUrl: string | null;
  venue: "Home" | "Away";
  homeScore: number | null;
  awayScore: number | null;
  totalPoints: number;
  goalkeeperPoints: number;
  defencePoints: number;
  midfieldPoints: number;
  forwardPoints: number;
  gradePoints: number;
  goalPoints: number;
  assistPoints: number;
  cleanSheetPoints: number;
  starterPoints: number;
  cardPoints: number;
  yellowRedCards: number;
  redCards: number;
  mvpPoints: number;
  jokerPoints: number;
  players: TeamMatchContributor[];
};

export type TeamDetail = {
  id: string;
  name: string;
  code: string;
  logoUrl: string | null;
  players: TeamDetailPlayer[];
  matches: TeamDetailMatch[];
  externalSources: {
    generatedAt: string;
    ligaInsiderUrl: string;
    transfermarktUrl: string;
    headlines: { source: string; title: string; url: string }[];
  } | null;
};

export type BestElevenPlayer = {
  id: string;
  name: string;
  team: string;
  teamCode: string;
  logoUrl: string | null;
  position: Position;
  points: number;
};

export type BestEleven = {
  scope: "matchday" | "season";
  matchday: number | null;
  formation: string;
  points: number;
  players: BestElevenPlayer[];
};

export type TopPlayerSeason = {
  season: string;
  league: string;
  points: number;
};

export type TopPlayerAnalysis = {
  id: string;
  name: string;
  team: string;
  teamCode: string;
  logoUrl: string | null;
  photoUrl: string | null;
  position: Position;
  priceM: number;
  currentPoints: number | null;
  previousSeason: string | null;
  previousLeague: string | null;
  previousPoints: number | null;
  averagePoints: number | null;
  value: number | null;
  seasons: number;
  trend: "up" | "steady" | "down" | "new";
  trendDelta: number | null;
  signal: string;
  history: TopPlayerSeason[];
};

export type TopPlayers = {
  context: {
    season: string;
    cutoffSeason: string | null;
    playerCount: number;
    currentRound: number;
  };
  positions: Record<Position, TopPlayerAnalysis[]>;
};
