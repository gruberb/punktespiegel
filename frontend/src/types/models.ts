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
  teamId: string;
  name: string;
  team: string;
  teamCode: string;
  logoUrl: string | null;
  photoUrl: string | null;
  position: Position;
  priceM: number;
  roundPoints: number;
  observedPoints: number;
  previousSeasonPoints: number | null;
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
  matchId: string;
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

export type VenueTableRow = {
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
};

export type LeagueStandings = {
  venues: { home: VenueTableRow[]; away: VenueTableRow[] };
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

export type PlayerGame = {
  matchId: string;
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
  bio: ClubSquadMember | null;
  career: PlayerCareer | null;
  seasons: PlayerSeasonSummary[];
  games: PlayerGame[];
  news: PlayerNews;
  availability: PlayerAvailability | null;
};

export type PlayerProfile = Pick<PlayerDetail, "bio" | "career" | "news" | "availability" | "kickerNewsUrl" | "kickerNewsDirect" | "transfermarktUrl" | "ligaInsiderUrl">;
export type PlayerSeasonDetail = Omit<PlayerDetail, keyof PlayerProfile | "seasons">;

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

export type PlayerSeasonSummary = {
  startYear: number;
  season: string;
  league: string;
  teams: { id: string; name: string; code: string; logoUrl: string | null }[];
  appearances: number;
  gradedAppearances: number;
  points: number;
  goals: number;
  assists: number;
};

export type MoneyValue = {
  raw: string;
  eur: number | null;
  kind: "fee" | "free" | "loan" | "loanEnd" | "unknown";
};

export type ClubSquadMember = {
  tmId: number;
  tmUrl: string;
  tmName: string;
  captain: boolean;
  shirtNumber: string | null;
  positionDetail: string | null;
  birthDate: string | null;
  age: number | null;
  nationalities: string[];
  heightCm: number | null;
  foot: string | null;
  joinedAt: string | null;
  previousClub: string | null;
  signingFee: MoneyValue | null;
  contractUntil: string | null;
  marketValue: MoneyValue | null;
};

export type ClubTransfer = {
  tmId: number;
  name: string;
  playerId: string | null;
  position: string | null;
  age: number | null;
  nationalities: string[];
  club: string | null;
  fee: MoneyValue | null;
};

export type ClubCoach = {
  name: string;
  tmUrl: string;
  age: number | null;
  nationalities: string[];
  appointedAt: string | null;
  contractUntil: string | null;
};

export type ClubProfile = {
  generatedAt: string;
  provider: string;
  transfermarktUrl: string;
  coach: ClubCoach | null;
  captainPlayerId: string | null;
  squad: Record<string, ClubSquadMember>;
  arrivals: ClubTransfer[];
  departures: ClubTransfer[];
};

export type PlayerCareerClub = {
  clubId: number;
  name: string;
  tmUrl: string | null;
  appearances: number;
  goals: number;
  assists: number;
};

export type PlayerCareerSeason = {
  clubId: number;
  name: string;
  tmUrl: string | null;
  seasonStartYear: number;
  competitionId: string;
  competition: string;
  competitionUrl: string | null;
  appearances: number;
  goals: number;
  assists: number;
};

export type PlayerCareer = {
  generatedAt: string;
  provider: string;
  tmId: number;
  tmUrl: string;
  clubs: PlayerCareerClub[];
  seasons: PlayerCareerSeason[];
};

export type LikelyElevenPlayer = {
  id: string;
  name: string;
  position: Position;
  photoUrl: string | null;
  starts: number;
  points: number;
  role: "starter" | "alternative" | "squad" | null;
};

export type LikelyEleven = {
  formation: string;
  evaluatedMatches: number;
  source: "seasonStarts" | "roleSnapshot";
  players: LikelyElevenPlayer[];
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
  matchId: string;
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
  startYear: number;
  logoUrl: string | null;
  players: TeamDetailPlayer[];
  matches: TeamDetailMatch[];
  profile: ClubProfile | null;
  likelyEleven: LikelyEleven | null;
  externalSources: {
    generatedAt: string;
    ligaInsiderUrl: string;
    transfermarktUrl: string;
    headlines: { source: string; title: string; url: string }[];
  } | null;
};

export type BestElevenPlayer = {
  id: string;
  teamId: string;
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

export type PlayerHistorySeason = {
  season: string;
  league: string;
  points: number;
};

export type PlayerHistory = {
  averagePoints: number | null;
  value: number | null;
  trendDelta: number | null;
  signal: string;
  history: PlayerHistorySeason[];
};

export type PlayerTableRow = Player & { analysis: PlayerHistory };

// Spieltagstexte, written by the data generator (generator/src/insights.rs).
export type InsightSubject = {
  kind: "team" | "player";
  id: string;
  name: string;
  short?: string;
  imageUrl?: string;
};

export type InsightVisual =
  | { type: "results"; label: string; summary: string; rows: { matchId?: string; opponentId?: string; round: number; outcome: "S" | "U" | "N"; score: string; opponent: string; home: boolean }[] }
  | { type: "roundValues"; label: string; unit: string; summary: string; rows: { matchId?: string; opponentId?: string; round: number; value: number; opponent: string | null }[] }
  | { type: "outcomes"; label: string; values: ("H" | "U" | "A")[]; matches?: { matchId?: string; home: InsightSubject; away: InsightSubject; score: string }[] };

export type InsightCard = {
  id: string;
  kind: string;
  title: string;
  category: string;
  question: string;
  answer: string;
  detailLabel: string;
  detail: string;
  visual: InsightVisual;
  subject?: InsightSubject;
};

export type InsightFact = {
  id: string;
  kind: string;
  title: string;
  value: string;
  context: string;
  tone: "" | "up" | "down";
  text: string;
  subjects?: InsightSubject[];
};

export type RoundInsights = {
  round: number;
  cards: InsightCard[];
  facts: InsightFact[];
};

export type MatchPlayer = {
  id: string;
  name: string;
  photoUrl: string | null;
  position: Position;
  grade: number | null;
  goals: number;
  assists: number;
  points: number;
  starter: boolean;
  mvp: boolean;
  card: "Gelb-Rot" | "Rot" | null;
};

export type MatchSide = {
  team: LeagueTableTeam;
  rankAfter: number | null;
  averageGrade: number | null;
  points: number;
  players: MatchPlayer[];
};

export type MatchDetail = {
  id: string;
  league: string;
  leagueName: string;
  season: string;
  round: number;
  scheduledAt: string | null;
  homeScore: number | null;
  awayScore: number | null;
  home: MatchSide;
  away: MatchSide;
  mvp: (MatchPlayer & { team: LeagueTableTeam }) | null;
  roundMatches: { id: string; scheduledAt: string | null; home: LeagueTableTeam; away: LeagueTableTeam; homeScore: number | null; awayScore: number | null }[];
};
