#!/usr/bin/env python3
"""Build leakage-safe Interactive-v2 recommendation artifacts.

The browser remains static. This offline job reads the generated season JSON,
trains role-conditioned CatBoost models, validates them on the latest completed
season, and solves one multi-matchday mixed-integer roster problem per league.
"""

from __future__ import annotations

import argparse
import json
import math
import subprocess
import sys
from collections import defaultdict, deque
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Deque, Dict, List, Mapping, MutableMapping, Optional, Sequence, Set, Tuple

import highspy
import numpy as np
from catboost import CatBoostClassifier, CatBoostRegressor


ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "frontend" / "public" / "data"
SEASON_DIR = DATA_DIR / "seasons"
RECOMMENDATION_DIR = DATA_DIR / "recommendations"

POSITIONS = ("GK", "DEF", "MID", "FWD")
ROSTER_COUNTS = {"GK": 3, "DEF": 7, "MID": 7, "FWD": 5}
CLASSIC_ROSTER_COUNTS = {"GK": 2, "DEF": 5, "MID": 5, "FWD": 3}
CLASSIC_STARTER_COUNTS = {"GK": 1, "DEF": 4, "MID": 4, "FWD": 2}
CLASSIC_BUDGETS = {"0001": 30.0, "0002": 7.5, "0003": 4.0}
WINTER_TRANSFER_LIMIT = 3
MIN_LINEUP_APPEARANCE = 0.50
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
    "previousLeague",
)
NUMERIC_FEATURES = (
    "priceM",
    "pricePercentile",
    "active",
    "selectable",
    "roundFraction",
    "leagueStep",
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
    previous_league: str = "none"

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
    return catalog, seasons


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
    as_of: datetime,
    player_state: PlayerState,
    team_state: TeamState,
    opponent_state: TeamState,
) -> List[Any]:
    previous_league = player_state.previous_league
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
    state.previous_league = league


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
) -> Tuple[Dict[str, Dict[str, Any]], List[Tuple[str, int, str, bool, List[Any]]]]:
    players = {
        player["id"]: player
        for player in season["players"]
        if player.get("active")
        and player.get("selectable")
        and 0 <= float(player["priceM"]) < 999
        and float(player["priceM"]) <= BUDGETS[season["leagueCode"]]
    }
    fixtures: Dict[Tuple[str, int], Tuple[str, bool]] = {}
    for match in season["matches"]:
        round_number = int(match["round"])
        fixtures[(match["homeTeamId"], round_number)] = (match["awayTeamId"], True)
        fixtures[(match["awayTeamId"], round_number)] = (match["homeTeamId"], False)
    percentiles = price_percentiles(season)
    as_of = parse_time(season.get("generatedAt"), int(season["startYear"]), 1)
    rows: List[Tuple[str, int, str, bool, List[Any]]] = []
    empty_player_state = PlayerState()
    empty_team_state = TeamState()
    for player in players.values():
        state = player_states.get(player["id"], empty_player_state)
        for round_number in range(1, int(season["roundCount"]) + 1):
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
                as_of=as_of,
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


def predict_forecasts(
    season: Mapping[str, Any],
    bundle: ModelBundle,
    priors: Mapping[Tuple[str, str, int], Prior],
    player_states: Mapping[str, PlayerState],
    team_states: Mapping[str, TeamState],
) -> Tuple[Dict[str, Dict[str, Any]], List[Forecast]]:
    players, target_rows = target_feature_rows(season, player_states, team_states)
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
    round_count: int,
    model_weight: float,
) -> List[Forecast]:
    blended: List[Forecast] = []
    for forecast in forecasts:
        baseline_points = float(player_projections.get(forecast.player_id, 0.0)) / max(1, round_count)
        blended_mean = model_weight * forecast.mean_points + (1.0 - model_weight) * baseline_points
        if abs(forecast.mean_points) > 1e-9:
            scale = max(0.0, blended_mean / forecast.mean_points)
            p10 = forecast.p10_points * scale
            median_points = forecast.median_points * scale
            p90 = forecast.p90_points * scale
        else:
            p10 = median_points = p90 = blended_mean
        ordered = sorted((p10, median_points, p90))
        blended.append(
            Forecast(
                player_id=forecast.player_id,
                round=forecast.round,
                opponent_id=forecast.opponent_id,
                home=forecast.home,
                p_start=forecast.p_start,
                p_sub=forecast.p_sub,
                p_dnp=forecast.p_dnp,
                mean_points=blended_mean,
                p10_points=ordered[0],
                median_points=ordered[1],
                p90_points=ordered[2],
            )
        )
    return blended


def optimize_roster(
    season: Mapping[str, Any],
    players: Mapping[str, Mapping[str, Any]],
    forecasts: Sequence[Forecast],
    *,
    time_limit: float = 180.0,
) -> OptimizationResult:
    player_ids = sorted(players)
    rounds = list(range(1, int(season["roundCount"]) + 1))
    forecast_map = {(forecast.player_id, forecast.round): forecast for forecast in forecasts}
    winter_round = winter_start_round(season["leagueCode"], int(season["roundCount"]))
    x_summer_index: Dict[str, int] = {}
    x_winter_index: Dict[str, int] = {}
    transfer_out_index: Dict[str, int] = {}
    transfer_in_index: Dict[str, int] = {}
    y_index: Dict[Tuple[str, int], int] = {}
    z_index: Dict[Tuple[int, int], int] = {}
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
    for round_number in rounds:
        for player_id in player_ids:
            forecast = forecast_map[(player_id, round_number)]
            maximum = 1.0 if forecast.p_start + forecast.p_sub >= MIN_LINEUP_APPEARANCE else 0.0
            y_index[(player_id, round_number)] = add_binary(-forecast.mean_points, maximum)
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
        round(BUDGETS[season["leagueCode"]] * 100),
    )
    add_row(
        {x_winter_index[player_id]: round(float(players[player_id]["priceM"]) * 100) for player_id in player_ids},
        -highspy.kHighsInf,
        round(BUDGETS[season["leagueCode"]] * 100),
    )
    for position in POSITIONS:
        summer_coefficients = {x_summer_index[player_id]: 1.0 for player_id in player_ids if players[player_id]["position"] == position}
        winter_coefficients = {x_winter_index[player_id]: 1.0 for player_id in player_ids if players[player_id]["position"] == position}
        add_row(summer_coefficients, ROSTER_COUNTS[position], ROSTER_COUNTS[position])
        add_row(winter_coefficients, ROSTER_COUNTS[position], ROSTER_COUNTS[position])
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
    add_row({transfer_in_index[player_id]: 1.0 for player_id in player_ids}, -highspy.kHighsInf, WINTER_TRANSFER_LIMIT)
    add_row({transfer_out_index[player_id]: 1.0 for player_id in player_ids}, -highspy.kHighsInf, WINTER_TRANSFER_LIMIT)
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
    solver.setOptionValue("mip_rel_gap", 0.0001)
    solver.setOptionValue("random_seed", 42)
    status = solver.passModel(model)
    if status != highspy.HighsStatus.kOk:
        raise RuntimeError(f"HiGHS konnte das Modell nicht laden: {status}")
    solver.run()
    model_status = solver.getModelStatus()
    if model_status not in (highspy.HighsModelStatus.kOptimal, highspy.HighsModelStatus.kTimeLimit):
        raise RuntimeError(f"HiGHS konnte keinen Kader bestimmen: {solver.modelStatusToString(model_status)}")
    solution = solver.getSolution().col_value
    selected_ids = [player_id for player_id in player_ids if solution[x_summer_index[player_id]] > 0.5]
    winter_selected_ids = [player_id for player_id in player_ids if solution[x_winter_index[player_id]] > 0.5]
    transfers_out = [player_id for player_id in player_ids if solution[transfer_out_index[player_id]] > 0.5]
    transfers_in = [player_id for player_id in player_ids if solution[transfer_in_index[player_id]] > 0.5]
    if len(selected_ids) != 22:
        raise RuntimeError(f"Ungültige Kadergröße aus HiGHS: {len(selected_ids)}")
    if len(winter_selected_ids) != 22 or len(transfers_in) != len(transfers_out) or len(transfers_in) > WINTER_TRANSFER_LIMIT:
        raise RuntimeError("Ungültiger Winterkader aus HiGHS.")
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
    return OptimizationResult(selected_ids, winter_selected_ids, transfers_out, transfers_in, lineups, formations, objective)


def optimize_classic_roster(
    season: Mapping[str, Any],
    players: Mapping[str, Mapping[str, Any]],
    forecasts: Sequence[Forecast],
    *,
    time_limit: float = 180.0,
) -> ClassicOptimizationResult:
    """Solve the two-phase Classic roster with positional automatic reserves.

    Reserve activation uses a conservative first-order approximation to the
    probability that at least one starter in the position is absent. The
    realized backtest below always scores the exact Classic reserve rule.
    """

    player_ids = sorted(players)
    rounds = list(range(1, int(season["roundCount"]) + 1))
    winter_round = winter_start_round(season["leagueCode"], int(season["roundCount"]))
    forecast_map = {(forecast.player_id, forecast.round): forecast for forecast in forecasts}
    phase_rounds = {
        "opening": [round_number for round_number in rounds if round_number < winter_round],
        "winter": [round_number for round_number in rounds if round_number >= winter_round],
    }

    x_index: Dict[Tuple[str, str], int] = {}
    starter_index: Dict[Tuple[str, str], int] = {}
    reserve_index: Dict[Tuple[str, str], int] = {}
    transfer_out_index: Dict[str, int] = {}
    transfer_in_index: Dict[str, int] = {}
    activation_index: Dict[Tuple[int, str], int] = {}
    reserve_score_index: Dict[Tuple[str, int], int] = {}
    costs: List[float] = []
    lower: List[float] = []
    upper: List[float] = []
    integrality: List[highspy.HighsVarType] = []

    def add_column(cost: float, maximum: float = 1.0, integer: bool = True) -> int:
        index = len(costs)
        costs.append(cost)
        lower.append(0.0)
        upper.append(maximum)
        integrality.append(highspy.HighsVarType.kInteger if integer else highspy.HighsVarType.kContinuous)
        return index

    for phase, phase_matchdays in phase_rounds.items():
        for player_id in player_ids:
            season_mean = sum(forecast_map[(player_id, round_number)].mean_points for round_number in phase_matchdays)
            appearance = mean([
                forecast_map[(player_id, round_number)].p_start + forecast_map[(player_id, round_number)].p_sub
                for round_number in phase_matchdays
            ])
            x_index[(phase, player_id)] = add_column(-season_mean * 1e-7)
            starter_index[(phase, player_id)] = add_column(0.0, 1.0 if appearance >= MIN_LINEUP_APPEARANCE else 0.0)
            reserve_index[(phase, player_id)] = add_column(0.0)
    for player_id in player_ids:
        transfer_out_index[player_id] = add_column(0.0)
        transfer_in_index[player_id] = add_column(0.0)
    for round_number in rounds:
        phase = "opening" if round_number < winter_round else "winter"
        for position in POSITIONS:
            activation_index[(round_number, position)] = add_column(0.0, integer=False)
        for player_id in player_ids:
            forecast = forecast_map[(player_id, round_number)]
            reserve_score_index[(player_id, round_number)] = add_column(-max(0.0, forecast.mean_points), integer=False)

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
            round(CLASSIC_BUDGETS[season["leagueCode"]] * 100),
        )
        for position in POSITIONS:
            position_ids = [player_id for player_id in player_ids if players[player_id]["position"] == position]
            add_row(
                {x_index[(phase, player_id)]: 1.0 for player_id in position_ids},
                CLASSIC_ROSTER_COUNTS[position],
                CLASSIC_ROSTER_COUNTS[position],
            )
            add_row(
                {starter_index[(phase, player_id)]: 1.0 for player_id in position_ids},
                CLASSIC_STARTER_COUNTS[position],
                CLASSIC_STARTER_COUNTS[position],
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
                3.0,
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

    for player_id in player_ids:
        add_row(
            {
                x_index[("winter", player_id)]: 1.0,
                x_index[("opening", player_id)]: -1.0,
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
    add_row({transfer_in_index[player_id]: 1.0 for player_id in player_ids}, -highspy.kHighsInf, WINTER_TRANSFER_LIMIT)
    add_row({transfer_out_index[player_id]: 1.0 for player_id in player_ids}, -highspy.kHighsInf, WINTER_TRANSFER_LIMIT)
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
        phase = "opening" if round_number < winter_round else "winter"
        for position in POSITIONS:
            position_ids = [player_id for player_id in player_ids if players[player_id]["position"] == position]
            activation = activation_index[(round_number, position)]
            add_row(
                {
                    activation: 1.0,
                    **{
                        starter_index[(phase, player_id)]: -forecast_map[(player_id, round_number)].p_dnp
                        for player_id in position_ids
                    },
                },
                -highspy.kHighsInf,
                0.0,
            )
            for player_id in position_ids:
                contribution = reserve_score_index[(player_id, round_number)]
                reserve = reserve_index[(phase, player_id)]
                add_row({contribution: 1.0, reserve: -1.0}, -highspy.kHighsInf, 0.0)
                add_row({contribution: 1.0, activation: -1.0}, -highspy.kHighsInf, 0.0)
                add_row({contribution: 1.0, activation: -1.0, reserve: -1.0}, -1.0, highspy.kHighsInf)

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
    solver.setOptionValue("mip_rel_gap", 0.0001)
    solver.setOptionValue("random_seed", 42)
    status = solver.passModel(model)
    if status != highspy.HighsStatus.kOk:
        raise RuntimeError(f"HiGHS konnte das Classic-Modell nicht laden: {status}")
    solver.run()
    model_status = solver.getModelStatus()
    if model_status not in (highspy.HighsModelStatus.kOptimal, highspy.HighsModelStatus.kTimeLimit):
        raise RuntimeError(f"HiGHS konnte keinen Classic-Kader bestimmen: {solver.modelStatusToString(model_status)}")
    solution = solver.getSolution().col_value

    def selected(indexes: Mapping[Tuple[str, str], int], phase: str) -> List[str]:
        return [player_id for player_id in player_ids if solution[indexes[(phase, player_id)]] > 0.5]

    opening_ids = selected(x_index, "opening")
    opening_starters = selected(starter_index, "opening")
    opening_reserves = selected(reserve_index, "opening")
    winter_ids = selected(x_index, "winter")
    winter_starters = selected(starter_index, "winter")
    winter_reserves = selected(reserve_index, "winter")
    transfers_out = [player_id for player_id in player_ids if solution[transfer_out_index[player_id]] > 0.5]
    transfers_in = [player_id for player_id in player_ids if solution[transfer_in_index[player_id]] > 0.5]
    if len(opening_ids) != 15 or len(winter_ids) != 15 or len(opening_starters) != 11 or len(opening_reserves) != 4:
        raise RuntimeError("Ungültige Classic-Lösung aus HiGHS.")
    reserve_activation = {
        (round_number, position): solution[activation_index[(round_number, position)]]
        for round_number in rounds
        for position in POSITIONS
    }
    objective = -solver.getObjectiveValue()
    return ClassicOptimizationResult(
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


def fixed_classic_optimization(
    season: Mapping[str, Any],
    players: Mapping[str, Mapping[str, Any]],
    forecasts: Sequence[Forecast],
    baseline_roster: Sequence[Mapping[str, Any]],
) -> ClassicOptimizationResult:
    """Represent the fixed v1 champion in the v2 artifact/validation contract."""
    selected_ids = [player["id"] for player in baseline_roster]
    starter_ids = [player["id"] for player in baseline_roster if player["role"] == "start"]
    reserve_ids = [player["id"] for player in baseline_roster if player["role"] == "reserve"]
    missing = [player_id for player_id in selected_ids if player_id not in players]
    if missing:
        raise RuntimeError(f"Classic-v1-Kader enthält unbekannte Spieler: {', '.join(missing)}")

    forecast_map = {(forecast.player_id, forecast.round): forecast for forecast in forecasts}
    reserve_activation: Dict[Tuple[int, str], float] = {}
    objective = 0.0
    for round_number in range(1, int(season["roundCount"]) + 1):
        for player_id in starter_ids:
            objective += forecast_map[(player_id, round_number)].mean_points
        for position in POSITIONS:
            position_starters = [player_id for player_id in starter_ids if players[player_id]["position"] == position]
            activation = min(
                1.0,
                sum(forecast_map[(player_id, round_number)].p_dnp for player_id in position_starters),
            )
            reserve_activation[(round_number, position)] = activation
            reserve_id = next(player_id for player_id in reserve_ids if players[player_id]["position"] == position)
            objective += max(0.0, forecast_map[(reserve_id, round_number)].mean_points) * activation

    return ClassicOptimizationResult(
        selected_ids=selected_ids,
        starter_ids=starter_ids,
        reserve_ids=reserve_ids,
        winter_selected_ids=selected_ids,
        winter_starter_ids=starter_ids,
        winter_reserve_ids=reserve_ids,
        transfers_out=[],
        transfers_in=[],
        reserve_activation=reserve_activation,
        objective=objective,
    )


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


def build_recommendation(
    catalog: Mapping[str, Any],
    season: Mapping[str, Any],
    players: Mapping[str, Mapping[str, Any]],
    forecasts: Sequence[Forecast],
    player_states: Mapping[str, PlayerState],
    optimization: OptimizationResult,
) -> Dict[str, Any]:
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
        previous_level = LEAGUE_LEVELS.get(state.previous_league, LEAGUE_LEVELS[season["leagueCode"]])
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
        "budgetM": BUDGETS[season["leagueCode"]],
        "spentM": spent_m,
        "remainingM": rounded(BUDGETS[season["leagueCode"]] - spent_m, 2),
        "winterPlan": {
            "startMatchday": winter_round,
            "transferLimit": WINTER_TRANSFER_LIMIT,
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
            "positions": ROSTER_COUNTS,
            "maxFromTeam": None,
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
    teams = {team["id"]: team for team in season["teams"]}
    forecast_map = {(forecast.player_id, forecast.round): forecast for forecast in forecasts}
    _, current_by_player = actual_points(season)
    _, realized_details = score_classic_assignments(
        season,
        optimization.starter_ids,
        optimization.reserve_ids,
        optimization.winter_starter_ids,
        optimization.winter_reserve_ids,
    )
    position_order = {position: index for index, position in enumerate(POSITIONS)}
    picked_players: List[Dict[str, Any]] = []
    for player_id in optimization.selected_ids:
        player = players[player_id]
        team = teams[player["teamId"]]
        state = player_states.get(player_id, PlayerState())
        summary = player_projection_summary(player_id, forecasts)
        previous_level = LEAGUE_LEVELS.get(state.previous_league, LEAGUE_LEVELS[season["leagueCode"]])
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
        starter_ids = optimization.winter_starter_ids if winter else optimization.starter_ids
        reserve_ids = optimization.winter_reserve_ids if winter else optimization.reserve_ids
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
            reserve_points += max(0.0, forecast_map[(reserve_id, round_number)].mean_points) * optimization.reserve_activation[(round_number, position)]
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
    transfers = pair_transfers(players, teams, optimization.transfers_out, optimization.transfers_in)
    return {
        "modelVersion": 2,
        "league": season["leagueCode"],
        "leagueName": season["leagueName"],
        "season": season["displayName"],
        "mode": "classic",
        "budgetM": CLASSIC_BUDGETS[season["leagueCode"]],
        "spentM": spent_m,
        "remainingM": rounded(CLASSIC_BUDGETS[season["leagueCode"]] - spent_m, 2),
        "winterPlan": {
            "startMatchday": winter_start_round(season["leagueCode"], int(season["roundCount"])),
            "transferLimit": WINTER_TRANSFER_LIMIT,
            "transferCount": len(transfers),
            "spentM": winter_spent_m,
            "transfers": transfers,
        },
        "formation": "4-4-2",
        "projectedStartingPoints": round(optimization.objective),
        "currentStartingPoints": sum(matchday["totalPoints"] for matchday in matchdays),
        "matchdays": matchdays,
        "projectedMatchdays": projected_matchdays,
        "generatedAt": season["generatedAt"],
        "rules": {
            "squadSize": 15,
            "positions": CLASSIC_ROSTER_COUNTS,
            "maxFromTeam": 3,
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
) -> Tuple[Dict[str, Any], Dict[str, bool]]:
    holdout_year = max(int(season["startYear"]) for season in target_seasons.values()) - 1
    holdouts = {season["leagueCode"]: season for season in seasons if int(season["startYear"]) == holdout_year}
    rows, player_states, team_states = build_training_dataset(seasons, holdout_year)
    bundle = fit_models(rows, iterations)
    priors = build_priors(rows)
    baselines = load_baseline(holdout_year, "classic")
    metrics: Dict[str, Any] = {}
    deploy_challenger: Dict[str, bool] = {}
    for league, season in sorted(holdouts.items()):
        players, raw_forecasts = predict_forecasts(season, bundle, priors, player_states, team_states)
        forecasts = blend_forecasts(
            raw_forecasts,
            baselines[league]["playerProjections"],
            int(season["roundCount"]),
            0.0,
        )
        challenger_optimization = optimize_classic_roster(season, players, forecasts, time_limit=time_limit)
        challenger_metrics = classic_validation_metrics(
            season,
            forecasts,
            challenger_optimization,
            baselines[league]["roster"],
        )
        deploy_challenger[league] = challenger_metrics["deltaVsBaseline"] >= 0
        if deploy_challenger[league]:
            deployed_metrics = challenger_metrics
            fallback_reason = None
            deployment_model = "two-stage-v2"
        else:
            baseline_optimization = fixed_classic_optimization(
                season,
                players,
                forecasts,
                baselines[league]["roster"],
            )
            deployed_metrics = classic_validation_metrics(
                season,
                forecasts,
                baseline_optimization,
                baselines[league]["roster"],
            )
            fallback_reason = "Classic-v2 challenger did not beat the fixed-v1 champion on the preseason holdout"
            deployment_model = "fixed-v1-champion"
        metrics[league] = {
            **deployed_metrics,
            "challengerProjectedPoints": challenger_metrics["optimizedSquadProjectedPoints"],
            "challengerRealizedPoints": challenger_metrics["optimizedSquadRealizedPoints"],
            "challengerDeltaVsBaseline": challenger_metrics["deltaVsBaseline"],
            "deploymentModel": deployment_model,
            "fallbackReason": fallback_reason,
        }
        print(
            f"Classic-Holdout {season['displayName']} · {league}: "
            f"{challenger_metrics['optimizedSquadRealizedPoints']} Challenger-Punkte "
            f"({challenger_metrics['deltaVsBaseline']:+d} gegen v1), "
            f"Deployment {deployment_model}",
            flush=True,
        )
    return (
        {
            "protocol": "preseason holdout with exact automatic reserve scoring; winter plan fixed from preseason forecasts; challenger falls back to v1 per league on regression",
            "holdoutSeason": next(iter(holdouts.values()))["displayName"] if holdouts else str(holdout_year),
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
                int(season["roundCount"]),
                deployment_weight,
            )
            fallback_optimization = optimize_roster(season, players, fallback_forecasts, time_limit=time_limit)
            deployed_metrics = validation_metrics(season, fallback_forecasts, fallback_optimization)
            fallback_reason = "CatBoost challenger did not beat the fixed-v1 champion on the untouched holdout"
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
        "protocol": "ensemble selected on one preseason validation season; final metrics use a later untouched preseason holdout",
        "selectionSeason": next(iter(selection_seasons.values()))["displayName"] if selection_seasons else str(selection_year),
        "selection": selection_results,
        "holdoutSeason": next(iter(holdouts.values()))["displayName"] if holdouts else str(holdout_year),
        "leagues": league_metrics,
    }, deployment_weights


def write_artifact(
    catalog: Mapping[str, Any],
    season: Mapping[str, Any],
    recommendation: Mapping[str, Any],
    validation: Mapping[str, Any],
    training_rows: int,
    training_end_year: int,
    model_weight: float,
) -> None:
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
            "coldStart": "price-tier empirical-Bayes prior",
            "optimizer": "multi-matchday mixed-integer model solved with HiGHS",
            "objective": "sum of expected points from the best valid XI in every matchday with a three-player position-preserving winter window",
            "minimumLineupAppearanceProbability": MIN_LINEUP_APPEARANCE,
            "catBoostWeight": model_weight,
            "baselineWeight": rounded(1.0 - model_weight, 2),
            "trainingRows": training_rows,
            "trainingThroughSeason": f"{training_end_year}/{str(training_end_year + 1)[-2:]}",
        },
        "validation": validation,
        "recommendation": recommendation,
    }
    RECOMMENDATION_DIR.mkdir(parents=True, exist_ok=True)
    path = RECOMMENDATION_DIR / f"{season['id']}-interactive.json"
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
) -> None:
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
            "name": "Classic-v2" if deploy_challenger else "Classic-v1 champion (v2 artifact)",
            "deploymentModel": "two-stage-v2" if deploy_challenger else "fixed-v1-champion",
            "roleModel": "CatBoost multiclass DNP/sub/starter",
            "pointsModel": "validated v1 season projection with CatBoost availability gating",
            "reserveModel": "position-specific automatic reserve activation from starter DNP probabilities",
            "optimizer": "two-phase mixed-integer model solved with HiGHS" if deploy_challenger else "validated fixed-v1 champion roster",
            "objective": "expected starter points plus automatic reserve contribution before and after up to three winter transfers" if deploy_challenger else "fixed-v1 champion retained after the two-stage challenger regressed on holdout",
            "minimumStarterAppearanceProbability": MIN_LINEUP_APPEARANCE if deploy_challenger else None,
            "trainingRows": training_rows,
            "trainingThroughSeason": f"{training_end_year}/{str(training_end_year + 1)[-2:]}",
        },
        "validation": validation,
        "recommendation": recommendation,
    }
    path = RECOMMENDATION_DIR / f"{season['id']}-classic.json"
    path.write_text(json.dumps(artifact, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(
        f"{season['id']}-classic v2: {recommendation['projectedStartingPoints']} erwartete Punkte, "
        f"{recommendation['spentM']:.2f} Mio. €",
        flush=True,
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--iterations", type=int, default=180, help="CatBoost iterations for the final mean/class models")
    parser.add_argument("--validation-iterations", type=int, default=120, help="CatBoost iterations for holdout models")
    parser.add_argument("--time-limit", type=float, default=180.0, help="HiGHS time limit per roster in seconds")
    parser.add_argument("--skip-validation", action="store_true", help="Skip holdout fitting for a faster local iteration")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    catalog, seasons = load_data()
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
        )
    print(f"Finales Modell: Training vor Saison {target_year}/{str(target_year + 1)[-2:]}", flush=True)
    rows, player_states, team_states = build_training_dataset(seasons, target_year)
    bundle = fit_models(rows, args.iterations)
    priors = build_priors(rows)
    production_baselines = load_baseline(target_year)
    classic_baselines = load_baseline(target_year, "classic")
    for league, season in sorted(targets.items()):
        players, raw_forecasts = predict_forecasts(season, bundle, priors, player_states, team_states)
        forecasts = blend_forecasts(
            raw_forecasts,
            production_baselines[league]["playerProjections"],
            int(season["roundCount"]),
            selected_weights[league],
        )
        optimization = optimize_roster(season, players, forecasts, time_limit=args.time_limit)
        recommendation = build_recommendation(catalog, season, players, forecasts, player_states, optimization)
        write_artifact(
            catalog,
            season,
            recommendation,
            validation,
            len(rows),
            target_year - 1,
            selected_weights[league],
        )
        classic_forecasts = blend_forecasts(
            raw_forecasts,
            classic_baselines[league]["playerProjections"],
            int(season["roundCount"]),
            0.0,
        )
        if classic_deploy_challenger[league]:
            classic_optimization = optimize_classic_roster(season, players, classic_forecasts, time_limit=args.time_limit)
        else:
            classic_optimization = fixed_classic_optimization(
                season,
                players,
                classic_forecasts,
                classic_baselines[league]["roster"],
            )
        classic_recommendation = build_classic_recommendation(
            season,
            players,
            classic_forecasts,
            player_states,
            classic_optimization,
        )
        write_classic_artifact(
            catalog,
            season,
            classic_recommendation,
            classic_validation,
            len(rows),
            target_year - 1,
            classic_deploy_challenger[league],
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
