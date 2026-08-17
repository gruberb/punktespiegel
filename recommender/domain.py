"""Spielweite Konstanten, Feature-Namen und Datenklassen des Empfehlungsgenerators."""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Deque, Dict, List, Mapping, Optional, Sequence, Set, Tuple

import numpy as np
from catboost import CatBoostClassifier, CatBoostRegressor


POSITIONS = ("GK", "DEF", "MID", "FWD")
ROSTER_COUNTS = {"GK": 3, "DEF": 7, "MID": 7, "FWD": 5}
CLASSIC_ROSTER_COUNTS = {"GK": 2, "DEF": 5, "MID": 5, "FWD": 3}
CLASSIC_STARTER_COUNTS = {"GK": 1, "DEF": 4, "MID": 4, "FWD": 2}
FORMATIONS = (
    {"GK": 1, "DEF": 3, "MID": 4, "FWD": 3},
    {"GK": 1, "DEF": 3, "MID": 5, "FWD": 2},
    {"GK": 1, "DEF": 4, "MID": 3, "FWD": 3},
    {"GK": 1, "DEF": 4, "MID": 4, "FWD": 2},
    {"GK": 1, "DEF": 4, "MID": 5, "FWD": 1},
    {"GK": 1, "DEF": 5, "MID": 3, "FWD": 2},
    {"GK": 1, "DEF": 5, "MID": 4, "FWD": 1},
)
ROLE_DNP = 0
ROLE_SUB = 1
ROLE_START = 2
ROLE_NAMES = {ROLE_DNP: "dnp", ROLE_SUB: "sub", ROLE_START: "start"}

CATEGORICAL_FEATURES = (
    "league",
    "position",
    "team",
    "opponent",
    "venue",
    "previousSeasonLeague",
)
NUMERIC_FEATURES = (
    "priceM",
    "pricePercentile",
    "active",
    "selectable",
    "roundFraction",
    "leagueStep",
    "currentLeagueAppearances",
    "careerMatches",
    "careerStartRate",
    "careerSubRate",
    "careerStarterMean",
    "careerSubMean",
    "seasonsPlayed",
    "daysSinceAppearance",
    "last3StartRate",
    "last3SubRate",
    "last3AppearanceRate",
    "last3Points",
    "last5StartRate",
    "last5SubRate",
    "last5AppearanceRate",
    "last5Points",
    "last10StartRate",
    "last10SubRate",
    "last10AppearanceRate",
    "last10Points",
    "teamForm",
    "teamGoalDifference",
    "opponentForm",
    "opponentGoalDifference",
)
FEATURE_NAMES = CATEGORICAL_FEATURES + NUMERIC_FEATURES
CAT_FEATURE_INDICES = list(range(len(CATEGORICAL_FEATURES)))


def parse_time(value: Optional[str], fallback_year: int, fallback_round: int) -> datetime:
    if value:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    return datetime(fallback_year, 7, 1, tzinfo=timezone.utc).replace(day=min(28, max(1, fallback_round)))


def rounded(value: float, digits: int = 3) -> float:
    return round(float(value) + 0.0, digits)


def mean(values: Sequence[float], fallback: float = 0.0) -> float:
    return float(sum(values) / len(values)) if values else fallback


def quantile(values: Sequence[float], q: float, fallback: float = 0.0) -> float:
    return float(np.quantile(np.asarray(values, dtype=float), q)) if values else fallback


@dataclass
class PlayerState:
    recent: Deque[Tuple[int, float]] = field(default_factory=lambda: deque(maxlen=10))
    observations: int = 0
    starts: int = 0
    subs: int = 0
    starter_points: float = 0.0
    sub_points: float = 0.0
    seasons: Set[Tuple[int, str]] = field(default_factory=set)
    last_appearance: Optional[datetime] = None
    previous_season_league: str = "none"
    current_season_league: str = "none"
    current_season_year: Optional[int] = None
    current_league_appearances: int = 0

    @property
    def appearances(self) -> int:
        return self.starts + self.subs


@dataclass
class TeamState:
    results: Deque[Tuple[float, float]] = field(default_factory=lambda: deque(maxlen=10))


@dataclass
class Observation:
    features: List[Any]
    year: int
    league: str
    round: int
    player_id: str
    position: str
    team_id: str
    price_m: float
    role: int
    points: float


@dataclass
class Forecast:
    player_id: str
    round: int
    opponent_id: str
    home: bool
    p_start: float
    p_sub: float
    p_dnp: float
    mean_points: float
    p10_points: float
    median_points: float
    p90_points: float
    sub_mean: float
    sub_q10: float
    sub_q50: float
    sub_q90: float
    start_mean: float
    start_q10: float
    start_q50: float
    start_q90: float


@dataclass
class ModelBundle:
    classifier: CatBoostClassifier
    mean_models: Dict[Tuple[str, int], CatBoostRegressor]
    quantile_models: Dict[Tuple[str, int, float], CatBoostRegressor]


@dataclass
class Prior:
    role_probabilities: Dict[int, float]
    conditional_mean: Dict[int, float]
    conditional_quantiles: Dict[Tuple[int, float], float]


@dataclass
class OptimizationResult:
    selected_ids: List[str]
    winter_selected_ids: List[str]
    transfers_out: List[str]
    transfers_in: List[str]
    lineups: Dict[int, List[str]]
    formations: Dict[int, Dict[str, int]]
    objective: float
    solver_status: str
    mip_gap: float


@dataclass
class ClassicOptimizationResult:
    selected_ids: List[str]
    starter_ids: List[str]
    reserve_ids: List[str]
    winter_selected_ids: List[str]
    winter_starter_ids: List[str]
    winter_reserve_ids: List[str]
    transfers_out: List[str]
    transfers_in: List[str]
    reserve_activation: Dict[Tuple[int, str], float]
    objective: float
    solver_status: str
    mip_gap: float
    recourse_summary: Optional[Dict[str, Any]] = None


@dataclass(frozen=True)
class Rules:
    mode: str
    league: str
    season: int
    budget_m: float
    roster_counts: Mapping[str, int]
    starter_counts: Optional[Mapping[str, int]]
    max_from_team: Optional[int]
    transfer_limit: int
    winter_start_round: int
    fixed_classic_slots: bool


SCORING_COMPONENTS = (
    "pointsCleanSheet",
    "pointsGrade",
    "pointsGoals",
    "pointsCards",
    "pointsAssists",
    "pointsStarter",
    "pointsMvp",
    "pointsJoker",
)
