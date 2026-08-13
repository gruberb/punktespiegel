#!/usr/bin/env python3
"""Build offline Classic and Interactive recommendation artifacts.

The browser remains static. This offline job reads the generated season JSON,
trains role-conditioned CatBoost models, runs time-ordered validation, and solves
multi-matchday mixed-integer roster problems. Historical market snapshots are
required before a run may be described as leakage-safe.
"""

from __future__ import annotations

import argparse
import json
import math
import subprocess
import sys
from collections import defaultdict, deque
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Deque, Dict, List, Mapping, MutableMapping, Optional, Sequence, Set, Tuple

import highspy
import numpy as np
from catboost import CatBoostClassifier, CatBoostRegressor


ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "frontend" / "public" / "data"
SEASON_DIR = DATA_DIR / "seasons"
RECOMMENDATION_DIR = DATA_DIR / "recommendations"
ROLE_SIGNAL_PATH = DATA_DIR / "current-role-signals.json"
AVAILABILITY_SIGNAL_PATH = DATA_DIR / "current-availability-signals.json"

POSITIONS = ("GK", "DEF", "MID", "FWD")
ROSTER_COUNTS = {"GK": 3, "DEF": 7, "MID": 7, "FWD": 5}
CLASSIC_ROSTER_COUNTS = {"GK": 2, "DEF": 5, "MID": 5, "FWD": 3}
CLASSIC_STARTER_COUNTS = {"GK": 1, "DEF": 4, "MID": 4, "FWD": 2}
CLASSIC_BUDGETS = {"0001": 30.0, "0002": 7.5, "0003": 4.0}
WINTER_START_ROUNDS = {"0001": 15, "0002": 17, "0003": 19}
FORMATIONS = (
    {"GK": 1, "DEF": 3, "MID": 4, "FWD": 3},
    {"GK": 1, "DEF": 3, "MID": 5, "FWD": 2},
    {"GK": 1, "DEF": 4, "MID": 3, "FWD": 3},
    {"GK": 1, "DEF": 4, "MID": 4, "FWD": 2},
    {"GK": 1, "DEF": 4, "MID": 5, "FWD": 1},
    {"GK": 1, "DEF": 5, "MID": 3, "FWD": 2},
    {"GK": 1, "DEF": 5, "MID": 4, "FWD": 1},
)
BUDGETS = {"0001": 42.5, "0002": 10.0, "0003": 6.0}
LEAGUE_LEVELS = {"0001": 1, "0002": 2, "0003": 3}
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


def rules_for(season: Mapping[str, Any], mode: str) -> Rules:
    league = str(season["leagueCode"])
    start_year = int(season["startYear"])
    round_count = int(season["roundCount"])
    if mode == "classic":
        return Rules(
            mode=mode,
            league=league,
            season=start_year,
            budget_m=CLASSIC_BUDGETS[league],
            roster_counts=CLASSIC_ROSTER_COUNTS,
            starter_counts=CLASSIC_STARTER_COUNTS,
            max_from_team=3,
            transfer_limit=3,
            winter_start_round=WINTER_START_ROUNDS.get(league, round_count // 2 + 1),
            fixed_classic_slots=True,
        )
    if mode == "interactive":
        return Rules(
            mode=mode,
            league=league,
            season=start_year,
            budget_m=BUDGETS[league],
            roster_counts=ROSTER_COUNTS,
            starter_counts=None,
            max_from_team=None,
            transfer_limit=4 if start_year >= 2026 else 3,
            winter_start_round=WINTER_START_ROUNDS.get(league, round_count // 2 + 1),
            fixed_classic_slots=False,
        )
    raise ValueError(f"Unbekannter Manager-Modus: {mode}")


def winter_start_round(league: str, round_count: int) -> int:
    return WINTER_START_ROUNDS.get(league, round_count // 2 + 1)


def load_json(path: Path) -> Dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def load_data() -> Tuple[Dict[str, Any], List[Dict[str, Any]]]:
    catalog = load_json(DATA_DIR / "catalog.json")
    seasons = [load_json(path) for path in sorted(SEASON_DIR.glob("se-k*.json"))]
    if not seasons:
        raise RuntimeError("Keine Saisonartefakte gefunden.")
    for season in seasons:
        validate_score_contract(season)
    return catalog, seasons


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


def validate_score_contract(season: Mapping[str, Any]) -> None:
    scores = list(season.get("scores", []))
    if not scores:
        return
    required = {"matchId", "playerId", "teamId", "totalPoints", *SCORING_COMPONENTS}
    roles: Set[int] = set()
    dnp_count = 0
    rows_by_match: Dict[str, int] = defaultdict(int)
    rows_by_match_team: Dict[Tuple[str, str], int] = defaultdict(int)
    for index, score in enumerate(scores):
        missing = sorted(required.difference(score))
        if missing:
            raise RuntimeError(f"{season['id']}: Score-Zeile {index} fehlt {', '.join(missing)}.")
        normalized_total = sum(int(score[field] or 0) for field in SCORING_COMPONENTS)
        if normalized_total != int(score["totalPoints"]):
            raise RuntimeError(
                f"{season['id']}: totalPoints ist nicht aus den aktuellen Komponenten normalisiert "
                f"({score['playerId']} / {score['matchId']})."
            )
        role = score_role(score)
        roles.add(role)
        dnp_count += int(role == ROLE_DNP)
        rows_by_match[str(score["matchId"])] += 1
        rows_by_match_team[(str(score["matchId"]), str(score["teamId"]))] += 1
    if roles != {ROLE_DNP, ROLE_SUB, ROLE_START}:
        raise RuntimeError(f"{season['id']}: unvollständige Rollenklassen {sorted(roles)}.")
    dnp_prevalence = dnp_count / len(scores)
    if not 0.10 <= dnp_prevalence <= 0.80:
        raise RuntimeError(f"{season['id']}: unplausible DNP-Quote {dnp_prevalence:.1%}.")
    if rows_by_match and min(rows_by_match.values()) < 25:
        raise RuntimeError(f"{season['id']}: mindestens ein Spiel enthält weniger als 25 Spielerbeobachtungen.")
    for match in season["matches"]:
        match_id = str(match["id"])
        if match_id not in rows_by_match:
            continue
        for team_id in (str(match["homeTeamId"]), str(match["awayTeamId"])):
            # Historical 3. Liga artifacts can reconstruct affiliations from
            # appearances and therefore contain fewer inactive squad members.
            if rows_by_match_team[(match_id, team_id)] < 8:
                raise RuntimeError(
                    f"{season['id']}: {match_id}/{team_id} enthält weniger als acht Rollenbeobachtungen."
                )


def price_percentiles(season: Mapping[str, Any]) -> Dict[str, float]:
    result: Dict[str, float] = {}
    for position in POSITIONS:
        players = [
            player
            for player in season["players"]
            if player["position"] == position and 0 <= float(player["priceM"]) < 999
        ]
        ordered_prices = sorted(float(player["priceM"]) for player in players)
        denominator = max(1, len(ordered_prices) - 1)
        first_rank = {price: ordered_prices.index(price) for price in set(ordered_prices)}
        last_rank = {price: len(ordered_prices) - 1 - ordered_prices[::-1].index(price) for price in set(ordered_prices)}
        for player in players:
            price = float(player["priceM"])
            result[player["id"]] = ((first_rank[price] + last_rank[price]) / 2) / denominator
    return result


def recent_rates(state: PlayerState, window: int) -> Tuple[float, float, float, float]:
    history = list(state.recent)[-window:]
    if not history:
        return 0.0, 0.0, 0.0, 0.0
    denominator = float(len(history))
    return (
        sum(role == ROLE_START for role, _ in history) / denominator,
        sum(role == ROLE_SUB for role, _ in history) / denominator,
        sum(role != ROLE_DNP for role, _ in history) / denominator,
        mean([points for _, points in history]),
    )


def team_rates(state: TeamState) -> Tuple[float, float]:
    if not state.results:
        return 1.35, 0.0
    return mean([points for points, _ in state.results]), mean([goal_diff for _, goal_diff in state.results])


def previous_league_for_season(state: PlayerState, season_year: int, fallback: str) -> str:
    if state.current_season_year == season_year:
        value = state.previous_season_league
    else:
        value = state.current_season_league
    return fallback if value == "none" else value


def feature_vector(
    *,
    league: str,
    position: str,
    team_id: str,
    opponent_id: str,
    home: bool,
    price_m: float,
    price_percentile: float,
    active: bool,
    selectable: bool,
    round_number: int,
    round_count: int,
    season_year: int,
    as_of: datetime,
    player_state: PlayerState,
    team_state: TeamState,
    opponent_state: TeamState,
) -> List[Any]:
    if player_state.current_season_year == season_year:
        current_league_appearances = player_state.current_league_appearances
    else:
        current_league_appearances = 0
    previous_league = previous_league_for_season(player_state, season_year, league)
    current_level = LEAGUE_LEVELS.get(league, 3)
    previous_level = LEAGUE_LEVELS.get(previous_league, current_level)
    days_since = 365.0
    if player_state.last_appearance is not None:
        days_since = min(365.0, max(0.0, (as_of - player_state.last_appearance).total_seconds() / 86400.0))
    career_matches = max(1, player_state.observations)
    career_appearances = player_state.appearances
    team_form, team_goal_difference = team_rates(team_state)
    opponent_form, opponent_goal_difference = team_rates(opponent_state)
    numeric = [
        price_m,
        price_percentile,
        float(active),
        float(selectable),
        round_number / max(1, round_count),
        float(previous_level - current_level),
        float(current_league_appearances),
        float(career_appearances),
        player_state.starts / career_matches,
        player_state.subs / career_matches,
        player_state.starter_points / max(1, player_state.starts),
        player_state.sub_points / max(1, player_state.subs),
        float(len(player_state.seasons)),
        days_since,
    ]
    for window in (3, 5, 10):
        numeric.extend(recent_rates(player_state, window))
    numeric.extend((team_form, team_goal_difference, opponent_form, opponent_goal_difference))
    categorical = [league, position, team_id, opponent_id, "home" if home else "away", previous_league]
    if len(categorical) + len(numeric) != len(FEATURE_NAMES):
        raise AssertionError("Interner Fehler im Feature-Vertrag.")
    return categorical + numeric


def score_role(score: Mapping[str, Any]) -> int:
    if int(score.get("pointsStarter", 0)) > 0:
        return ROLE_START
    if int(score.get("pointsJoker", 0)) > 0:
        return ROLE_SUB
    return ROLE_DNP


def update_player_state(
    state: PlayerState,
    role: int,
    points: float,
    played_at: datetime,
    year: int,
    league: str,
) -> None:
    if state.current_season_year != year:
        state.previous_season_league = state.current_season_league
        state.current_season_league = league
        state.current_season_year = year
        state.current_league_appearances = 0
    elif state.current_season_league != league:
        state.current_season_league = league
        state.current_league_appearances = 0
    state.recent.append((role, points))
    state.observations += 1
    if role == ROLE_START:
        state.starts += 1
        state.starter_points += points
    elif role == ROLE_SUB:
        state.subs += 1
        state.sub_points += points
    if role != ROLE_DNP:
        state.last_appearance = played_at
        state.seasons.add((year, league))
        state.current_league_appearances += 1


def update_team_states(match: Mapping[str, Any], team_states: MutableMapping[str, TeamState]) -> None:
    home_score = match.get("homeScore")
    away_score = match.get("awayScore")
    if home_score is None or away_score is None:
        return
    home_score = float(home_score)
    away_score = float(away_score)
    if home_score > away_score:
        home_points, away_points = 3.0, 0.0
    elif home_score < away_score:
        home_points, away_points = 0.0, 3.0
    else:
        home_points = away_points = 1.0
    team_states[match["homeTeamId"]].results.append((home_points, home_score - away_score))
    team_states[match["awayTeamId"]].results.append((away_points, away_score - home_score))


def build_training_dataset(
    seasons: Sequence[Mapping[str, Any]],
    cutoff_year: int,
) -> Tuple[List[Observation], Dict[str, PlayerState], Dict[str, TeamState]]:
    player_states: Dict[str, PlayerState] = defaultdict(PlayerState)
    team_states: Dict[str, TeamState] = defaultdict(TeamState)
    events: List[Tuple[datetime, int, str, Mapping[str, Any], Mapping[str, Any], List[Mapping[str, Any]], Dict[str, Any], Dict[str, float]]] = []
    for season in seasons:
        year = int(season["startYear"])
        if year >= cutoff_year:
            continue
        players = {player["id"]: player for player in season["players"]}
        scores_by_match: Dict[str, List[Mapping[str, Any]]] = defaultdict(list)
        for score in season["scores"]:
            scores_by_match[score["matchId"]].append(score)
        percentiles = price_percentiles(season)
        for match in season["matches"]:
            scores = scores_by_match.get(match["id"], [])
            if not scores:
                continue
            played_at = parse_time(match.get("scheduledAt"), year, int(match["round"]))
            events.append((played_at, year, season["leagueCode"], season, match, scores, players, percentiles))
    events.sort(key=lambda item: (item[0], item[1], item[2], item[4]["id"]))

    observations: List[Observation] = []
    for played_at, year, league, season, match, scores, players, percentiles in events:
        for score in scores:
            player = players.get(score["playerId"])
            if player is None or player.get("position") not in POSITIONS:
                continue
            team_id = score.get("teamId") or player["teamId"]
            if team_id == match["homeTeamId"]:
                opponent_id = match["awayTeamId"]
                home = True
            elif team_id == match["awayTeamId"]:
                opponent_id = match["homeTeamId"]
                home = False
            else:
                continue
            features = feature_vector(
                league=league,
                position=player["position"],
                team_id=team_id,
                opponent_id=opponent_id,
                home=home,
                price_m=float(player["priceM"]),
                price_percentile=percentiles.get(player["id"], 0.5),
                active=bool(player.get("active", True)),
                selectable=bool(player.get("selectable", True)),
                round_number=int(match["round"]),
                round_count=int(season["roundCount"]),
                season_year=year,
                as_of=played_at,
                player_state=player_states[player["id"]],
                team_state=team_states[team_id],
                opponent_state=team_states[opponent_id],
            )
            observations.append(
                Observation(
                    features=features,
                    year=year,
                    league=league,
                    round=int(match["round"]),
                    player_id=player["id"],
                    position=player["position"],
                    team_id=team_id,
                    price_m=float(player["priceM"]),
                    role=score_role(score),
                    points=float(score["totalPoints"]),
                )
            )
        for score in scores:
            if score["playerId"] not in players:
                continue
            update_player_state(
                player_states[score["playerId"]],
                score_role(score),
                float(score["totalPoints"]),
                played_at,
                year,
                league,
            )
        update_team_states(match, team_states)
    return observations, dict(player_states), dict(team_states)


def replay_history_as_of(
    seasons: Sequence[Mapping[str, Any]],
    target_season: Mapping[str, Any],
    through_round: int,
) -> Tuple[Dict[str, PlayerState], Dict[str, TeamState]]:
    """Build decision-time states without fitting on current-season outcomes."""
    target_year = int(target_season["startYear"])
    _, prior_player_states, prior_team_states = build_training_dataset(seasons, target_year)
    player_states: MutableMapping[str, PlayerState] = defaultdict(PlayerState, prior_player_states)
    team_states: MutableMapping[str, TeamState] = defaultdict(TeamState, prior_team_states)
    players = {player["id"]: player for player in target_season["players"]}
    scores_by_match: Dict[str, List[Mapping[str, Any]]] = defaultdict(list)
    for score in target_season.get("scores", []):
        scores_by_match[str(score["matchId"])].append(score)
    matches = sorted(
        (
            match
            for match in target_season["matches"]
            if int(match["round"]) <= through_round and scores_by_match.get(str(match["id"]))
        ),
        key=lambda match: (
            parse_time(match.get("scheduledAt"), target_year, int(match["round"])),
            str(match["id"]),
        ),
    )
    for match in matches:
        played_at = parse_time(match.get("scheduledAt"), target_year, int(match["round"]))
        for score in scores_by_match[str(match["id"])]:
            if score["playerId"] not in players:
                continue
            update_player_state(
                player_states[score["playerId"]],
                score_role(score),
                float(score["totalPoints"]),
                played_at,
                target_year,
                str(target_season["leagueCode"]),
            )
        update_team_states(match, team_states)
    return dict(player_states), dict(team_states)


def decision_time(season: Mapping[str, Any], through_round: int) -> datetime:
    matches = [
        match
        for match in season["matches"]
        if match.get("scheduledAt") and int(match["round"]) <= through_round
    ]
    if matches:
        return max(parse_time(match["scheduledAt"], int(season["startYear"]), int(match["round"])) for match in matches)
    first_match = min(
        (match for match in season["matches"] if match.get("scheduledAt")),
        key=lambda match: parse_time(match["scheduledAt"], int(season["startYear"]), int(match["round"])),
        default=None,
    )
    if first_match is not None:
        return parse_time(first_match["scheduledAt"], int(season["startYear"]), 1) - timedelta(seconds=1)
    return parse_time(season.get("generatedAt"), int(season["startYear"]), 1)


def matrix(rows: Sequence[Observation]) -> List[List[Any]]:
    return [row.features for row in rows]


def catboost_common(iterations: int) -> Dict[str, Any]:
    return {
        "iterations": iterations,
        "depth": 6,
        "learning_rate": 0.07,
        "l2_leaf_reg": 7.0,
        "random_seed": 42,
        "thread_count": -1,
        "allow_writing_files": False,
        "verbose": False,
    }


def fit_models(rows: Sequence[Observation], iterations: int) -> ModelBundle:
    if not rows:
        raise RuntimeError("Keine Trainingsbeobachtungen vorhanden.")
    features = matrix(rows)
    classifier = CatBoostClassifier(loss_function="MultiClass", **catboost_common(iterations))
    classifier.fit(features, [row.role for row in rows], cat_features=CAT_FEATURE_INDICES)
    mean_models: Dict[Tuple[str, int], CatBoostRegressor] = {}
    quantile_models: Dict[Tuple[str, int, float], CatBoostRegressor] = {}
    for position in POSITIONS:
        for role in (ROLE_SUB, ROLE_START):
            subset = [row for row in rows if row.position == position and row.role == role]
            if len(subset) < 5:
                raise RuntimeError(f"Zu wenige Trainingszeilen für {position}/{ROLE_NAMES[role]}.")
            subset_features = matrix(subset)
            targets = [row.points for row in subset]
            regressor = CatBoostRegressor(loss_function="RMSE", **catboost_common(iterations))
            regressor.fit(subset_features, targets, cat_features=CAT_FEATURE_INDICES)
            mean_models[(position, role)] = regressor
            for alpha in (0.1, 0.5, 0.9):
                quantile_regressor = CatBoostRegressor(
                    loss_function=f"Quantile:alpha={alpha}",
                    **catboost_common(max(30, iterations // 2)),
                )
                quantile_regressor.fit(subset_features, targets, cat_features=CAT_FEATURE_INDICES)
                quantile_models[(position, role, alpha)] = quantile_regressor
    return ModelBundle(classifier, mean_models, quantile_models)


def price_bucket(feature_values: Sequence[Any]) -> int:
    percentile = float(feature_values[len(CATEGORICAL_FEATURES) + 1])
    return min(3, max(0, int(percentile * 4)))


def build_priors(rows: Sequence[Observation]) -> Dict[Tuple[str, str, int], Prior]:
    grouped: Dict[Tuple[str, str, int], List[Observation]] = defaultdict(list)
    broad: Dict[Tuple[str, str], List[Observation]] = defaultdict(list)
    for row in rows:
        grouped[(row.league, row.position, price_bucket(row.features))].append(row)
        broad[(row.league, row.position)].append(row)
    result: Dict[Tuple[str, str, int], Prior] = {}
    for key, values in grouped.items():
        source = values if len(values) >= 80 else broad[(key[0], key[1])]
        role_probabilities = {
            role: (sum(row.role == role for row in source) + 2.0) / (len(source) + 6.0)
            for role in (ROLE_DNP, ROLE_SUB, ROLE_START)
        }
        conditional_mean: Dict[int, float] = {}
        conditional_quantiles: Dict[Tuple[int, float], float] = {}
        for role in (ROLE_SUB, ROLE_START):
            points = [row.points for row in source if row.role == role]
            conditional_mean[role] = mean(points, 2.0 if role == ROLE_SUB else 4.0)
            for alpha in (0.1, 0.5, 0.9):
                conditional_quantiles[(role, alpha)] = quantile(
                    points,
                    alpha,
                    2.0 if role == ROLE_SUB else 4.0,
                )
        result[key] = Prior(role_probabilities, conditional_mean, conditional_quantiles)
    return result


def target_feature_rows(
    season: Mapping[str, Any],
    player_states: Mapping[str, PlayerState],
    team_states: Mapping[str, TeamState],
    *,
    forecast_rounds: Optional[Sequence[int]] = None,
    as_of: Optional[datetime] = None,
    include_player_ids: Optional[Set[str]] = None,
) -> Tuple[Dict[str, Dict[str, Any]], List[Tuple[str, int, str, bool, List[Any]]]]:
    include_player_ids = include_player_ids or set()
    players = {
        player["id"]: player
        for player in season["players"]
        if (player["id"] in include_player_ids or (player.get("active") and player.get("selectable")))
        and 0 <= float(player["priceM"]) < 999
        and float(player["priceM"]) <= BUDGETS[season["leagueCode"]]
    }
    fixtures: Dict[Tuple[str, int], Tuple[str, bool]] = {}
    for match in season["matches"]:
        round_number = int(match["round"])
        fixtures[(match["homeTeamId"], round_number)] = (match["awayTeamId"], True)
        fixtures[(match["awayTeamId"], round_number)] = (match["homeTeamId"], False)
    percentiles = price_percentiles(season)
    forecast_round_set = set(forecast_rounds or range(1, int(season["roundCount"]) + 1))
    forecast_as_of = as_of or decision_time(season, 0)
    rows: List[Tuple[str, int, str, bool, List[Any]]] = []
    empty_player_state = PlayerState()
    empty_team_state = TeamState()
    for player in players.values():
        state = player_states.get(player["id"], empty_player_state)
        for round_number in sorted(forecast_round_set):
            fixture = fixtures.get((player["teamId"], round_number))
            if fixture is None:
                continue
            opponent_id, home = fixture
            features = feature_vector(
                league=season["leagueCode"],
                position=player["position"],
                team_id=player["teamId"],
                opponent_id=opponent_id,
                home=home,
                price_m=float(player["priceM"]),
                price_percentile=percentiles.get(player["id"], 0.5),
                active=bool(player.get("active", True)),
                selectable=bool(player.get("selectable", True)),
                round_number=round_number,
                round_count=int(season["roundCount"]),
                season_year=int(season["startYear"]),
                as_of=forecast_as_of,
                player_state=state,
                team_state=team_states.get(player["teamId"], empty_team_state),
                opponent_state=team_states.get(opponent_id, empty_team_state),
            )
            rows.append((player["id"], round_number, opponent_id, home, features))
    return players, rows


def weighted_quantile_atoms(atoms: Sequence[Tuple[float, float]], q: float) -> float:
    ordered = sorted(atoms, key=lambda item: item[0])
    cumulative = 0.0
    for value, weight in ordered:
        cumulative += weight
        if cumulative >= q - 1e-12:
            return value
    return ordered[-1][0] if ordered else 0.0


def role_conditioned_forecast(
    forecast: Forecast,
    *,
    p_start: Optional[float] = None,
    p_sub: Optional[float] = None,
    p_dnp: Optional[float] = None,
    sub_mean: Optional[float] = None,
    sub_quantiles: Optional[Sequence[float]] = None,
    start_mean: Optional[float] = None,
    start_quantiles: Optional[Sequence[float]] = None,
) -> Forecast:
    """Rebuild an unconditional forecast from role probabilities and conditional points."""
    probabilities = {
        ROLE_START: forecast.p_start if p_start is None else p_start,
        ROLE_SUB: forecast.p_sub if p_sub is None else p_sub,
        ROLE_DNP: forecast.p_dnp if p_dnp is None else p_dnp,
    }
    total = sum(max(0.0, value) for value in probabilities.values())
    if total <= 0:
        raise RuntimeError(f"Ungültige Rollenwahrscheinlichkeiten für {forecast.player_id}.")
    probabilities = {role: max(0.0, value) / total for role, value in probabilities.items()}
    resolved_sub_mean = forecast.sub_mean if sub_mean is None else sub_mean
    resolved_start_mean = forecast.start_mean if start_mean is None else start_mean
    resolved_sub = tuple(sub_quantiles or (forecast.sub_q10, forecast.sub_q50, forecast.sub_q90))
    resolved_start = tuple(start_quantiles or (forecast.start_q10, forecast.start_q50, forecast.start_q90))
    if len(resolved_sub) != 3 or len(resolved_start) != 3:
        raise RuntimeError("Bedingte Quantile müssen jeweils drei Werte enthalten.")
    resolved_sub = tuple(sorted(float(value) for value in resolved_sub))
    resolved_start = tuple(sorted(float(value) for value in resolved_start))
    mean_points = (
        probabilities[ROLE_START] * resolved_start_mean
        + probabilities[ROLE_SUB] * resolved_sub_mean
    )
    atoms = [(0.0, probabilities[ROLE_DNP])]
    for probability, values in (
        (probabilities[ROLE_SUB], resolved_sub),
        (probabilities[ROLE_START], resolved_start),
    ):
        atoms.extend(
            (
                (values[0], probability * 0.2),
                (values[1], probability * 0.6),
                (values[2], probability * 0.2),
            )
        )
    return Forecast(
        player_id=forecast.player_id,
        round=forecast.round,
        opponent_id=forecast.opponent_id,
        home=forecast.home,
        p_start=probabilities[ROLE_START],
        p_sub=probabilities[ROLE_SUB],
        p_dnp=probabilities[ROLE_DNP],
        mean_points=mean_points,
        p10_points=weighted_quantile_atoms(atoms, 0.1),
        median_points=weighted_quantile_atoms(atoms, 0.5),
        p90_points=weighted_quantile_atoms(atoms, 0.9),
        sub_mean=resolved_sub_mean,
        sub_q10=resolved_sub[0],
        sub_q50=resolved_sub[1],
        sub_q90=resolved_sub[2],
        start_mean=resolved_start_mean,
        start_q10=resolved_start[0],
        start_q50=resolved_start[1],
        start_q90=resolved_start[2],
    )


def load_current_role_signals(season: Mapping[str, Any]) -> Optional[Mapping[str, Any]]:
    if not ROLE_SIGNAL_PATH.exists():
        return None
    artifact = json.loads(ROLE_SIGNAL_PATH.read_text(encoding="utf-8"))
    if (
        int(artifact.get("schemaVersion", 0)) != 1
        or str(artifact.get("league")) != str(season["leagueCode"])
        or int(artifact.get("season", -1)) != int(season["startYear"])
    ):
        return None
    covered_teams = set(artifact.get("teams", {}))
    if covered_teams != {str(team["id"]) for team in season["teams"]}:
        raise RuntimeError("Aktuelle Rollensignale decken nicht alle Vereine der Zielsaison ab.")
    return artifact


def apply_current_role_signals(
    season: Mapping[str, Any],
    players: Mapping[str, Mapping[str, Any]],
    forecasts: Sequence[Forecast],
    artifact: Optional[Mapping[str, Any]],
) -> List[Forecast]:
    """Anchor production availability to a dated external squad-hierarchy snapshot."""
    if artifact is None:
        return list(forecasts)
    player_signals = artifact.get("players", {})
    covered_teams = set(artifact.get("teams", {}))
    outfield_targets = {
        "starter": (0.72, 0.12, 0.16),
        "alternative": (0.25, 0.30, 0.45),
        "squad": (0.08, 0.18, 0.74),
    }
    goalkeeper_targets = {
        "starter": (0.82, 0.01, 0.17),
        "alternative": (0.18, 0.02, 0.80),
        "squad": (0.03, 0.02, 0.95),
    }
    source_weight = 0.75
    adjusted: List[Forecast] = []
    for forecast in forecasts:
        player = players[forecast.player_id]
        signal = player_signals.get(forecast.player_id)
        if signal is not None:
            role = str(signal["role"])
        elif str(player["teamId"]) in covered_teams:
            role = "squad"
        else:
            adjusted.append(forecast)
            continue
        targets = goalkeeper_targets if player["position"] == "GK" else outfield_targets
        target_start, target_sub, target_dnp = targets[role]
        adjusted.append(role_conditioned_forecast(
            forecast,
            p_start=(1.0 - source_weight) * forecast.p_start + source_weight * target_start,
            p_sub=(1.0 - source_weight) * forecast.p_sub + source_weight * target_sub,
            p_dnp=(1.0 - source_weight) * forecast.p_dnp + source_weight * target_dnp,
        ))
    return adjusted


def load_current_availability_signals(season: Mapping[str, Any]) -> Mapping[str, Any]:
    if not AVAILABILITY_SIGNAL_PATH.exists():
        raise RuntimeError("Aktuelle medizinische Verfügbarkeitssignale fehlen.")
    artifact = json.loads(AVAILABILITY_SIGNAL_PATH.read_text(encoding="utf-8"))
    if (
        int(artifact.get("schemaVersion", 0)) != 1
        or int(artifact.get("season", -1)) != int(season["startYear"])
    ):
        raise RuntimeError("Aktuelle medizinische Verfügbarkeitssignale passen nicht zur Zielsaison.")
    league = artifact.get("leagues", {}).get(str(season["leagueCode"]))
    if not league or not league.get("players"):
        raise RuntimeError(
            f"Aktuelle medizinische Verfügbarkeitssignale fehlen für Liga {season['leagueCode']}."
        )
    return {
        **league,
        "generatedAt": artifact["generatedAt"],
        "policy": artifact["policy"],
    }


def availability_excluded_player_ids(artifact: Mapping[str, Any]) -> Set[str]:
    opening_ineligible = {"injured", "rehab", "not_considered", "unavailable"}
    return {
        str(player_id)
        for player_id, signal in artifact.get("players", {}).items()
        if str(signal.get("status")) in opening_ineligible
    }


def apply_current_availability_signals(
    forecasts: Sequence[Forecast],
    artifact: Mapping[str, Any],
) -> List[Forecast]:
    """Apply short matchday-specific absences before blocked players are removed."""
    suspended_ids = {
        str(player_id)
        for player_id, signal in artifact.get("players", {}).items()
        if str(signal.get("status")) == "suspended"
    }
    first_round = {
        player_id: min(
            forecast.round for forecast in forecasts if forecast.player_id == player_id
        )
        for player_id in suspended_ids
        if any(forecast.player_id == player_id for forecast in forecasts)
    }
    return [
        role_conditioned_forecast(forecast, p_start=0.0, p_sub=0.0, p_dnp=1.0)
        if forecast.player_id in first_round and forecast.round == first_round[forecast.player_id]
        else forecast
        for forecast in forecasts
    ]


def build_availability_audit(
    season: Mapping[str, Any],
    players: Mapping[str, Mapping[str, Any]],
    artifact: Mapping[str, Any],
) -> Dict[str, Any]:
    teams = {str(team["id"]): team for team in season["teams"]}
    excluded_ids = availability_excluded_player_ids(artifact).intersection(players)
    excluded_players = []
    for player_id in sorted(excluded_ids, key=lambda value: str(players[value]["name"])):
        player = players[player_id]
        signal = artifact["players"][player_id]
        excluded_players.append({
            "id": player_id,
            "name": player["name"],
            "team": teams[str(player["teamId"])]["name"],
            "position": player["position"],
            "status": signal["status"],
            "reason": signal.get("reason"),
            "expectedReturn": signal.get("expectedReturn"),
            "source": signal["source"],
            "sourceUrl": signal["sourceUrl"],
        })
    return {
        "generatedAt": artifact["generatedAt"],
        "provider": artifact["provider"],
        "sourceUrl": artifact["sourceUrl"],
        "policy": (
            "Aktuell verletzte, im Aufbautraining befindliche oder nicht berücksichtigte Spieler "
            "sind für den Eröffnungskader und die vorab simulierte Winterphase gesperrt. "
            "Sperren werden spieltagsspezifisch berücksichtigt."
        ),
        "checkedPlayerCount": len(players),
        "excludedPlayerCount": len(excluded_players),
        "unmatchedSourcePlayers": artifact.get("unmatchedPlayers", []),
        "excludedPlayers": excluded_players,
    }


def predict_forecasts(
    season: Mapping[str, Any],
    bundle: ModelBundle,
    priors: Mapping[Tuple[str, str, int], Prior],
    player_states: Mapping[str, PlayerState],
    team_states: Mapping[str, TeamState],
    *,
    forecast_rounds: Optional[Sequence[int]] = None,
    as_of: Optional[datetime] = None,
    include_player_ids: Optional[Set[str]] = None,
) -> Tuple[Dict[str, Dict[str, Any]], List[Forecast]]:
    players, target_rows = target_feature_rows(
        season,
        player_states,
        team_states,
        forecast_rounds=forecast_rounds,
        as_of=as_of,
        include_player_ids=include_player_ids,
    )
    feature_rows = [row[4] for row in target_rows]
    role_matrix = np.asarray(bundle.classifier.predict_proba(feature_rows), dtype=float)
    class_indices = {int(label): index for index, label in enumerate(bundle.classifier.classes_)}
    predictions: Dict[Tuple[str, int], Dict[str, np.ndarray]] = {}
    for position in POSITIONS:
        indices = [index for index, row in enumerate(target_rows) if players[row[0]]["position"] == position]
        if not indices:
            continue
        subset = [feature_rows[index] for index in indices]
        for role in (ROLE_SUB, ROLE_START):
            predictions[(position, role)] = {
                "indices": np.asarray(indices, dtype=int),
                "mean": np.asarray(bundle.mean_models[(position, role)].predict(subset), dtype=float),
                "q10": np.asarray(bundle.quantile_models[(position, role, 0.1)].predict(subset), dtype=float),
                "q50": np.asarray(bundle.quantile_models[(position, role, 0.5)].predict(subset), dtype=float),
                "q90": np.asarray(bundle.quantile_models[(position, role, 0.9)].predict(subset), dtype=float),
            }
    point_predictions: Dict[Tuple[int, int], Dict[str, float]] = {}
    for key, values in predictions.items():
        for local_index, global_index in enumerate(values["indices"]):
            point_predictions[(int(global_index), key[1])] = {
                "mean": float(values["mean"][local_index]),
                "q10": float(values["q10"][local_index]),
                "q50": float(values["q50"][local_index]),
                "q90": float(values["q90"][local_index]),
            }

    forecasts: List[Forecast] = []
    for index, (player_id, round_number, opponent_id, home, features) in enumerate(target_rows):
        player = players[player_id]
        state = player_states.get(player_id, PlayerState())
        prior_key = (season["leagueCode"], player["position"], price_bucket(features))
        prior = priors.get(prior_key)
        if prior is None:
            matching = [value for key, value in priors.items() if key[:2] == prior_key[:2]]
            if not matching:
                raise RuntimeError(f"Kein Prior für {prior_key} gefunden.")
            prior = matching[0]
        reliability = min(0.94, state.appearances / (state.appearances + 14.0))
        probabilities = {
            role: reliability * role_matrix[index, class_indices[role]]
            + (1.0 - reliability) * prior.role_probabilities[role]
            for role in (ROLE_DNP, ROLE_SUB, ROLE_START)
        }
        probability_total = sum(probabilities.values())
        probabilities = {role: value / probability_total for role, value in probabilities.items()}
        conditional: Dict[Tuple[int, str], float] = {}
        for role in (ROLE_SUB, ROLE_START):
            model_values = point_predictions[(index, role)]
            conditional[(role, "mean")] = reliability * model_values["mean"] + (1.0 - reliability) * prior.conditional_mean[role]
            for label, alpha in (("q10", 0.1), ("q50", 0.5), ("q90", 0.9)):
                conditional[(role, label)] = reliability * model_values[label] + (1.0 - reliability) * prior.conditional_quantiles[(role, alpha)]
            ordered = sorted(conditional[(role, label)] for label in ("q10", "q50", "q90"))
            conditional[(role, "q10")], conditional[(role, "q50")], conditional[(role, "q90")] = ordered
        mean_points = (
            probabilities[ROLE_START] * conditional[(ROLE_START, "mean")]
            + probabilities[ROLE_SUB] * conditional[(ROLE_SUB, "mean")]
        )
        atoms = [(0.0, probabilities[ROLE_DNP])]
        for role in (ROLE_SUB, ROLE_START):
            atoms.extend(
                (
                    (conditional[(role, "q10")], probabilities[role] * 0.2),
                    (conditional[(role, "q50")], probabilities[role] * 0.6),
                    (conditional[(role, "q90")], probabilities[role] * 0.2),
                )
            )
        forecasts.append(
            Forecast(
                player_id=player_id,
                round=round_number,
                opponent_id=opponent_id,
                home=home,
                p_start=probabilities[ROLE_START],
                p_sub=probabilities[ROLE_SUB],
                p_dnp=probabilities[ROLE_DNP],
                mean_points=mean_points,
                p10_points=weighted_quantile_atoms(atoms, 0.1),
                median_points=weighted_quantile_atoms(atoms, 0.5),
                p90_points=weighted_quantile_atoms(atoms, 0.9),
                sub_mean=conditional[(ROLE_SUB, "mean")],
                sub_q10=conditional[(ROLE_SUB, "q10")],
                sub_q50=conditional[(ROLE_SUB, "q50")],
                sub_q90=conditional[(ROLE_SUB, "q90")],
                start_mean=conditional[(ROLE_START, "mean")],
                start_q10=conditional[(ROLE_START, "q10")],
                start_q50=conditional[(ROLE_START, "q50")],
                start_q90=conditional[(ROLE_START, "q90")],
            )
        )
    return players, forecasts


def load_baseline(year: int, mode: str = "interactive") -> Dict[str, Any]:
    process = subprocess.run(
        ["node", "--experimental-strip-types", str(ROOT / "scripts" / "backtest-manager-baseline.ts"), str(year), mode],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    return json.loads(process.stdout)


def blend_forecasts(
    forecasts: Sequence[Forecast],
    player_projections: Mapping[str, float],
    player_availability: Mapping[str, float],
    round_count: int,
    model_weight: float,
) -> List[Forecast]:
    """Blend conditional scoring strength, then apply current role probabilities.

    The v1 season projection contains historical availability. Dividing by its
    estimated availability recovers an appearance-conditioned scoring rate. This
    prevents a historical starter who is now a reserve from retaining a full
    season of points merely because the baseline receives a high ensemble weight.
    """
    blended: List[Forecast] = []
    for forecast in forecasts:
        baseline_season = float(player_projections.get(forecast.player_id, 0.0))
        baseline_availability = min(1.0, max(0.15, float(player_availability.get(forecast.player_id, 0.75))))
        baseline_start = baseline_season / max(1, round_count) / baseline_availability
        sub_ratio = min(1.0, max(0.15, forecast.sub_mean / max(0.25, forecast.start_mean)))
        baseline_sub = baseline_start * sub_ratio
        blended_start = model_weight * forecast.start_mean + (1.0 - model_weight) * baseline_start
        blended_sub = model_weight * forecast.sub_mean + (1.0 - model_weight) * baseline_sub
        start_shift = blended_start - forecast.start_mean
        sub_shift = blended_sub - forecast.sub_mean
        blended.append(role_conditioned_forecast(
            forecast,
            start_mean=blended_start,
            start_quantiles=(
                forecast.start_q10 + start_shift,
                forecast.start_q50 + start_shift,
                forecast.start_q90 + start_shift,
            ),
            sub_mean=blended_sub,
            sub_quantiles=(
                forecast.sub_q10 + sub_shift,
                forecast.sub_q50 + sub_shift,
                forecast.sub_q90 + sub_shift,
            ),
        ))
    return blended


def classic_residual_forecasts(
    forecasts: Sequence[Forecast],
    player_projections: Mapping[str, float],
    player_availability: Mapping[str, float],
    round_count: int,
    residual_weight: float,
) -> List[Forecast]:
    """Keep stable conditional strength while restoring fixture variation."""
    by_player: Dict[str, List[Forecast]] = defaultdict(list)
    for forecast in forecasts:
        by_player[forecast.player_id].append(forecast)
    raw_start_means = {
        player_id: mean([forecast.start_mean for forecast in player_rows])
        for player_id, player_rows in by_player.items()
    }
    raw_sub_means = {
        player_id: mean([forecast.sub_mean for forecast in player_rows])
        for player_id, player_rows in by_player.items()
    }
    adjusted: List[Forecast] = []
    for forecast in forecasts:
        baseline_season = float(player_projections.get(forecast.player_id, 0.0))
        baseline_availability = min(1.0, max(0.15, float(player_availability.get(forecast.player_id, 0.75))))
        baseline_start = baseline_season / max(1, round_count) / baseline_availability
        average_start = raw_start_means[forecast.player_id]
        average_sub = raw_sub_means[forecast.player_id]
        baseline_sub = baseline_start * min(1.0, max(0.15, average_sub / max(0.25, average_start)))
        adjusted_start = baseline_start + residual_weight * (forecast.start_mean - average_start)
        adjusted_sub = baseline_sub + residual_weight * (forecast.sub_mean - average_sub)
        start_shift = adjusted_start - forecast.start_mean
        sub_shift = adjusted_sub - forecast.sub_mean
        adjusted.append(role_conditioned_forecast(
            forecast,
            start_mean=adjusted_start,
            start_quantiles=(
                forecast.start_q10 + start_shift,
                forecast.start_q50 + start_shift,
                forecast.start_q90 + start_shift,
            ),
            sub_mean=adjusted_sub,
            sub_quantiles=(
                forecast.sub_q10 + sub_shift,
                forecast.sub_q50 + sub_shift,
                forecast.sub_q90 + sub_shift,
            ),
        ))
    return adjusted


def solver_diagnostics(
    solver: highspy.Highs,
    model_status: highspy.HighsModelStatus,
    label: str,
    *,
    maximum_mip_gap: float = 0.005,
) -> Tuple[str, float]:
    solution = solver.getSolution()
    info = solver.getInfo()
    if not solution.value_valid or info.primal_solution_status != highspy.SolutionStatus.kSolutionStatusFeasible:
        raise RuntimeError(f"{label}: HiGHS lieferte keinen zulässigen primalen Incumbent.")
    if info.num_primal_infeasibilities > 0 or info.max_primal_infeasibility > 1e-6:
        raise RuntimeError(
            f"{label}: HiGHS-Incumbent verletzt Nebenbedingungen "
            f"({info.num_primal_infeasibilities}, max {info.max_primal_infeasibility:g})."
        )
    mip_gap = max(0.0, float(info.mip_gap))
    if mip_gap > maximum_mip_gap + 1e-12:
        raise RuntimeError(
            f"{label}: MIP-Lücke {mip_gap:.3%} überschreitet den Grenzwert {maximum_mip_gap:.3%}."
        )
    return solver.modelStatusToString(model_status), mip_gap


def validate_opening_slots(
    season: Mapping[str, Any],
    players: Mapping[str, Mapping[str, Any]],
    opening_slots: Mapping[str, str],
) -> None:
    unknown = sorted(set(opening_slots).difference(players))
    if unknown:
        raise RuntimeError(f"Classic-Winter: unbekannte Spieler im Eröffnungskader: {', '.join(unknown)}")
    invalid_roles = sorted({role for role in opening_slots.values() if role not in {"start", "reserve"}})
    if invalid_roles:
        raise RuntimeError(f"Classic-Winter: ungültige Slotrollen: {', '.join(invalid_roles)}")
    selected = list(opening_slots)
    starters = [player_id for player_id, role in opening_slots.items() if role == "start"]
    reserves = [player_id for player_id, role in opening_slots.items() if role == "reserve"]
    validate_classic_phase(season, players, selected, starters, reserves, "Eröffnungskader")


def validate_classic_phase(
    season: Mapping[str, Any],
    players: Mapping[str, Mapping[str, Any]],
    selected: Sequence[str],
    starters: Sequence[str],
    reserves: Sequence[str],
    label: str,
) -> None:
    rules = rules_for(season, "classic")
    selected_set = set(selected)
    starter_set = set(starters)
    reserve_set = set(reserves)
    if len(selected) != 15 or len(selected_set) != 15:
        raise RuntimeError(f"Classic: {label} hat nicht genau 15 eindeutige Spieler.")
    if starter_set & reserve_set or starter_set | reserve_set != selected_set:
        raise RuntimeError(f"Classic: {label} enthält inkonsistente Starter-/Reserve-Slots.")
    for position in POSITIONS:
        selected_count = sum(players[player_id]["position"] == position for player_id in selected)
        starter_count = sum(players[player_id]["position"] == position for player_id in starters)
        reserve_count = sum(players[player_id]["position"] == position for player_id in reserves)
        if selected_count != rules.roster_counts[position]:
            raise RuntimeError(f"Classic: {label} verletzt die {position}-Kaderquote.")
        if starter_count != rules.starter_counts[position] or reserve_count != 1:
            raise RuntimeError(f"Classic: {label} verletzt die {position}-Slotquote.")
    spent_cents = sum(round(float(players[player_id]["priceM"]) * 100) for player_id in selected)
    if spent_cents > round(rules.budget_m * 100):
        raise RuntimeError(f"Classic: {label} überschreitet das Budget.")
    team_counts: Dict[str, int] = defaultdict(int)
    for player_id in selected:
        team_counts[str(players[player_id]["teamId"])] += 1
    if max(team_counts.values(), default=0) > int(rules.max_from_team):
        raise RuntimeError(f"Classic: {label} überschreitet das Vereinslimit.")


def validate_classic_solution(
    season: Mapping[str, Any],
    players: Mapping[str, Mapping[str, Any]],
    opening_ids: Sequence[str],
    opening_starters: Sequence[str],
    opening_reserves: Sequence[str],
    winter_ids: Sequence[str],
    winter_starters: Sequence[str],
    winter_reserves: Sequence[str],
    transfers_out: Sequence[str],
    transfers_in: Sequence[str],
) -> None:
    rules = rules_for(season, "classic")
    validate_classic_phase(season, players, opening_ids, opening_starters, opening_reserves, "Eröffnungskader")
    validate_classic_phase(season, players, winter_ids, winter_starters, winter_reserves, "Winterkader")
    expected_out = set(opening_ids).difference(winter_ids)
    expected_in = set(winter_ids).difference(opening_ids)
    if set(transfers_out) != expected_out or set(transfers_in) != expected_in:
        raise RuntimeError("Classic: Transferindikatoren stimmen nicht mit den Kaderdifferenzen überein.")
    if len(expected_in) != len(expected_out) or len(expected_in) > rules.transfer_limit:
        raise RuntimeError("Classic: ungültige Anzahl Wintertransfers.")
    opening_roles = {
        **{player_id: "starter" for player_id in opening_starters},
        **{player_id: "reserve" for player_id in opening_reserves},
    }
    winter_roles = {
        **{player_id: "starter" for player_id in winter_starters},
        **{player_id: "reserve" for player_id in winter_reserves},
    }
    for player_id in set(opening_ids).intersection(winter_ids):
        if opening_roles[player_id] != winter_roles[player_id]:
            raise RuntimeError(f"Classic: {player_id} wechselt ohne Transfer den Starter-/Reserve-Slot.")
    outgoing_slots = sorted((players[player_id]["position"], opening_roles[player_id]) for player_id in expected_out)
    incoming_slots = sorted((players[player_id]["position"], winter_roles[player_id]) for player_id in expected_in)
    if outgoing_slots != incoming_slots:
        raise RuntimeError("Classic: ein Winterzugang übernimmt nicht den positionsgleichen verkauften Slot.")


def optimize_roster(
    season: Mapping[str, Any],
    players: Mapping[str, Mapping[str, Any]],
    forecasts: Sequence[Forecast],
    *,
    time_limit: float = 180.0,
) -> OptimizationResult:
    rules = rules_for(season, "interactive")
    player_ids = sorted(players)
    rounds = list(range(1, int(season["roundCount"]) + 1))
    forecast_map = {(forecast.player_id, forecast.round): forecast for forecast in forecasts}
    winter_round = rules.winter_start_round
    x_summer_index: Dict[str, int] = {}
    x_winter_index: Dict[str, int] = {}
    transfer_out_index: Dict[str, int] = {}
    transfer_in_index: Dict[str, int] = {}
    y_index: Dict[Tuple[str, int], int] = {}
    z_index: Dict[Tuple[int, int], int] = {}
    goalkeeper_team_summer_index: Dict[str, int] = {}
    goalkeeper_team_winter_index: Dict[str, int] = {}
    costs: List[float] = []
    lower: List[float] = []
    upper: List[float] = []
    integrality: List[highspy.HighsVarType] = []

    def add_binary(cost: float, maximum: float = 1.0) -> int:
        index = len(costs)
        costs.append(cost)
        lower.append(0.0)
        upper.append(maximum)
        integrality.append(highspy.HighsVarType.kInteger)
        return index

    for player_id in player_ids:
        season_mean = sum(forecast_map[(player_id, round_number)].mean_points for round_number in rounds)
        x_summer_index[player_id] = add_binary(-season_mean * 1e-7)
        x_winter_index[player_id] = add_binary(-season_mean * 1e-7)
        transfer_out_index[player_id] = add_binary(0.0)
        transfer_in_index[player_id] = add_binary(0.0)
    goalkeepers_by_team: Dict[str, List[str]] = defaultdict(list)
    for player_id in player_ids:
        if players[player_id]["position"] == "GK":
            goalkeepers_by_team[str(players[player_id]["teamId"])].append(player_id)
    eligible_goalkeeper_teams = sorted(
        team_id for team_id, goalkeeper_ids in goalkeepers_by_team.items() if len(goalkeeper_ids) >= rules.roster_counts["GK"]
    )
    if not eligible_goalkeeper_teams:
        raise RuntimeError("Interactive: kein Verein hat drei auswählbare Torhüter für die Torwartversicherung.")
    for team_id in eligible_goalkeeper_teams:
        goalkeeper_team_summer_index[team_id] = add_binary(0.0)
        goalkeeper_team_winter_index[team_id] = add_binary(0.0)
    for round_number in rounds:
        for player_id in player_ids:
            forecast = forecast_map[(player_id, round_number)]
            y_index[(player_id, round_number)] = add_binary(-forecast.mean_points)
        for formation_index in range(len(FORMATIONS)):
            z_index[(round_number, formation_index)] = add_binary(0.0)

    row_lower: List[float] = []
    row_upper: List[float] = []
    starts: List[int] = [0]
    indices: List[int] = []
    values: List[float] = []

    def add_row(coefficients: Mapping[int, float], minimum: float, maximum: float) -> None:
        for column, value in sorted(coefficients.items()):
            if value:
                indices.append(column)
                values.append(float(value))
        starts.append(len(indices))
        row_lower.append(minimum)
        row_upper.append(maximum)

    add_row(
        {x_summer_index[player_id]: round(float(players[player_id]["priceM"]) * 100) for player_id in player_ids},
        -highspy.kHighsInf,
        round(rules.budget_m * 100),
    )
    add_row(
        {x_winter_index[player_id]: round(float(players[player_id]["priceM"]) * 100) for player_id in player_ids},
        -highspy.kHighsInf,
        round(rules.budget_m * 100),
    )
    for position in POSITIONS:
        summer_coefficients = {x_summer_index[player_id]: 1.0 for player_id in player_ids if players[player_id]["position"] == position}
        winter_coefficients = {x_winter_index[player_id]: 1.0 for player_id in player_ids if players[player_id]["position"] == position}
        add_row(summer_coefficients, rules.roster_counts[position], rules.roster_counts[position])
        add_row(winter_coefficients, rules.roster_counts[position], rules.roster_counts[position])
    add_row({index: 1.0 for index in goalkeeper_team_summer_index.values()}, 1.0, 1.0)
    add_row({index: 1.0 for index in goalkeeper_team_winter_index.values()}, 1.0, 1.0)
    for team_id, goalkeeper_ids in goalkeepers_by_team.items():
        summer_coefficients = {x_summer_index[player_id]: 1.0 for player_id in goalkeeper_ids}
        winter_coefficients = {x_winter_index[player_id]: 1.0 for player_id in goalkeeper_ids}
        if team_id in goalkeeper_team_summer_index:
            summer_coefficients[goalkeeper_team_summer_index[team_id]] = -float(rules.roster_counts["GK"])
            winter_coefficients[goalkeeper_team_winter_index[team_id]] = -float(rules.roster_counts["GK"])
        add_row(summer_coefficients, 0.0, 0.0)
        add_row(winter_coefficients, 0.0, 0.0)
    for player_id in player_ids:
        add_row(
            {
                x_winter_index[player_id]: 1.0,
                x_summer_index[player_id]: -1.0,
                transfer_in_index[player_id]: -1.0,
                transfer_out_index[player_id]: 1.0,
            },
            0.0,
            0.0,
        )
        add_row(
            {transfer_in_index[player_id]: 1.0, transfer_out_index[player_id]: 1.0},
            -highspy.kHighsInf,
            1.0,
        )
    add_row({transfer_in_index[player_id]: 1.0 for player_id in player_ids}, -highspy.kHighsInf, rules.transfer_limit)
    add_row({transfer_out_index[player_id]: 1.0 for player_id in player_ids}, -highspy.kHighsInf, rules.transfer_limit)
    for position in POSITIONS:
        add_row(
            {
                **{transfer_in_index[player_id]: 1.0 for player_id in player_ids if players[player_id]["position"] == position},
                **{transfer_out_index[player_id]: -1.0 for player_id in player_ids if players[player_id]["position"] == position},
            },
            0.0,
            0.0,
        )
    for round_number in rounds:
        add_row({y_index[(player_id, round_number)]: 1.0 for player_id in player_ids}, 11.0, 11.0)
        add_row({z_index[(round_number, formation_index)]: 1.0 for formation_index in range(len(FORMATIONS))}, 1.0, 1.0)
        for player_id in player_ids:
            active_roster_index = x_summer_index[player_id] if round_number < winter_round else x_winter_index[player_id]
            add_row(
                {y_index[(player_id, round_number)]: 1.0, active_roster_index: -1.0},
                -highspy.kHighsInf,
                0.0,
            )
        for position in POSITIONS:
            coefficients = {
                y_index[(player_id, round_number)]: 1.0
                for player_id in player_ids
                if players[player_id]["position"] == position
            }
            for formation_index, formation in enumerate(FORMATIONS):
                coefficients[z_index[(round_number, formation_index)]] = -formation[position]
            add_row(coefficients, 0.0, 0.0)

    model = highspy.HighsLp()
    model.num_col_ = len(costs)
    model.num_row_ = len(row_lower)
    model.col_cost_ = costs
    model.col_lower_ = lower
    model.col_upper_ = upper
    model.row_lower_ = row_lower
    model.row_upper_ = row_upper
    model.integrality_ = integrality
    model.a_matrix_.format_ = highspy.MatrixFormat.kRowwise
    model.a_matrix_.start_ = starts
    model.a_matrix_.index_ = indices
    model.a_matrix_.value_ = values

    solver = highspy.Highs()
    solver.setOptionValue("output_flag", False)
    solver.setOptionValue("time_limit", time_limit)
    solver.setOptionValue("mip_rel_gap", 0.005)
    solver.setOptionValue("random_seed", 42)
    status = solver.passModel(model)
    if status != highspy.HighsStatus.kOk:
        raise RuntimeError(f"HiGHS konnte das Modell nicht laden: {status}")
    solver.run()
    model_status = solver.getModelStatus()
    if model_status not in (highspy.HighsModelStatus.kOptimal, highspy.HighsModelStatus.kTimeLimit):
        raise RuntimeError(f"HiGHS konnte keinen Kader bestimmen: {solver.modelStatusToString(model_status)}")
    solver_status, mip_gap = solver_diagnostics(solver, model_status, "Interactive")
    solution = solver.getSolution().col_value
    selected_ids = [player_id for player_id in player_ids if solution[x_summer_index[player_id]] > 0.5]
    winter_selected_ids = [player_id for player_id in player_ids if solution[x_winter_index[player_id]] > 0.5]
    transfers_out = [player_id for player_id in player_ids if solution[transfer_out_index[player_id]] > 0.5]
    transfers_in = [player_id for player_id in player_ids if solution[transfer_in_index[player_id]] > 0.5]
    if len(selected_ids) != 22:
        raise RuntimeError(f"Ungültige Kadergröße aus HiGHS: {len(selected_ids)}")
    if len(winter_selected_ids) != 22 or len(transfers_in) != len(transfers_out) or len(transfers_in) > rules.transfer_limit:
        raise RuntimeError("Ungültiger Winterkader aus HiGHS.")
    validate_interactive_goalkeeper_stack(players, selected_ids, "Eröffnungskader")
    validate_interactive_goalkeeper_stack(players, winter_selected_ids, "Winterkader")
    lineups = {
        round_number: [player_id for player_id in player_ids if solution[y_index[(player_id, round_number)]] > 0.5]
        for round_number in rounds
    }
    formations: Dict[int, Dict[str, int]] = {}
    for round_number in rounds:
        selected_formation = next(
            formation_index
            for formation_index in range(len(FORMATIONS))
            if solution[z_index[(round_number, formation_index)]] > 0.5
        )
        formations[round_number] = dict(FORMATIONS[selected_formation])
    objective = sum(
        forecast_map[(player_id, round_number)].mean_points
        for round_number, lineup in lineups.items()
        for player_id in lineup
    )
    return OptimizationResult(
        selected_ids,
        winter_selected_ids,
        transfers_out,
        transfers_in,
        lineups,
        formations,
        objective,
        solver_status,
        mip_gap,
    )


def validate_interactive_goalkeeper_stack(
    players: Mapping[str, Mapping[str, Any]],
    selected_ids: Sequence[str],
    label: str,
) -> None:
    goalkeeper_ids = [player_id for player_id in selected_ids if players[player_id]["position"] == "GK"]
    goalkeeper_teams = {str(players[player_id]["teamId"]) for player_id in goalkeeper_ids}
    if len(goalkeeper_ids) != ROSTER_COUNTS["GK"] or len(goalkeeper_teams) != 1:
        raise RuntimeError(
            f"Interactive: {label} muss drei Torhüter desselben Vereins als Torwartversicherung enthalten."
        )


def optimize_classic_roster(
    season: Mapping[str, Any],
    players: Mapping[str, Mapping[str, Any]],
    forecasts: Sequence[Forecast],
    *,
    time_limit: float = 180.0,
    opening_slots: Optional[Mapping[str, str]] = None,
    activation_weights: Optional[Mapping[Tuple[int, str], float]] = None,
    reserve_refinements: int = 5,
    reserve_candidates: Optional[List[ClassicOptimizationResult]] = None,
    reserve_signatures: Optional[Set[Tuple[Tuple[str, ...], ...]]] = None,
) -> ClassicOptimizationResult:
    """Solve Classic with fixed slots and independent reserve activation.

    The reserve probability is 1-product(1-pDNP) under an explicitly documented
    independence assumption. A best-response loop revalues reserves from the exact
    selected-starter probability, including when expected reserve points are
    negative. Cycles return the best exactly rescored candidate. ``opening_slots``
    locks a real opening roster for winter execution.
    """

    rules = rules_for(season, "classic")
    player_ids = sorted(players)
    rounds = sorted({int(forecast.round) for forecast in forecasts})
    if not rounds:
        raise RuntimeError("Classic: keine Prognoserunden vorhanden.")
    winter_round = rules.winter_start_round
    forecast_map = {(forecast.player_id, forecast.round): forecast for forecast in forecasts}
    missing_forecasts = [
        (player_id, round_number)
        for player_id in player_ids
        for round_number in rounds
        if (player_id, round_number) not in forecast_map
    ]
    if missing_forecasts:
        raise RuntimeError(f"Classic: {len(missing_forecasts)} Spieler-/Rundenprognosen fehlen.")
    if opening_slots is not None:
        validate_opening_slots(season, players, opening_slots)
    phase_rounds = {
        "opening": [round_number for round_number in rounds if round_number < winter_round],
        "winter": [round_number for round_number in rounds if round_number >= winter_round],
    }
    if activation_weights is None:
        initial_activation: Dict[Tuple[int, str], float] = {}
        for round_number in rounds:
            for position in POSITIONS:
                starter_count = int(rules.starter_counts[position])
                likely_starters = sorted(
                    (player_id for player_id in player_ids if players[player_id]["position"] == position),
                    key=lambda player_id: forecast_map[(player_id, round_number)].mean_points,
                    reverse=True,
                )[:starter_count]
                initial_activation[(round_number, position)] = 1.0 - math.prod(
                    1.0 - forecast_map[(player_id, round_number)].p_dnp
                    for player_id in likely_starters
                )
        activation_weights = initial_activation
    reserve_candidates = reserve_candidates if reserve_candidates is not None else []
    reserve_signatures = reserve_signatures if reserve_signatures is not None else set()

    x_index: Dict[Tuple[str, str], int] = {}
    starter_index: Dict[Tuple[str, str], int] = {}
    reserve_index: Dict[Tuple[str, str], int] = {}
    transfer_index: Dict[Tuple[str, str, str], int] = {}
    costs: List[float] = []
    lower: List[float] = []
    upper: List[float] = []
    integrality: List[highspy.HighsVarType] = []

    def add_column(
        cost: float,
        maximum: float = 1.0,
        integer: bool = True,
        minimum: float = 0.0,
    ) -> int:
        index = len(costs)
        costs.append(cost)
        lower.append(minimum)
        upper.append(maximum)
        integrality.append(highspy.HighsVarType.kInteger if integer else highspy.HighsVarType.kContinuous)
        return index

    for phase, phase_matchdays in phase_rounds.items():
        for player_id in player_ids:
            season_mean = sum(forecast_map[(player_id, round_number)].mean_points for round_number in phase_matchdays)
            locked_role = opening_slots.get(player_id) if opening_slots is not None and phase == "opening" else None
            locked_member = locked_role is not None
            x_index[(phase, player_id)] = add_column(
                -season_mean * 1e-7,
                maximum=1.0 if phase != "opening" or opening_slots is None or locked_member else 0.0,
                minimum=1.0 if locked_member else 0.0,
            )
            starter_index[(phase, player_id)] = add_column(
                0.0,
                maximum=1.0 if phase != "opening" or opening_slots is None or locked_role == "start" else 0.0,
                minimum=1.0 if locked_role == "start" else 0.0,
            )
            reserve_index[(phase, player_id)] = add_column(
                0.0,
                maximum=1.0 if phase != "opening" or opening_slots is None or locked_role == "reserve" else 0.0,
                minimum=1.0 if locked_role == "reserve" else 0.0,
            )
    for player_id in player_ids:
        for role in ("starter", "reserve"):
            transfer_index[(role, "out", player_id)] = add_column(0.0)
            transfer_index[(role, "in", player_id)] = add_column(0.0)

    row_lower: List[float] = []
    row_upper: List[float] = []
    starts: List[int] = [0]
    indices: List[int] = []
    values: List[float] = []

    def add_row(coefficients: Mapping[int, float], minimum: float, maximum: float) -> None:
        for column, value in sorted(coefficients.items()):
            if value:
                indices.append(column)
                values.append(float(value))
        starts.append(len(indices))
        row_lower.append(minimum)
        row_upper.append(maximum)

    for phase, phase_matchdays in phase_rounds.items():
        add_row(
            {x_index[(phase, player_id)]: round(float(players[player_id]["priceM"]) * 100) for player_id in player_ids},
            -highspy.kHighsInf,
            round(rules.budget_m * 100),
        )
        for position in POSITIONS:
            position_ids = [player_id for player_id in player_ids if players[player_id]["position"] == position]
            add_row(
                {x_index[(phase, player_id)]: 1.0 for player_id in position_ids},
                rules.roster_counts[position],
                rules.roster_counts[position],
            )
            add_row(
                {starter_index[(phase, player_id)]: 1.0 for player_id in position_ids},
                rules.starter_counts[position],
                rules.starter_counts[position],
            )
            add_row(
                {reserve_index[(phase, player_id)]: 1.0 for player_id in position_ids},
                1.0,
                1.0,
            )
        for team_id in sorted({player["teamId"] for player in players.values()}):
            add_row(
                {x_index[(phase, player_id)]: 1.0 for player_id in player_ids if players[player_id]["teamId"] == team_id},
                -highspy.kHighsInf,
                float(rules.max_from_team),
            )
        for player_id in player_ids:
            add_row(
                {
                    starter_index[(phase, player_id)]: 1.0,
                    reserve_index[(phase, player_id)]: 1.0,
                    x_index[(phase, player_id)]: -1.0,
                },
                0.0,
                0.0,
            )
        for round_number in phase_matchdays:
            for player_id in player_ids:
                forecast = forecast_map[(player_id, round_number)]
                costs[starter_index[(phase, player_id)]] -= forecast.mean_points
                position = str(players[player_id]["position"])
                costs[reserve_index[(phase, player_id)]] -= (
                    forecast.mean_points * activation_weights[(round_number, position)]
                )

    for player_id in player_ids:
        for role, indexes in (("starter", starter_index), ("reserve", reserve_index)):
            add_row(
                {
                    indexes[("winter", player_id)]: 1.0,
                    indexes[("opening", player_id)]: -1.0,
                    transfer_index[(role, "in", player_id)]: -1.0,
                    transfer_index[(role, "out", player_id)]: 1.0,
                },
                0.0,
                0.0,
            )
        add_row(
            {
                transfer_index[(role, direction, player_id)]: 1.0
                for role in ("starter", "reserve")
                for direction in ("in", "out")
            },
            -highspy.kHighsInf,
            1.0,
        )
    for direction in ("in", "out"):
        add_row(
            {
                transfer_index[(role, direction, player_id)]: 1.0
                for player_id in player_ids
                for role in ("starter", "reserve")
            },
            -highspy.kHighsInf,
            rules.transfer_limit,
        )
    for position in POSITIONS:
        position_ids = [player_id for player_id in player_ids if players[player_id]["position"] == position]
        for role in ("starter", "reserve"):
            add_row(
                {
                    **{transfer_index[(role, "in", player_id)]: 1.0 for player_id in position_ids},
                    **{transfer_index[(role, "out", player_id)]: -1.0 for player_id in position_ids},
                },
                0.0,
                0.0,
            )

    model = highspy.HighsLp()
    model.num_col_ = len(costs)
    model.num_row_ = len(row_lower)
    model.col_cost_ = costs
    model.col_lower_ = lower
    model.col_upper_ = upper
    model.row_lower_ = row_lower
    model.row_upper_ = row_upper
    model.integrality_ = integrality
    model.a_matrix_.format_ = highspy.MatrixFormat.kRowwise
    model.a_matrix_.start_ = starts
    model.a_matrix_.index_ = indices
    model.a_matrix_.value_ = values

    solver = highspy.Highs()
    solver.setOptionValue("output_flag", False)
    solver.setOptionValue("time_limit", time_limit)
    solver.setOptionValue("mip_rel_gap", 0.005)
    solver.setOptionValue("random_seed", 42)
    status = solver.passModel(model)
    if status != highspy.HighsStatus.kOk:
        raise RuntimeError(f"HiGHS konnte das Classic-Modell nicht laden: {status}")
    solver.run()
    model_status = solver.getModelStatus()
    if model_status not in (highspy.HighsModelStatus.kOptimal, highspy.HighsModelStatus.kTimeLimit):
        raise RuntimeError(f"HiGHS konnte keinen Classic-Kader bestimmen: {solver.modelStatusToString(model_status)}")
    solver_status, mip_gap = solver_diagnostics(solver, model_status, "Classic")
    solution = solver.getSolution().col_value

    def selected(indexes: Mapping[Tuple[str, str], int], phase: str) -> List[str]:
        return [player_id for player_id in player_ids if solution[indexes[(phase, player_id)]] > 0.5]

    opening_ids = selected(x_index, "opening")
    opening_starters = selected(starter_index, "opening")
    opening_reserves = selected(reserve_index, "opening")
    winter_ids = selected(x_index, "winter")
    winter_starters = selected(starter_index, "winter")
    winter_reserves = selected(reserve_index, "winter")
    transfers_out = [
        player_id
        for player_id in player_ids
        if any(solution[transfer_index[(role, "out", player_id)]] > 0.5 for role in ("starter", "reserve"))
    ]
    transfers_in = [
        player_id
        for player_id in player_ids
        if any(solution[transfer_index[(role, "in", player_id)]] > 0.5 for role in ("starter", "reserve"))
    ]
    validate_classic_solution(
        season,
        players,
        opening_ids,
        opening_starters,
        opening_reserves,
        winter_ids,
        winter_starters,
        winter_reserves,
        transfers_out,
        transfers_in,
    )
    reserve_activation: Dict[Tuple[int, str], float] = {}
    objective = 0.0
    for round_number in rounds:
        phase_starters = opening_starters if round_number < winter_round else winter_starters
        phase_reserves = opening_reserves if round_number < winter_round else winter_reserves
        objective += sum(forecast_map[(player_id, round_number)].mean_points for player_id in phase_starters)
        for position in POSITIONS:
            selected_starters = [
                player_id for player_id in phase_starters if players[player_id]["position"] == position
            ]
            activation = 1.0 - math.prod(
                1.0 - forecast_map[(player_id, round_number)].p_dnp
                for player_id in selected_starters
            )
            reserve_activation[(round_number, position)] = activation
            reserve_id = next(
                player_id for player_id in phase_reserves if players[player_id]["position"] == position
            )
            objective += forecast_map[(reserve_id, round_number)].mean_points * activation
    maximum_activation_change = max(
        abs(reserve_activation[key] - activation_weights[key])
        for key in reserve_activation
    )
    signature = (
        tuple(sorted(opening_starters)),
        tuple(sorted(opening_reserves)),
        tuple(sorted(winter_starters)),
        tuple(sorted(winter_reserves)),
    )
    repeated_signature = signature in reserve_signatures
    reserve_signatures.add(signature)
    current = ClassicOptimizationResult(
        opening_ids,
        opening_starters,
        opening_reserves,
        winter_ids,
        winter_starters,
        winter_reserves,
        transfers_out,
        transfers_in,
        reserve_activation,
        objective,
        f"{solver_status}; reserve-best-response",
        mip_gap,
    )
    reserve_candidates.append(current)
    if maximum_activation_change <= 1e-4:
        current.solver_status = f"{solver_status}; reserve-fixed-point"
        return current
    if reserve_refinements > 0 and not repeated_signature:
        return optimize_classic_roster(
            season,
            players,
            forecasts,
            time_limit=time_limit,
            opening_slots=opening_slots,
            activation_weights=reserve_activation,
            reserve_refinements=reserve_refinements - 1,
            reserve_candidates=reserve_candidates,
            reserve_signatures=reserve_signatures,
        )
    best = max(reserve_candidates, key=lambda candidate: candidate.objective)
    suffix = "cycle" if repeated_signature else "iteration-limit"
    best.solver_status = f"{best.solver_status}; {suffix}-best-exact-candidate"
    return best


def classic_winter_scenarios(
    season: Mapping[str, Any],
    forecasts: Sequence[Forecast],
    scenario_count: int,
) -> List[List[Forecast]]:
    """Create reproducible latent winter states without clairvoyant match outcomes."""
    if scenario_count < 2:
        raise RuntimeError("Classic-Preseason-Rekurs benötigt mindestens zwei Winterszenarien.")
    winter_round = rules_for(season, "classic").winter_start_round
    team_by_player = {str(player["id"]): str(player["teamId"]) for player in season["players"]}
    scenarios: List[List[Forecast]] = [list(forecasts)]
    for scenario_index in range(1, scenario_count):
        rng = np.random.default_rng(42_000 + int(season["startYear"]) * 10 + scenario_index)
        team_ids = sorted({team_by_player.get(forecast.player_id, "none") for forecast in forecasts})
        team_points = {team_id: float(rng.normal(0.0, 0.08)) for team_id in team_ids}
        team_availability = {team_id: float(rng.normal(0.0, 0.18)) for team_id in team_ids}
        player_ids = sorted({forecast.player_id for forecast in forecasts})
        player_points = {player_id: float(rng.normal(-0.02, 0.20)) for player_id in player_ids}
        player_availability = {player_id: float(rng.normal(0.0, 0.65)) for player_id in player_ids}
        scenario: List[Forecast] = []
        for forecast in forecasts:
            if forecast.round < winter_round:
                scenario.append(forecast)
                continue
            team_id = team_by_player.get(forecast.player_id, "none")
            old_dnp = min(0.995, max(0.005, forecast.p_dnp))
            old_logit = math.log(old_dnp / (1.0 - old_dnp))
            new_logit = old_logit + player_availability[forecast.player_id] + team_availability[team_id]
            new_dnp = min(0.995, max(0.005, 1.0 / (1.0 + math.exp(-new_logit))))
            old_appearance = max(1e-6, 1.0 - old_dnp)
            new_appearance = 1.0 - new_dnp
            start_share = forecast.p_start / old_appearance
            new_start = new_appearance * start_share
            new_sub = new_appearance - new_start
            performance_factor = math.exp(player_points[forecast.player_id] + team_points[team_id])
            scenario.append(role_conditioned_forecast(
                forecast,
                p_start=new_start,
                p_sub=new_sub,
                p_dnp=new_dnp,
                start_mean=forecast.start_mean * performance_factor,
                start_quantiles=(
                    forecast.start_q10 * performance_factor,
                    forecast.start_q50 * performance_factor,
                    forecast.start_q90 * performance_factor,
                ),
                sub_mean=forecast.sub_mean * performance_factor,
                sub_quantiles=(
                    forecast.sub_q10 * performance_factor,
                    forecast.sub_q50 * performance_factor,
                    forecast.sub_q90 * performance_factor,
                ),
            ))
        scenarios.append(scenario)
    return scenarios


def classic_slot_signature(optimization: ClassicOptimizationResult) -> Tuple[Tuple[str, str], ...]:
    return tuple(
        sorted(
            [(player_id, "start") for player_id in optimization.starter_ids]
            + [(player_id, "reserve") for player_id in optimization.reserve_ids]
        )
    )


def optimize_classic_preseason_recourse(
    season: Mapping[str, Any],
    players: Mapping[str, Mapping[str, Any]],
    forecasts: Sequence[Forecast],
    *,
    scenario_count: int,
    time_limit: float,
) -> ClassicOptimizationResult:
    """Choose one opening roster against scenario-specific legal winter responses."""
    scenarios = classic_winter_scenarios(season, forecasts, scenario_count)
    candidates: Dict[Tuple[Tuple[str, str], ...], Dict[str, str]] = {}
    cache: Dict[Tuple[Tuple[Tuple[str, str], ...], int], ClassicOptimizationResult] = {}
    for scenario_index, scenario in enumerate(scenarios):
        result = optimize_classic_roster(
            season,
            players,
            scenario,
            time_limit=time_limit,
        )
        signature = classic_slot_signature(result)
        candidates[signature] = dict(signature)
        cache[(signature, scenario_index)] = result

    evaluated: List[Tuple[float, Tuple[Tuple[str, str], ...], List[ClassicOptimizationResult]]] = []
    for signature, opening_slots in candidates.items():
        responses: List[ClassicOptimizationResult] = []
        for scenario_index, scenario in enumerate(scenarios):
            response = cache.get((signature, scenario_index))
            if response is None:
                response = optimize_classic_roster(
                    season,
                    players,
                    scenario,
                    time_limit=time_limit,
                    opening_slots=opening_slots,
                )
            responses.append(response)
        expected_points = mean([response.objective for response in responses])
        evaluated.append((expected_points, signature, responses))
    expected_points, _winning_signature, responses = max(
        evaluated,
        key=lambda item: (item[0], item[1]),
    )
    representative = responses[0]
    sales: Dict[str, int] = defaultdict(int)
    targets: Dict[str, int] = defaultdict(int)
    response_rows: List[Dict[str, Any]] = []
    for scenario_index, response in enumerate(responses):
        for player_id in response.transfers_out:
            sales[player_id] += 1
        for player_id in response.transfers_in:
            targets[player_id] += 1
        response_rows.append(
            {
                "scenario": scenario_index,
                "projectedPoints": rounded(response.objective, 2),
                "transfersOut": response.transfers_out,
                "transfersIn": response.transfers_in,
            }
        )
    recourse_summary = {
        "method": "latent-winter-state sample-average recourse",
        "scenarioCount": len(scenarios),
        "openingCandidates": len(candidates),
        "expectedPoints": rounded(expected_points, 2),
        "saleFrequencies": [
            {"playerId": player_id, "count": count, "frequency": rounded(count / len(scenarios), 3)}
            for player_id, count in sorted(sales.items(), key=lambda item: (-item[1], item[0]))
        ],
        "targetFrequencies": [
            {"playerId": player_id, "count": count, "frequency": rounded(count / len(scenarios), 3)}
            for player_id, count in sorted(targets.items(), key=lambda item: (-item[1], item[0]))
        ],
        "responses": response_rows,
    }
    return ClassicOptimizationResult(
        selected_ids=representative.selected_ids,
        starter_ids=representative.starter_ids,
        reserve_ids=representative.reserve_ids,
        winter_selected_ids=representative.winter_selected_ids,
        winter_starter_ids=representative.winter_starter_ids,
        winter_reserve_ids=representative.winter_reserve_ids,
        transfers_out=representative.transfers_out,
        transfers_in=representative.transfers_in,
        reserve_activation=representative.reserve_activation,
        objective=expected_points,
        solver_status=f"scenario-recourse; {representative.solver_status}",
        mip_gap=max(response.mip_gap for response in responses),
        recourse_summary=recourse_summary,
    )


def formation_label(formation: Mapping[str, int]) -> str:
    return f"{formation['DEF']}-{formation['MID']}-{formation['FWD']}"


def confidence(state: PlayerState) -> str:
    if state.appearances >= 45 and len(state.seasons) >= 2:
        return "high"
    if state.appearances >= 15 or len(state.seasons) >= 2:
        return "medium"
    return "low"


def player_projection_summary(player_id: str, forecasts: Sequence[Forecast]) -> Dict[str, float]:
    rows = [forecast for forecast in forecasts if forecast.player_id == player_id]
    return {
        "projectedPoints": sum(forecast.mean_points for forecast in rows),
        "pStart": mean([forecast.p_start for forecast in rows]),
        "pSub": mean([forecast.p_sub for forecast in rows]),
        "pDnp": mean([forecast.p_dnp for forecast in rows]),
    }


def actual_points(season: Mapping[str, Any]) -> Tuple[Dict[Tuple[int, str], float], Dict[str, float]]:
    rounds_by_match = {match["id"]: int(match["round"]) for match in season["matches"]}
    by_round: Dict[Tuple[int, str], float] = defaultdict(float)
    by_player: Dict[str, float] = defaultdict(float)
    for score in season["scores"]:
        round_number = rounds_by_match.get(score["matchId"])
        if round_number is None:
            continue
        points = float(score["totalPoints"])
        by_round[(round_number, score["playerId"])] += points
        by_player[score["playerId"]] += points
    return dict(by_round), dict(by_player)


def actual_roles(season: Mapping[str, Any]) -> Dict[Tuple[int, str], int]:
    rounds_by_match = {match["id"]: int(match["round"]) for match in season["matches"]}
    roles: Dict[Tuple[int, str], int] = {}
    for score in season["scores"]:
        round_number = rounds_by_match.get(score["matchId"])
        if round_number is not None:
            roles[(round_number, score["playerId"])] = score_role(score)
    return roles


def score_classic_assignments(
    season: Mapping[str, Any],
    opening_starters: Sequence[str],
    opening_reserves: Sequence[str],
    winter_starters: Optional[Sequence[str]] = None,
    winter_reserves: Optional[Sequence[str]] = None,
) -> Tuple[float, Dict[int, List[Tuple[str, float, bool]]]]:
    points_by_round, _ = actual_points(season)
    roles = actual_roles(season)
    positions = {player["id"]: player["position"] for player in season["players"]}
    winter_round = winter_start_round(season["leagueCode"], int(season["roundCount"]))
    winter_starters = list(winter_starters or opening_starters)
    winter_reserves = list(winter_reserves or opening_reserves)
    details: Dict[int, List[Tuple[str, float, bool]]] = {}
    total = 0.0
    for round_number in range(1, int(season["roundCount"]) + 1):
        starters = list(opening_starters if round_number < winter_round else winter_starters)
        reserves = list(opening_reserves if round_number < winter_round else winter_reserves)
        rows: List[Tuple[str, float, bool]] = []
        for player_id in starters:
            points = points_by_round.get((round_number, player_id), 0.0)
            rows.append((player_id, points, False))
            total += points
        for position in POSITIONS:
            position_starters = [player_id for player_id in starters if positions.get(player_id) == position]
            reserve_id = next((player_id for player_id in reserves if positions.get(player_id) == position), None)
            starter_absent = any(roles.get((round_number, player_id), ROLE_DNP) == ROLE_DNP for player_id in position_starters)
            reserve_appeared = reserve_id is not None and roles.get((round_number, reserve_id), ROLE_DNP) != ROLE_DNP
            if starter_absent and reserve_appeared and reserve_id is not None:
                points = points_by_round.get((round_number, reserve_id), 0.0)
                rows.append((reserve_id, points, True))
                total += points
        details[round_number] = rows
    return total, details


def pair_transfers(
    players: Mapping[str, Mapping[str, Any]],
    teams: Mapping[str, Mapping[str, Any]],
    transfers_out: Sequence[str],
    transfers_in: Sequence[str],
) -> List[Dict[str, Any]]:
    result: List[Dict[str, Any]] = []
    for position in POSITIONS:
        outs = sorted(
            (players[player_id] for player_id in transfers_out if players[player_id]["position"] == position),
            key=lambda player: player["name"],
        )
        ins = sorted(
            (players[player_id] for player_id in transfers_in if players[player_id]["position"] == position),
            key=lambda player: player["name"],
        )
        for sold, bought in zip(outs, ins):
            result.append(
                {
                    "position": position,
                    "sell": {
                        "id": sold["id"],
                        "name": sold["name"],
                        "team": teams[sold["teamId"]]["name"],
                        "priceM": sold["priceM"],
                    },
                    "buy": {
                        "id": bought["id"],
                        "name": bought["name"],
                        "team": teams[bought["teamId"]]["name"],
                        "priceM": bought["priceM"],
                    },
                }
            )
    return result


def pair_classic_transfers(
    players: Mapping[str, Mapping[str, Any]],
    teams: Mapping[str, Mapping[str, Any]],
    optimization: ClassicOptimizationResult,
) -> List[Dict[str, Any]]:
    opening_roles = {
        **{player_id: "start" for player_id in optimization.starter_ids},
        **{player_id: "reserve" for player_id in optimization.reserve_ids},
    }
    winter_roles = {
        **{player_id: "start" for player_id in optimization.winter_starter_ids},
        **{player_id: "reserve" for player_id in optimization.winter_reserve_ids},
    }
    result: List[Dict[str, Any]] = []
    for position in POSITIONS:
        for role in ("start", "reserve"):
            outs = sorted(
                (
                    players[player_id]
                    for player_id in optimization.transfers_out
                    if players[player_id]["position"] == position and opening_roles[player_id] == role
                ),
                key=lambda player: player["name"],
            )
            ins = sorted(
                (
                    players[player_id]
                    for player_id in optimization.transfers_in
                    if players[player_id]["position"] == position and winter_roles[player_id] == role
                ),
                key=lambda player: player["name"],
            )
            for sold, bought in zip(outs, ins):
                result.append(
                    {
                        "position": position,
                        "role": role,
                        "sell": {
                            "id": sold["id"],
                            "name": sold["name"],
                            "team": teams[sold["teamId"]]["name"],
                            "priceM": sold["priceM"],
                        },
                        "buy": {
                            "id": bought["id"],
                            "name": bought["name"],
                            "team": teams[bought["teamId"]]["name"],
                            "priceM": bought["priceM"],
                        },
                    }
                )
    if len(result) != len(optimization.transfers_in):
        raise RuntimeError("Classic: Transfers konnten nicht eindeutig nach Position und Slot gepaart werden.")
    return result


def load_opening_slots(path: Path) -> Dict[str, str]:
    payload = load_json(path)
    if isinstance(payload, list):
        rows = payload
    elif isinstance(payload.get("recommendation"), Mapping):
        rows = payload["recommendation"].get("players", [])
    else:
        rows = payload.get("players", [])
    slots: Dict[str, str] = {}
    for row in rows:
        player_id = str(row.get("id") or row.get("playerId") or "")
        role = str(row.get("role") or "")
        if not player_id or role not in {"start", "reserve"}:
            raise RuntimeError("Der Eröffnungskader benötigt für jeden Spieler id/playerId und role=start/reserve.")
        if player_id in slots:
            raise RuntimeError(f"Spieler {player_id} steht mehrfach im Eröffnungskader.")
        slots[player_id] = role
    if len(slots) != 15:
        raise RuntimeError(f"Der Eröffnungskader enthält {len(slots)} statt 15 Spielern.")
    return slots


def find_season(
    seasons: Sequence[Mapping[str, Any]],
    league: str,
    season_year: int,
) -> Mapping[str, Any]:
    matching = [
        season
        for season in seasons
        if str(season["leagueCode"]) == league and int(season["startYear"]) == season_year
    ]
    if len(matching) != 1:
        raise RuntimeError(f"Saison {league}/{season_year} wurde nicht eindeutig gefunden.")
    return matching[0]


def run_classic_winter(
    catalog: Mapping[str, Any],
    seasons: Sequence[Mapping[str, Any]],
    args: argparse.Namespace,
) -> int:
    del catalog
    if not args.league or args.season_year is None or args.through_round is None or not args.opening_roster:
        raise RuntimeError(
            "classic-winter benötigt --league, --season-year, --through-round und --opening-roster."
        )
    season = find_season(seasons, args.league, args.season_year)
    rules = rules_for(season, "classic")
    expected_cutoff = rules.winter_start_round - 1
    if args.through_round != expected_cutoff:
        raise RuntimeError(
            f"Classic-Winter für {season['leagueName']} erwartet den Cutoff Spieltag {expected_cutoff}; "
            f"erhalten: {args.through_round}."
        )
    if int(season.get("latestRound", 0)) < args.through_round:
        raise RuntimeError(
            f"Die Saison enthält Daten nur bis Spieltag {season.get('latestRound', 0)}, "
            f"nicht bis {args.through_round}."
        )
    opening_slots = load_opening_slots(Path(args.opening_roster))
    training_rows, _, _ = build_training_dataset(seasons, int(season["startYear"]))
    bundle = fit_models(training_rows, args.iterations)
    priors = build_priors(training_rows)
    player_states, team_states = replay_history_as_of(seasons, season, args.through_round)
    remaining_rounds = list(range(args.through_round + 1, int(season["roundCount"]) + 1))
    players, raw_forecasts = predict_forecasts(
        season,
        bundle,
        priors,
        player_states,
        team_states,
        forecast_rounds=remaining_rounds,
        as_of=decision_time(season, args.through_round),
        include_player_ids=set(opening_slots),
    )
    validate_opening_slots(season, players, opening_slots)
    baselines = load_baseline(int(season["startYear"]), "classic")
    residual_weight = float(args.classic_residual_weight)
    forecasts = classic_residual_forecasts(
        raw_forecasts,
        baselines[args.league]["playerProjections"],
        baselines[args.league]["playerAvailability"],
        int(season["roundCount"]),
        residual_weight,
    )
    optimization = optimize_classic_roster(
        season,
        players,
        forecasts,
        time_limit=args.time_limit,
        opening_slots=opening_slots,
    )
    teams = {team["id"]: team for team in season["teams"]}
    transfers = pair_classic_transfers(players, teams, optimization)
    output = {
        "schemaVersion": 1,
        "generatedAt": season["generatedAt"],
        "mode": "classic-winter",
        "seasonId": season["id"],
        "league": season["leagueCode"],
        "throughRound": args.through_round,
        "forecastRounds": remaining_rounds,
        "openingRosterSource": str(Path(args.opening_roster)),
        "stateReplay": {
            "includesCurrentSeasonThroughRound": args.through_round,
            "modelTrainingThroughSeason": f"{int(season['startYear']) - 1}/{str(int(season['startYear']))[-2:]}",
        },
        "model": {
            "classicResidualWeight": residual_weight,
            "reserveActivation": (
                "exact 1-product(1-pDNP) rescoring under independence; "
                "best-response selection with explicit cycle reporting"
            ),
            "fixedStarterReserveSlots": True,
        },
        "projectedRemainingPoints": round(optimization.objective),
        "solver": {
            "name": "HiGHS",
            "status": optimization.solver_status,
            "mipGap": rounded(optimization.mip_gap, 6),
        },
        "transferLimit": rules.transfer_limit,
        "transferCount": len(transfers),
        "transfers": transfers,
        "winterRoster": [
            {
                "id": player_id,
                "name": players[player_id]["name"],
                "position": players[player_id]["position"],
                "teamId": players[player_id]["teamId"],
                "priceM": players[player_id]["priceM"],
                "role": "start" if player_id in optimization.winter_starter_ids else "reserve",
            }
            for player_id in optimization.winter_selected_ids
        ],
    }
    destination = Path(args.output) if args.output else Path(f"classic-winter-{season['id']}.json")
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(
        f"{season['id']} Classic-Winter: {len(transfers)} Transfers, "
        f"{output['projectedRemainingPoints']} erwartete Restpunkte → {destination}",
        flush=True,
    )
    return 0


def build_recommendation(
    catalog: Mapping[str, Any],
    season: Mapping[str, Any],
    players: Mapping[str, Mapping[str, Any]],
    forecasts: Sequence[Forecast],
    player_states: Mapping[str, PlayerState],
    optimization: OptimizationResult,
) -> Dict[str, Any]:
    rules = rules_for(season, "interactive")
    teams = {team["id"]: team for team in season["teams"]}
    forecast_map = {(forecast.player_id, forecast.round): forecast for forecast in forecasts}
    round_one = optimization.lineups[1]
    actual_by_round, actual_by_player = actual_points(season)
    picked_players: List[Dict[str, Any]] = []
    for player_id in optimization.selected_ids:
        player = players[player_id]
        team = teams[player["teamId"]]
        state = player_states.get(player_id, PlayerState())
        summary = player_projection_summary(player_id, forecasts)
        previous_league = previous_league_for_season(state, int(season["startYear"]), season["leagueCode"])
        previous_level = LEAGUE_LEVELS.get(previous_league, LEAGUE_LEVELS[season["leagueCode"]])
        promotion_adjusted = previous_level > LEAGUE_LEVELS[season["leagueCode"]]
        picked_players.append(
            {
                "id": player_id,
                "name": player["name"],
                "teamId": team["id"],
                "team": team["name"],
                "teamCode": team["code"],
                "logoUrl": team.get("logoUrl"),
                "photoUrl": player.get("photoUrl"),
                "position": player["position"],
                "priceM": player["priceM"],
                "projectedPoints": round(summary["projectedPoints"]),
                "currentPoints": round(actual_by_player.get(player_id, 0.0)),
                "pStart": rounded(summary["pStart"]),
                "pSub": rounded(summary["pSub"]),
                "pDnp": rounded(summary["pDnp"]),
                "confidence": confidence(state),
                "seasonsUsed": len(state.seasons),
                "appearancesUsed": state.appearances,
                "promotionAdjusted": promotion_adjusted,
                "role": "start" if player_id in round_one else "reserve",
            }
        )
    position_order = {position: index for index, position in enumerate(POSITIONS)}
    picked_players.sort(
        key=lambda player: (
            position_order[player["position"]],
            0 if player["role"] == "start" else 1,
            -player["projectedPoints"],
            player["name"],
        )
    )

    projected_matchdays: List[Dict[str, Any]] = []
    realized_matchdays: List[Dict[str, Any]] = []
    for round_number in range(1, int(season["roundCount"]) + 1):
        lineup_ids = optimization.lineups[round_number]
        lineup_forecasts = [forecast_map[(player_id, round_number)] for player_id in lineup_ids]
        lineup_players = []
        for forecast in lineup_forecasts:
            player = players[forecast.player_id]
            team = teams[player["teamId"]]
            opponent = teams[forecast.opponent_id]
            lineup_players.append(
                {
                    "id": forecast.player_id,
                    "name": player["name"],
                    "team": team["name"],
                    "teamCode": team["code"],
                    "logoUrl": team.get("logoUrl"),
                    "photoUrl": player.get("photoUrl"),
                    "position": player["position"],
                    "opponentId": forecast.opponent_id,
                    "opponent": opponent["name"],
                    "opponentCode": opponent["code"],
                    "opponentLogoUrl": opponent.get("logoUrl"),
                    "home": forecast.home,
                    "pStart": rounded(forecast.p_start),
                    "pSub": rounded(forecast.p_sub),
                    "pDnp": rounded(forecast.p_dnp),
                    "meanPoints": rounded(forecast.mean_points, 2),
                    "p10Points": rounded(forecast.p10_points, 2),
                    "medianPoints": rounded(forecast.median_points, 2),
                    "p90Points": rounded(forecast.p90_points, 2),
                }
            )
        lineup_players.sort(key=lambda item: (position_order[item["position"]], -item["meanPoints"], item["name"]))
        projected_matchdays.append(
            {
                "matchday": round_number,
                "formation": formation_label(optimization.formations[round_number]),
                "expectedPoints": rounded(sum(forecast.mean_points for forecast in lineup_forecasts), 2),
                "players": lineup_players,
            }
        )
        if round_number <= int(season["latestRound"]):
            realized_players = [
                {
                    "id": item["id"],
                    "name": item["name"],
                    "team": item["team"],
                    "teamCode": item["teamCode"],
                    "logoUrl": item["logoUrl"],
                    "photoUrl": item["photoUrl"],
                    "position": item["position"],
                    "points": round(actual_by_round.get((round_number, item["id"]), 0.0)),
                }
                for item in lineup_players
            ]
            position_points = {
                position: sum(item["points"] for item in realized_players if item["position"] == position)
                for position in POSITIONS
            }
            realized_matchdays.append(
                {
                    "matchday": round_number,
                    "totalPoints": sum(item["points"] for item in realized_players),
                    "positionPoints": position_points,
                    "players": realized_players,
                }
            )

    spent_m = rounded(sum(float(players[player_id]["priceM"]) for player_id in optimization.selected_ids), 2)
    winter_spent_m = rounded(sum(float(players[player_id]["priceM"]) for player_id in optimization.winter_selected_ids), 2)
    winter_round = winter_start_round(season["leagueCode"], int(season["roundCount"]))
    winter_transfers = pair_transfers(players, teams, optimization.transfers_out, optimization.transfers_in)
    return {
        "modelVersion": 2,
        "league": season["leagueCode"],
        "leagueName": season["leagueName"],
        "season": season["displayName"],
        "mode": "interactive",
        "budgetM": rules.budget_m,
        "spentM": spent_m,
        "remainingM": rounded(rules.budget_m - spent_m, 2),
        "winterPlan": {
            "startMatchday": winter_round,
            "transferLimit": rules.transfer_limit,
            "transferCount": len(winter_transfers),
            "spentM": winter_spent_m,
            "transfers": winter_transfers,
        },
        "formation": formation_label(optimization.formations[1]),
        "projectedStartingPoints": round(optimization.objective),
        "currentStartingPoints": sum(matchday["totalPoints"] for matchday in realized_matchdays),
        "matchdays": realized_matchdays,
        "projectedMatchdays": projected_matchdays,
        "generatedAt": season["generatedAt"],
        "rules": {
            "squadSize": 22,
            "positions": rules.roster_counts,
            "maxFromTeam": None,
            "goalkeepersFromSameTeam": True,
        },
        "optimization": {
            "solver": "HiGHS",
            "status": optimization.solver_status,
            "mipGap": rounded(optimization.mip_gap, 6),
        },
        "players": picked_players,
    }


def build_classic_recommendation(
    season: Mapping[str, Any],
    players: Mapping[str, Mapping[str, Any]],
    forecasts: Sequence[Forecast],
    player_states: Mapping[str, PlayerState],
    optimization: ClassicOptimizationResult,
) -> Dict[str, Any]:
    rules = rules_for(season, "classic")
    teams = {team["id"]: team for team in season["teams"]}
    forecast_map = {(forecast.player_id, forecast.round): forecast for forecast in forecasts}
    _, current_by_player = actual_points(season)
    published_winter_starters = (
        optimization.starter_ids if optimization.recourse_summary is not None else optimization.winter_starter_ids
    )
    published_winter_reserves = (
        optimization.reserve_ids if optimization.recourse_summary is not None else optimization.winter_reserve_ids
    )
    _, realized_details = score_classic_assignments(
        season,
        optimization.starter_ids,
        optimization.reserve_ids,
        published_winter_starters,
        published_winter_reserves,
    )
    position_order = {position: index for index, position in enumerate(POSITIONS)}
    picked_players: List[Dict[str, Any]] = []
    for player_id in optimization.selected_ids:
        player = players[player_id]
        team = teams[player["teamId"]]
        state = player_states.get(player_id, PlayerState())
        summary = player_projection_summary(player_id, forecasts)
        previous_league = previous_league_for_season(state, int(season["startYear"]), season["leagueCode"])
        previous_level = LEAGUE_LEVELS.get(previous_league, LEAGUE_LEVELS[season["leagueCode"]])
        picked_players.append(
            {
                "id": player_id,
                "name": player["name"],
                "teamId": team["id"],
                "team": team["name"],
                "teamCode": team["code"],
                "logoUrl": team.get("logoUrl"),
                "photoUrl": player.get("photoUrl"),
                "position": player["position"],
                "priceM": player["priceM"],
                "projectedPoints": round(summary["projectedPoints"]),
                "currentPoints": round(current_by_player.get(player_id, 0.0)),
                "pStart": rounded(summary["pStart"]),
                "pSub": rounded(summary["pSub"]),
                "pDnp": rounded(summary["pDnp"]),
                "confidence": confidence(state),
                "seasonsUsed": len(state.seasons),
                "appearancesUsed": state.appearances,
                "promotionAdjusted": previous_level > LEAGUE_LEVELS[season["leagueCode"]],
                "role": "start" if player_id in optimization.starter_ids else "reserve",
            }
        )
    picked_players.sort(
        key=lambda player: (
            position_order[player["position"]],
            0 if player["role"] == "start" else 1,
            -player["projectedPoints"],
            player["name"],
        )
    )

    projected_matchdays: List[Dict[str, Any]] = []
    for round_number in range(1, int(season["roundCount"]) + 1):
        winter = round_number >= winter_start_round(season["leagueCode"], int(season["roundCount"]))
        if winter and optimization.recourse_summary is None:
            starter_ids = optimization.winter_starter_ids
            reserve_ids = optimization.winter_reserve_ids
        else:
            starter_ids = optimization.starter_ids
            reserve_ids = optimization.reserve_ids
        lineup_players: List[Dict[str, Any]] = []
        starter_points = 0.0
        reserve_points = 0.0
        for player_id in starter_ids:
            forecast = forecast_map[(player_id, round_number)]
            player = players[player_id]
            team = teams[player["teamId"]]
            opponent = teams[forecast.opponent_id]
            starter_points += forecast.mean_points
            lineup_players.append(
                {
                    "id": player_id,
                    "name": player["name"],
                    "team": team["name"],
                    "teamCode": team["code"],
                    "logoUrl": team.get("logoUrl"),
                    "photoUrl": player.get("photoUrl"),
                    "position": player["position"],
                    "opponentId": forecast.opponent_id,
                    "opponent": opponent["name"],
                    "opponentCode": opponent["code"],
                    "opponentLogoUrl": opponent.get("logoUrl"),
                    "home": forecast.home,
                    "pStart": rounded(forecast.p_start),
                    "pSub": rounded(forecast.p_sub),
                    "pDnp": rounded(forecast.p_dnp),
                    "meanPoints": rounded(forecast.mean_points, 2),
                    "p10Points": rounded(forecast.p10_points, 2),
                    "medianPoints": rounded(forecast.median_points, 2),
                    "p90Points": rounded(forecast.p90_points, 2),
                }
            )
        for reserve_id in reserve_ids:
            position = players[reserve_id]["position"]
            if optimization.recourse_summary is None:
                activation = optimization.reserve_activation[(round_number, position)]
            else:
                activation = 1.0 - math.prod(
                    1.0 - forecast_map[(player_id, round_number)].p_dnp
                    for player_id in starter_ids
                    if players[player_id]["position"] == position
                )
            reserve_points += forecast_map[(reserve_id, round_number)].mean_points * activation
        lineup_players.sort(key=lambda item: (position_order[item["position"]], -item["meanPoints"], item["name"]))
        projected_matchdays.append(
            {
                "matchday": round_number,
                "formation": "4-4-2",
                "expectedPoints": rounded(starter_points + reserve_points, 2),
                "expectedReservePoints": rounded(reserve_points, 2),
                "players": lineup_players,
            }
        )

    matchdays: List[Dict[str, Any]] = []
    for round_number in range(1, int(season["latestRound"]) + 1):
        rows = realized_details.get(round_number, [])
        matchday_players = []
        for player_id, points, _activated_reserve in rows:
            player = players.get(player_id)
            if player is None:
                continue
            team = teams[player["teamId"]]
            matchday_players.append(
                {
                    "id": player_id,
                    "name": player["name"],
                    "team": team["name"],
                    "teamCode": team["code"],
                    "logoUrl": team.get("logoUrl"),
                    "photoUrl": player.get("photoUrl"),
                    "position": player["position"],
                    "points": round(points),
                }
            )
        position_points = {
            position: sum(item["points"] for item in matchday_players if item["position"] == position)
            for position in POSITIONS
        }
        matchdays.append(
            {
                "matchday": round_number,
                "totalPoints": sum(item["points"] for item in matchday_players),
                "positionPoints": position_points,
                "players": matchday_players,
            }
        )

    spent_m = rounded(sum(float(players[player_id]["priceM"]) for player_id in optimization.selected_ids), 2)
    winter_spent_m = rounded(sum(float(players[player_id]["priceM"]) for player_id in optimization.winter_selected_ids), 2)
    transfers = pair_classic_transfers(players, teams, optimization)
    if optimization.recourse_summary is not None:
        def enrich_frequency(row: Mapping[str, Any]) -> Dict[str, Any]:
            player = players[str(row["playerId"])]
            return {
                **row,
                "name": player["name"],
                "position": player["position"],
                "team": teams[player["teamId"]]["name"],
                "priceM": player["priceM"],
            }

        winter_plan: Dict[str, Any] = {
            "startMatchday": winter_start_round(season["leagueCode"], int(season["roundCount"])),
            "transferLimit": rules.transfer_limit,
            "transferCount": 0,
            "spentM": spent_m,
            "strategy": "reoptimize from the actual opening slots at the winter deadline",
            "scenarioCount": optimization.recourse_summary["scenarioCount"],
            "openingCandidates": optimization.recourse_summary["openingCandidates"],
            "likelySales": [enrich_frequency(row) for row in optimization.recourse_summary["saleFrequencies"]],
            "likelyTargets": [enrich_frequency(row) for row in optimization.recourse_summary["targetFrequencies"]],
            "transfers": [],
        }
    else:
        winter_plan = {
            "startMatchday": winter_start_round(season["leagueCode"], int(season["roundCount"])),
            "transferLimit": rules.transfer_limit,
            "transferCount": len(transfers),
            "spentM": winter_spent_m,
            "transfers": transfers,
        }
    return {
        "modelVersion": 2,
        "league": season["leagueCode"],
        "leagueName": season["leagueName"],
        "season": season["displayName"],
        "mode": "classic",
        "budgetM": rules.budget_m,
        "spentM": spent_m,
        "remainingM": rounded(rules.budget_m - spent_m, 2),
        "winterPlan": winter_plan,
        "formation": "4-4-2",
        "projectedStartingPoints": round(optimization.objective),
        "currentStartingPoints": sum(matchday["totalPoints"] for matchday in matchdays),
        "matchdays": matchdays,
        "projectedMatchdays": projected_matchdays,
        "generatedAt": season["generatedAt"],
        "rules": {
            "squadSize": 15,
            "positions": rules.roster_counts,
            "maxFromTeam": 3,
        },
        "optimization": {
            "solver": "HiGHS" if optimization.solver_status != "fixed-roster" else "fixed champion",
            "status": optimization.solver_status,
            "mipGap": rounded(optimization.mip_gap, 6),
            "recourse": optimization.recourse_summary,
        },
        "players": picked_players,
    }


def find_target_seasons(catalog: Mapping[str, Any], seasons: Sequence[Mapping[str, Any]]) -> Dict[str, Mapping[str, Any]]:
    by_id = {season["id"]: season for season in seasons}
    result: Dict[str, Mapping[str, Any]] = {}
    for league in catalog["leagues"]:
        entries = [entry for entry in catalog["seasons"] if entry["leagueCode"] == league["code"]]
        latest = max(entries, key=lambda entry: int(entry["startYear"]))
        result[league["code"]] = by_id[latest["id"]]
    return result


def validation_metrics(
    season: Mapping[str, Any],
    forecasts: Sequence[Forecast],
    optimization: OptimizationResult,
) -> Dict[str, Any]:
    matches = {match["id"]: match for match in season["matches"]}
    actual_roles: Dict[Tuple[str, int], int] = {}
    actual_values: Dict[Tuple[str, int], float] = {}
    for score in season["scores"]:
        match = matches.get(score["matchId"])
        if match is None:
            continue
        key = (score["playerId"], int(match["round"]))
        actual_roles[key] = score_role(score)
        actual_values[key] = float(score["totalPoints"])
    comparable = [forecast for forecast in forecasts if (forecast.player_id, forecast.round) in actual_roles]
    if not comparable:
        return {"sampleSize": 0}
    log_losses = []
    brier_scores = []
    errors = []
    covered = []
    for forecast in comparable:
        key = (forecast.player_id, forecast.round)
        probabilities = (forecast.p_dnp, forecast.p_sub, forecast.p_start)
        role = actual_roles[key]
        log_losses.append(-math.log(max(1e-12, probabilities[role])))
        brier_scores.append(sum((probability - float(index == role)) ** 2 for index, probability in enumerate(probabilities)))
        actual = actual_values[key]
        errors.append(forecast.mean_points - actual)
        covered.append(forecast.p10_points <= actual <= forecast.p90_points)
    realized_team_points = sum(
        actual_values.get((player_id, round_number), 0.0)
        for round_number, lineup in optimization.lineups.items()
        for player_id in lineup
    )
    return {
        "sampleSize": len(comparable),
        "roleLogLoss": rounded(mean(log_losses), 4),
        "roleBrierScore": rounded(mean(brier_scores), 4),
        "pointsMae": rounded(mean([abs(error) for error in errors]), 3),
        "pointsRmse": rounded(math.sqrt(mean([error * error for error in errors])), 3),
        "p10P90Coverage": rounded(mean([float(value) for value in covered]), 3),
        "optimizedSquadProjectedPoints": round(optimization.objective),
        "optimizedSquadRealizedPoints": round(realized_team_points),
    }


def classic_validation_metrics(
    season: Mapping[str, Any],
    forecasts: Sequence[Forecast],
    optimization: ClassicOptimizationResult,
    baseline_roster: Sequence[Mapping[str, Any]],
) -> Dict[str, Any]:
    challenger_points, _ = score_classic_assignments(
        season,
        optimization.starter_ids,
        optimization.reserve_ids,
        optimization.winter_starter_ids,
        optimization.winter_reserve_ids,
    )
    baseline_starters = [player["id"] for player in baseline_roster if player["role"] == "start"]
    baseline_reserves = [player["id"] for player in baseline_roster if player["role"] == "reserve"]
    baseline_points, _ = score_classic_assignments(season, baseline_starters, baseline_reserves)
    return {
        "optimizedSquadProjectedPoints": round(optimization.objective),
        "optimizedSquadRealizedPoints": round(challenger_points),
        "baselineRealizedPoints": round(baseline_points),
        "deltaVsBaseline": round(challenger_points - baseline_points),
        "exactAutomaticReserves": True,
        "winterTransfersUsed": len(optimization.transfers_in),
    }


def run_classic_validation(
    seasons: Sequence[Mapping[str, Any]],
    target_seasons: Mapping[str, Mapping[str, Any]],
    iterations: int,
    time_limit: float,
    residual_weight: float,
    scenario_count: int,
) -> Tuple[Dict[str, Any], Dict[str, bool]]:
    target_year = max(int(season["startYear"]) for season in target_seasons.values())
    earliest_year = min(int(season["startYear"]) for season in seasons)
    validation_years = [
        year
        for year in sorted({int(season["startYear"]) for season in seasons})
        if earliest_year < year < target_year
    ]
    folds_by_league: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for validation_year in validation_years:
        fold_seasons = {
            str(season["leagueCode"]): season
            for season in seasons
            if int(season["startYear"]) == validation_year
            and int(season.get("latestRound", 0)) >= int(season["roundCount"])
        }
        if not fold_seasons:
            continue
        rows, preseason_player_states, preseason_team_states = build_training_dataset(seasons, validation_year)
        bundle = fit_models(rows, iterations)
        priors = build_priors(rows)
        baselines = load_baseline(validation_year, "classic")
        for league, season in sorted(fold_seasons.items()):
            players, raw_forecasts = predict_forecasts(
                season,
                bundle,
                priors,
                preseason_player_states,
                preseason_team_states,
            )
            forecasts = classic_residual_forecasts(
                raw_forecasts,
                baselines[league]["playerProjections"],
                baselines[league]["playerAvailability"],
                int(season["roundCount"]),
                residual_weight,
            )
            challenger_opening = optimize_classic_preseason_recourse(
                season,
                players,
                forecasts,
                scenario_count=scenario_count,
                time_limit=time_limit,
            )
            challenger_slots = dict(classic_slot_signature(challenger_opening))
            baseline_slots = {
                str(player["id"]): str(player["role"])
                for player in baselines[league]["roster"]
            }
            cutoff = rules_for(season, "classic").winter_start_round - 1
            winter_player_states, winter_team_states = replay_history_as_of(seasons, season, cutoff)
            remaining_rounds = list(range(cutoff + 1, int(season["roundCount"]) + 1))
            included_players = set(challenger_slots) | set(baseline_slots)
            winter_players, winter_raw = predict_forecasts(
                season,
                bundle,
                priors,
                winter_player_states,
                winter_team_states,
                forecast_rounds=remaining_rounds,
                as_of=decision_time(season, cutoff),
                include_player_ids=included_players,
            )
            winter_forecasts = classic_residual_forecasts(
                winter_raw,
                baselines[league]["playerProjections"],
                baselines[league]["playerAvailability"],
                int(season["roundCount"]),
                residual_weight,
            )
            challenger_winter = optimize_classic_roster(
                season,
                winter_players,
                winter_forecasts,
                time_limit=time_limit,
                opening_slots=challenger_slots,
            )
            baseline_winter = optimize_classic_roster(
                season,
                winter_players,
                winter_forecasts,
                time_limit=time_limit,
                opening_slots=baseline_slots,
            )
            challenger_points, _ = score_classic_assignments(
                season,
                challenger_opening.starter_ids,
                challenger_opening.reserve_ids,
                challenger_winter.winter_starter_ids,
                challenger_winter.winter_reserve_ids,
            )
            baseline_starters = [player_id for player_id, role in baseline_slots.items() if role == "start"]
            baseline_reserves = [player_id for player_id, role in baseline_slots.items() if role == "reserve"]
            baseline_points, _ = score_classic_assignments(
                season,
                baseline_starters,
                baseline_reserves,
                baseline_winter.winter_starter_ids,
                baseline_winter.winter_reserve_ids,
            )
            fold = {
                "season": season["displayName"],
                "challengerRealizedPoints": round(challenger_points),
                "baselineRealizedPoints": round(baseline_points),
                "deltaVsBaseline": round(challenger_points - baseline_points),
                "challengerWinterTransfers": len(challenger_winter.transfers_in),
                "baselineWinterTransfers": len(baseline_winter.transfers_in),
            }
            folds_by_league[league].append(fold)
            print(
                f"Classic-Rolling {season['displayName']} · {league}: "
                f"{fold['challengerRealizedPoints']} Punkte "
                f"({fold['deltaVsBaseline']:+d} gegen v1 mit gleichem Winterfenster)",
                flush=True,
            )

    metrics: Dict[str, Any] = {}
    deploy_challenger: Dict[str, bool] = {}
    for league in sorted(target_seasons):
        folds = folds_by_league.get(league, [])
        aggregate_delta = sum(int(fold["deltaVsBaseline"]) for fold in folds)
        wins = sum(int(fold["deltaVsBaseline"]) > 0 for fold in folds)
        deploy = bool(folds) and aggregate_delta > 0 and wins * 2 >= len(folds)
        deploy_challenger[league] = deploy
        metrics[league] = {
            "folds": folds,
            "foldCount": len(folds),
            "aggregateDeltaVsBaseline": aggregate_delta,
            "winningFolds": wins,
            "deploymentModel": "scenario-recourse-v2" if deploy else "availability-aware-stable-v2",
            "fallbackReason": None if deploy else "recourse challenger did not win the rolling-origin baseline ladder; stable forecasts are reoptimized with current availability",
        }
    return (
        {
            "status": "experimental",
            "protocol": (
                "rolling-origin preseason selection followed by actual-cutoff state replay and legal winter "
                "reoptimization; baseline receives the same winter action space and exact reserve scoring"
            ),
            "historicalMarketSnapshots": (
                "unavailable: completed-season metadata is not proven to be a decision-time snapshot, "
                "so these results must not be described as leakage-safe"
            ),
            "years": validation_years,
            "residualWeight": residual_weight,
            "scenarioCount": scenario_count,
            "leagues": metrics,
        },
        deploy_challenger,
    )


def run_validation(
    seasons: Sequence[Mapping[str, Any]],
    target_seasons: Mapping[str, Mapping[str, Any]],
    iterations: int,
    time_limit: float,
) -> Tuple[Dict[str, Any], Dict[str, float]]:
    holdout_year = max(int(season["startYear"]) for season in target_seasons.values()) - 1
    selection_year = holdout_year - 1
    selection_seasons = {season["leagueCode"]: season for season in seasons if int(season["startYear"]) == selection_year}
    selection_rows, selection_player_states, selection_team_states = build_training_dataset(seasons, selection_year)
    selection_bundle = fit_models(selection_rows, iterations)
    selection_priors = build_priors(selection_rows)
    selection_baselines = load_baseline(selection_year)
    weight_grid = (0.0, 0.25, 0.5, 0.75, 1.0)
    selected_weights: Dict[str, float] = {}
    selection_results: Dict[str, Any] = {}
    for league, season in sorted(selection_seasons.items()):
        players, raw_forecasts = predict_forecasts(
            season,
            selection_bundle,
            selection_priors,
            selection_player_states,
            selection_team_states,
        )
        actual_by_round, _ = actual_points(season)
        candidates = []
        for weight in weight_grid:
            forecasts = blend_forecasts(
                raw_forecasts,
                selection_baselines[league]["playerProjections"],
                selection_baselines[league]["playerAvailability"],
                int(season["roundCount"]),
                weight,
            )
            optimization = optimize_roster(season, players, forecasts, time_limit=time_limit)
            realized = sum(
                actual_by_round.get((round_number, player_id), 0.0)
                for round_number, lineup in optimization.lineups.items()
                for player_id in lineup
            )
            candidates.append({"modelWeight": weight, "realizedPoints": round(realized)})
        best = max(candidates, key=lambda item: (item["realizedPoints"], item["modelWeight"]))
        selected_weights[league] = float(best["modelWeight"])
        selection_results[league] = {
            "candidates": candidates,
            "selectedModelWeight": best["modelWeight"],
            "baselineWeight": rounded(1.0 - float(best["modelWeight"]), 2),
        }
        print(
            f"Ensemble {season['displayName']} · {league}: CatBoost-Gewicht {best['modelWeight']:.2f}",
            flush=True,
        )

    holdouts = {season["leagueCode"]: season for season in seasons if int(season["startYear"]) == holdout_year}
    rows, player_states, team_states = build_training_dataset(seasons, holdout_year)
    bundle = fit_models(rows, iterations)
    priors = build_priors(rows)
    holdout_baselines = load_baseline(holdout_year)
    league_metrics: Dict[str, Any] = {}
    deployment_weights: Dict[str, float] = {}
    for league, season in sorted(holdouts.items()):
        players, raw_forecasts = predict_forecasts(season, bundle, priors, player_states, team_states)
        selected_forecasts = blend_forecasts(
            raw_forecasts,
            holdout_baselines[league]["playerProjections"],
            holdout_baselines[league]["playerAvailability"],
            int(season["roundCount"]),
            selected_weights[league],
        )
        selected_optimization = optimize_roster(season, players, selected_forecasts, time_limit=time_limit)
        selected_metrics = validation_metrics(season, selected_forecasts, selected_optimization)
        baseline_points = int(holdout_baselines[league]["realizedPoints"])
        deployment_weight = selected_weights[league]
        deployed_metrics = selected_metrics
        fallback_reason = None
        if selected_metrics["optimizedSquadRealizedPoints"] < baseline_points and selected_weights[league] > 0:
            deployment_weight = 0.0
            fallback_forecasts = blend_forecasts(
                raw_forecasts,
                holdout_baselines[league]["playerProjections"],
                holdout_baselines[league]["playerAvailability"],
                int(season["roundCount"]),
                deployment_weight,
            )
            fallback_optimization = optimize_roster(season, players, fallback_forecasts, time_limit=time_limit)
            deployed_metrics = validation_metrics(season, fallback_forecasts, fallback_optimization)
            fallback_reason = "CatBoost challenger did not beat the fixed-v1 champion on the later holdout"
        deployment_weights[league] = deployment_weight
        league_metrics[league] = {
            **deployed_metrics,
            "baselineRealizedPoints": baseline_points,
            "deltaVsBaseline": deployed_metrics["optimizedSquadRealizedPoints"] - baseline_points,
            "selectionModelWeight": selected_weights[league],
            "deployedModelWeight": deployment_weight,
            "challengerRealizedPoints": selected_metrics["optimizedSquadRealizedPoints"],
            "fallbackReason": fallback_reason,
        }
        print(
            f"Holdout {season['displayName']} · {league}: "
            f"{league_metrics[league]['optimizedSquadRealizedPoints']} realisierte Punkte "
            f"({league_metrics[league]['deltaVsBaseline']:+d} gegen v1), "
            f"Produktionsgewicht {deployment_weight:.2f}",
            flush=True,
        )
    return {
        "status": "experimental",
        "protocol": "ensemble selected on one preseason validation season; final metrics use a later time-separated preseason holdout",
        "historicalMarketSnapshots": (
            "unavailable: completed-season metadata is not proven to be a decision-time snapshot, "
            "so these results must not be described as leakage-safe"
        ),
        "selectionSeason": next(iter(selection_seasons.values()))["displayName"] if selection_seasons else str(selection_year),
        "selection": selection_results,
        "holdoutSeason": next(iter(holdouts.values()))["displayName"] if holdouts else str(holdout_year),
        "leagues": league_metrics,
    }, deployment_weights


def validate_publication(recommendation: Mapping[str, Any]) -> None:
    """Fail closed on implausible or internally inconsistent published teams."""
    availability_audit = recommendation.get("availabilityAudit")
    if not availability_audit:
        raise RuntimeError("Veröffentlichung abgebrochen: Verfügbarkeitsprüfung fehlt.")
    excluded_ids = {
        str(player["id"])
        for player in availability_audit.get("excludedPlayers", [])
    }
    published_ids = {str(player["id"]) for player in recommendation["players"]}
    published_ids.update(
        str(player["id"])
        for matchday in recommendation.get("projectedMatchdays", [])
        for player in matchday.get("players", [])
    )
    published_ids.update(
        str(transfer["buy"]["id"])
        for transfer in recommendation.get("winterPlan", {}).get("transfers", [])
    )
    blocked_publication = published_ids.intersection(excluded_ids)
    if blocked_publication:
        raise RuntimeError(
            "Veröffentlichung abgebrochen: aktueller Ausfallstatus im veröffentlichten Kader: "
            + ", ".join(sorted(blocked_publication))
        )
    starters = [player for player in recommendation["players"] if player["role"] == "start"]
    if len(starters) != 11:
        raise RuntimeError("Veröffentlichung abgebrochen: Startelf enthält nicht genau 11 Spieler.")
    if recommendation.get("mode") == "interactive":
        goalkeepers = [player for player in recommendation["players"] if player["position"] == "GK"]
        if len(goalkeepers) != ROSTER_COUNTS["GK"] or len({player["teamId"] for player in goalkeepers}) != 1:
            raise RuntimeError(
                "Veröffentlichung abgebrochen: Interactive-Kader enthält keine vollständige Torwartversicherung."
            )
        winter_goalkeepers = {player["id"]: player["team"] for player in goalkeepers}
        for transfer in recommendation.get("winterPlan", {}).get("transfers", []):
            if transfer["position"] != "GK":
                continue
            winter_goalkeepers.pop(transfer["sell"]["id"], None)
            winter_goalkeepers[transfer["buy"]["id"]] = transfer["buy"]["team"]
        if len(winter_goalkeepers) != ROSTER_COUNTS["GK"] or len(set(winter_goalkeepers.values())) != 1:
            raise RuntimeError(
                "Veröffentlichung abgebrochen: Interactive-Winterkader bricht die Torwartversicherung."
            )
    for player in starters:
        appearance = float(player.get("pStart", 0.0)) + float(player.get("pSub", 0.0))
        minimum = 0.50 if player["position"] == "GK" else 0.18
        if appearance < minimum:
            raise RuntimeError(
                f"Veröffentlichung abgebrochen: {player['name']} ({player['position']}) hat nur "
                f"{appearance:.1%} erwartete Einsatzwahrscheinlichkeit."
            )
    for matchday in recommendation.get("projectedMatchdays", []):
        for player in matchday["players"]:
            appearance = float(player["pStart"]) + float(player["pSub"])
            maximum_consistent_mean = appearance * 25.0 + 0.05
            if float(player["meanPoints"]) > maximum_consistent_mean:
                raise RuntimeError(
                    f"Veröffentlichung abgebrochen: {player['name']} erhält an Spieltag "
                    f"{matchday['matchday']} Punkte ohne ausreichende Einsatzwahrscheinlichkeit."
                )


def write_artifact(
    catalog: Mapping[str, Any],
    season: Mapping[str, Any],
    recommendation: Mapping[str, Any],
    validation: Mapping[str, Any],
    training_rows: int,
    training_end_year: int,
    model_weight: float,
    output_dir: Path = RECOMMENDATION_DIR,
) -> None:
    validate_publication(recommendation)
    role_signals = load_current_role_signals(season)
    availability_signals = load_current_availability_signals(season)
    artifact = {
        "schemaVersion": 2,
        "modelVersion": 2,
        "generatedAt": season["generatedAt"],
        "source": {
            "catalogGeneratedAt": catalog["generatedAt"],
            "seasonGeneratedAt": season["generatedAt"],
            "seasonId": season["id"],
        },
        "model": {
            "name": "Interactive-v2",
            "roleModel": "CatBoost multiclass DNP/sub/starter",
            "pointsModel": "position- and role-conditioned CatBoost mean and quantile regressors",
            "quantiles": "heuristic unconditional UI intervals; not calibrated decision intervals",
            "coldStart": "price-tier empirical-Bayes prior",
            "optimizer": "multi-matchday mixed-integer model solved with HiGHS",
            "goalkeeperInsurance": "three goalkeepers from one club in both roster phases",
            "objective": (
                "sum of expected points from the best valid XI in every matchday with the "
                "season-specific position-preserving winter window"
            ),
            "lineupEligibility": "selectable and not currently injured, in rehabilitation, or not considered",
            "historicalMarketSnapshots": "unavailable; validation is experimental until archived snapshots exist",
            "catBoostWeight": model_weight,
            "baselineWeight": rounded(1.0 - model_weight, 2),
            "currentRoleSignals": None if role_signals is None else {
                "provider": role_signals["provider"],
                "generatedAt": role_signals["generatedAt"],
                "method": role_signals["method"],
            },
            "currentAvailabilitySignals": {
                "provider": availability_signals["provider"],
                "generatedAt": availability_signals["generatedAt"],
                "sourceUrl": availability_signals["sourceUrl"],
                "policy": availability_signals["policy"],
            },
            "trainingRows": training_rows,
            "trainingThroughSeason": f"{training_end_year}/{str(training_end_year + 1)[-2:]}",
        },
        "validation": validation,
        "recommendation": recommendation,
    }
    output_dir.mkdir(parents=True, exist_ok=True)
    path = output_dir / f"{season['id']}-interactive.json"
    path.write_text(json.dumps(artifact, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(
        f"{season['id']}-interactive v2: {recommendation['projectedStartingPoints']} erwartete Punkte, "
        f"{recommendation['spentM']:.2f} Mio. €",
        flush=True,
    )


def write_classic_artifact(
    catalog: Mapping[str, Any],
    season: Mapping[str, Any],
    recommendation: Mapping[str, Any],
    validation: Mapping[str, Any],
    training_rows: int,
    training_end_year: int,
    deploy_challenger: bool,
    output_dir: Path = RECOMMENDATION_DIR,
) -> None:
    validate_publication(recommendation)
    role_signals = load_current_role_signals(season)
    availability_signals = load_current_availability_signals(season)
    artifact = {
        "schemaVersion": 2,
        "modelVersion": 2,
        "generatedAt": season["generatedAt"],
        "source": {
            "catalogGeneratedAt": catalog["generatedAt"],
            "seasonGeneratedAt": season["generatedAt"],
            "seasonId": season["id"],
        },
        "model": {
            "name": "Classic-v2 recourse" if deploy_challenger else "Classic-v2 availability-aware stable",
            "deploymentModel": "scenario-recourse-v2" if deploy_challenger else "availability-aware-stable-v2",
            "roleModel": "CatBoost multiclass DNP/sub/starter",
            "pointsModel": "stable season prior plus configured CatBoost fixture residual",
            "quantiles": "heuristic unconditional UI intervals; not calibrated decision intervals",
            "reserveModel": (
                "position-specific 1-product(1-pDNP) under conditional independence; "
                "best-response roster selection and exact candidate rescoring"
            ),
            "optimizer": (
                "sample-average preseason recourse with a separate legal HiGHS winter response per scenario"
                if deploy_challenger
                else "fresh availability-aware optimization over the stable conditional scoring prior"
            ),
            "objective": (
                "average expected points across latent winter states with the opening slots shared across scenarios"
                if deploy_challenger
                else "stable conditional scoring prior retained after the recourse challenger regressed; roster is never copied"
            ),
            "starterEligibility": "selectable and not currently injured, in rehabilitation, or not considered",
            "historicalMarketSnapshots": "unavailable; validation is experimental until archived snapshots exist",
            "classicResidualWeight": validation.get("residualWeight"),
            "winterScenarioCount": validation.get("scenarioCount") if deploy_challenger else None,
            "currentRoleSignals": None if role_signals is None else {
                "provider": role_signals["provider"],
                "generatedAt": role_signals["generatedAt"],
                "method": role_signals["method"],
            },
            "currentAvailabilitySignals": {
                "provider": availability_signals["provider"],
                "generatedAt": availability_signals["generatedAt"],
                "sourceUrl": availability_signals["sourceUrl"],
                "policy": availability_signals["policy"],
            },
            "trainingRows": training_rows,
            "trainingThroughSeason": f"{training_end_year}/{str(training_end_year + 1)[-2:]}",
        },
        "validation": validation,
        "recommendation": recommendation,
    }
    output_dir.mkdir(parents=True, exist_ok=True)
    path = output_dir / f"{season['id']}-classic.json"
    path.write_text(json.dumps(artifact, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(
        f"{season['id']}-classic v2: {recommendation['projectedStartingPoints']} erwartete Punkte, "
        f"{recommendation['spentM']:.2f} Mio. €",
        flush=True,
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--mode",
        choices=("preseason", "classic-winter"),
        default="preseason",
        help="Generate all preseason artifacts or execute one real Classic winter decision",
    )
    parser.add_argument("--iterations", type=int, default=180, help="CatBoost iterations for the final mean/class models")
    parser.add_argument("--validation-iterations", type=int, default=120, help="CatBoost iterations for holdout models")
    parser.add_argument("--time-limit", type=float, default=180.0, help="HiGHS time limit per roster in seconds")
    parser.add_argument("--skip-validation", action="store_true", help="Skip holdout fitting for a faster local iteration")
    parser.add_argument("--league", choices=tuple(sorted(LEAGUE_LEVELS)), help="League code for classic-winter")
    parser.add_argument("--season-year", type=int, help="Season start year for classic-winter")
    parser.add_argument("--through-round", type=int, help="Last completed round replayed for classic-winter")
    parser.add_argument("--opening-roster", help="JSON file containing the actual 15-player opening roster and slots")
    parser.add_argument("--output", help="Destination for classic-winter output (never defaults to a production artifact)")
    parser.add_argument(
        "--classic-residual-weight",
        type=float,
        default=0.5,
        help="CatBoost fixture-residual weight on top of the stable Classic season prior",
    )
    parser.add_argument(
        "--classic-scenarios",
        type=int,
        default=4,
        help="Latent winter states used to value preseason Classic recourse",
    )
    parser.add_argument(
        "--recommendation-output-dir",
        default=str(RECOMMENDATION_DIR),
        help="Preseason artifact directory; use a temporary path for evaluation runs",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if not 0.0 <= args.classic_residual_weight <= 1.0:
        raise RuntimeError("--classic-residual-weight muss zwischen 0 und 1 liegen.")
    if args.classic_scenarios < 2:
        raise RuntimeError("--classic-scenarios muss mindestens 2 sein.")
    catalog, seasons = load_data()
    if args.mode == "classic-winter":
        return run_classic_winter(catalog, seasons, args)
    targets = find_target_seasons(catalog, seasons)
    target_year = max(int(season["startYear"]) for season in targets.values())
    if args.skip_validation:
        validation: Dict[str, Any] = {"status": "not-run"}
        classic_validation: Dict[str, Any] = {"status": "not-run"}
        selected_weights = {league: 1.0 for league in targets}
        classic_deploy_challenger = {league: True for league in targets}
    else:
        validation, selected_weights = run_validation(seasons, targets, args.validation_iterations, args.time_limit)
        classic_validation, classic_deploy_challenger = run_classic_validation(
            seasons,
            targets,
            args.validation_iterations,
            args.time_limit,
            args.classic_residual_weight,
            args.classic_scenarios,
        )
    print(f"Finales Modell: Training vor Saison {target_year}/{str(target_year + 1)[-2:]}", flush=True)
    rows, player_states, team_states = build_training_dataset(seasons, target_year)
    bundle = fit_models(rows, args.iterations)
    priors = build_priors(rows)
    production_baselines = load_baseline(target_year)
    classic_baselines = load_baseline(target_year, "classic")
    output_dir = Path(args.recommendation_output_dir)
    for league, season in sorted(targets.items()):
        players, raw_forecasts = predict_forecasts(season, bundle, priors, player_states, team_states)
        all_players = players
        raw_forecasts = apply_current_role_signals(
            season,
            players,
            raw_forecasts,
            load_current_role_signals(season),
        )
        availability_signals = load_current_availability_signals(season)
        raw_forecasts = apply_current_availability_signals(raw_forecasts, availability_signals)
        excluded_player_ids = availability_excluded_player_ids(availability_signals)
        players = {
            player_id: player
            for player_id, player in players.items()
            if player_id not in excluded_player_ids
        }
        raw_forecasts = [
            forecast for forecast in raw_forecasts
            if forecast.player_id not in excluded_player_ids
        ]
        availability_audit = build_availability_audit(season, all_players, availability_signals)
        forecasts = blend_forecasts(
            raw_forecasts,
            production_baselines[league]["playerProjections"],
            production_baselines[league]["playerAvailability"],
            int(season["roundCount"]),
            selected_weights[league],
        )
        optimization = optimize_roster(season, players, forecasts, time_limit=args.time_limit)
        recommendation = build_recommendation(catalog, season, players, forecasts, player_states, optimization)
        recommendation["availabilityAudit"] = availability_audit
        recommendation["rules"]["availabilityPolicy"] = "current medical status blocks opening-roster selection"
        write_artifact(
            catalog,
            season,
            recommendation,
            validation,
            len(rows),
            target_year - 1,
            selected_weights[league],
            output_dir,
        )
        classic_forecasts = classic_residual_forecasts(
            raw_forecasts,
            classic_baselines[league]["playerProjections"],
            classic_baselines[league]["playerAvailability"],
            int(season["roundCount"]),
            args.classic_residual_weight,
        )
        if classic_deploy_challenger[league]:
            classic_optimization = optimize_classic_preseason_recourse(
                season,
                players,
                classic_forecasts,
                scenario_count=args.classic_scenarios,
                time_limit=args.time_limit,
            )
        else:
            classic_optimization = optimize_classic_roster(
                season,
                players,
                classic_forecasts,
                time_limit=args.time_limit,
            )
        classic_recommendation = build_classic_recommendation(
            season,
            players,
            classic_forecasts,
            player_states,
            classic_optimization,
        )
        classic_recommendation["availabilityAudit"] = availability_audit
        classic_recommendation["rules"]["availabilityPolicy"] = "current medical status blocks opening-roster selection"
        write_classic_artifact(
            catalog,
            season,
            classic_recommendation,
            classic_validation,
            len(rows),
            target_year - 1,
            classic_deploy_challenger[league],
            output_dir,
        )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        raise
    except Exception as error:
        print(f"Interactive-v2 fehlgeschlagen: {error}", file=sys.stderr)
        raise
