"""CatBoost-Training, Priors, Signal-Overlays und Prognoseerzeugung."""

from __future__ import annotations

import json
import math
from collections import defaultdict
from datetime import datetime
from typing import Any, Dict, List, Mapping, Optional, Sequence, Set, Tuple

import numpy as np
from catboost import CatBoostClassifier, CatBoostRegressor

from . import config
from .domain import CATEGORICAL_FEATURES, CAT_FEATURE_INDICES, Forecast, ModelBundle, Observation, POSITIONS, PlayerState, Prior, ROLE_DNP, ROLE_NAMES, ROLE_START, ROLE_SUB, TeamState, mean, quantile
from .features import decision_time, feature_vector, matrix, price_percentiles, score_role


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
        and float(player["priceM"]) <= config.interactive_budget(season["leagueCode"])
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
    role_signal_path = config.paths().role_signal_path
    if not role_signal_path.exists():
        return None
    artifact = json.loads(role_signal_path.read_text(encoding="utf-8"))
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
    availability_path = config.paths().availability_signal_path
    if not availability_path.exists():
        raise RuntimeError("Aktuelle medizinische Verfügbarkeitssignale fehlen.")
    artifact = json.loads(availability_path.read_text(encoding="utf-8"))
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
    through_round: int,
) -> List[Forecast]:
    """Apply short matchday-specific absences before blocked players are removed."""
    suspended_ids = {
        str(player_id)
        for player_id, signal in artifact.get("players", {}).items()
        if str(signal.get("status")) == "suspended"
    }
    first_round = {
        player_id: min(
            forecast.round
            for forecast in forecasts
            if forecast.player_id == player_id and forecast.round > through_round
        )
        for player_id in suspended_ids
        if any(
            forecast.player_id == player_id and forecast.round > through_round
            for forecast in forecasts
        )
    }
    return [
        role_conditioned_forecast(forecast, p_start=0.0, p_sub=0.0, p_dnp=1.0)
        if forecast.player_id in first_round and forecast.round == first_round[forecast.player_id]
        else forecast
        for forecast in forecasts
    ]


def current_season_evidence(season: Mapping[str, Any]) -> Dict[str, Any]:
    through_round, observations, _roles_by_player = current_match_observations(season)
    completed_match_ids = {
        str(match["id"])
        for match in season["matches"]
        if int(match["round"]) <= through_round and match.get("state") == "FINISHED"
    }
    scores = [
        score for score in season.get("scores", [])
        if str(score["matchId"]) in completed_match_ids
    ]
    roles = [score_role(score) for score in observations.values()]
    starts = sum(role == ROLE_START for role in roles)
    substitutes = sum(role == ROLE_SUB for role in roles)
    inferred_dnp = len(observations) - len(scores)
    return {
        "throughMatchday": through_round,
        "optimizationStartsAtMatchday": min(int(season["roundCount"]), through_round + 1),
        "realizedPointsExcludedFromSelectionObjective": True,
        "completedMatches": len(completed_match_ids),
        "roleObservations": len(observations),
        "explicitScoreRows": len(scores),
        "inferredDnpObservations": inferred_dnp,
        "starts": starts,
        "substituteAppearances": substitutes,
        "dnpObservations": len(observations) - starts - substitutes,
        "source": "kicker current-season match artifacts plus inferred DNP for omitted squad players",
        "sourceGeneratedAt": season["generatedAt"],
        "method": (
            "completed matches are replayed into recent role, points, appearance, and team-form state; "
            "a missing player row for a completed team fixture is treated as DNP; known rounds use realized roles/points, "
            "future role probabilities are anchored to observed selections, "
            "and already-played points are excluded from roster selection"
        ),
    }


def current_match_observations(
    season: Mapping[str, Any],
) -> Tuple[int, Dict[Tuple[str, int], Mapping[str, Any]], Dict[str, List[int]]]:
    through_round = int(season.get("latestRound", 0))
    rounds_by_match = {
        str(match["id"]): int(match["round"])
        for match in season["matches"]
        if int(match["round"]) <= through_round and match.get("state") == "FINISHED"
    }
    observations: Dict[Tuple[str, int], Mapping[str, Any]] = {}
    roles_by_player: Dict[str, List[int]] = defaultdict(list)
    for score in season.get("scores", []):
        round_number = rounds_by_match.get(str(score["matchId"]))
        if round_number is None:
            continue
        player_id = str(score["playerId"])
        observations[(player_id, round_number)] = score
        roles_by_player[player_id].append(score_role(score))
    player_teams = {str(player["id"]): str(player["teamId"]) for player in season["players"]}
    completed_team_rounds = {
        (str(team_id), int(match["round"]))
        for match in season["matches"]
        if int(match["round"]) <= through_round and match.get("state") == "FINISHED"
        for team_id in (match["homeTeamId"], match["awayTeamId"])
    }
    for player_id, team_id in player_teams.items():
        for completed_team_id, round_number in completed_team_rounds:
            key = (player_id, round_number)
            if completed_team_id != team_id or key in observations:
                continue
            observations[key] = {
                "playerId": player_id,
                "totalPoints": 0,
                "pointsStarter": 0,
                "pointsJoker": 0,
                "inferredDnp": True,
            }
            roles_by_player[player_id].append(ROLE_DNP)
    return through_round, observations, roles_by_player


def apply_current_match_role_evidence(
    season: Mapping[str, Any],
    forecasts: Sequence[Forecast],
) -> List[Forecast]:
    through_round, _observations, roles_by_player = current_match_observations(season)
    if through_round <= 0:
        return list(forecasts)
    role_targets = {
        ROLE_START: (0.82, 0.08, 0.10),
        ROLE_SUB: (0.25, 0.50, 0.25),
        ROLE_DNP: (0.08, 0.15, 0.77),
    }
    adjusted: List[Forecast] = []
    for forecast in forecasts:
        observed_roles = roles_by_player.get(forecast.player_id, [])
        if not observed_roles or forecast.round <= through_round:
            adjusted.append(forecast)
            continue
        target_start = mean([role_targets[role][0] for role in observed_roles])
        target_sub = mean([role_targets[role][1] for role in observed_roles])
        target_dnp = mean([role_targets[role][2] for role in observed_roles])
        distance = forecast.round - through_round
        sample_weight = min(0.80, 0.65 + 0.08 * (len(observed_roles) - 1))
        source_weight = sample_weight * max(0.45, math.exp(-0.06 * max(0, distance - 1)))
        adjusted.append(role_conditioned_forecast(
            forecast,
            p_start=(1.0 - source_weight) * forecast.p_start + source_weight * target_start,
            p_sub=(1.0 - source_weight) * forecast.p_sub + source_weight * target_sub,
            p_dnp=(1.0 - source_weight) * forecast.p_dnp + source_weight * target_dnp,
        ))
    return adjusted


def apply_realized_match_evidence(
    season: Mapping[str, Any],
    forecasts: Sequence[Forecast],
) -> List[Forecast]:
    through_round, observations, _roles_by_player = current_match_observations(season)
    if through_round <= 0:
        return list(forecasts)
    player_teams = {str(player["id"]): str(player["teamId"]) for player in season["players"]}
    completed_team_rounds = {
        (str(team_id), int(match["round"]))
        for match in season["matches"]
        if int(match["round"]) <= through_round and match.get("state") == "FINISHED"
        for team_id in (match["homeTeamId"], match["awayTeamId"])
    }
    adjusted: List[Forecast] = []
    for forecast in forecasts:
        observed = observations.get((forecast.player_id, forecast.round))
        if observed is None:
            if (player_teams.get(forecast.player_id, ""), forecast.round) not in completed_team_rounds:
                adjusted.append(forecast)
                continue
            role = ROLE_DNP
            points = 0.0
        else:
            role = score_role(observed)
            points = float(observed["totalPoints"])
        adjusted.append(role_conditioned_forecast(
            forecast,
            p_start=1.0 if role == ROLE_START else 0.0,
            p_sub=1.0 if role == ROLE_SUB else 0.0,
            p_dnp=1.0 if role == ROLE_DNP else 0.0,
            start_mean=points if role == ROLE_START else None,
            start_quantiles=(points, points, points) if role == ROLE_START else None,
            sub_mean=points if role == ROLE_SUB else None,
            sub_quantiles=(points, points, points) if role == ROLE_SUB else None,
        ))
    return adjusted


def forecasts_for_remaining_optimization(
    forecasts: Sequence[Forecast],
    through_round: int,
) -> List[Forecast]:
    """Keep completed rounds structurally present without rewarding hindsight points."""
    if through_round <= 0:
        return list(forecasts)
    return [
        role_conditioned_forecast(
            forecast,
            start_mean=0.0,
            start_quantiles=(0.0, 0.0, 0.0),
            sub_mean=0.0,
            sub_quantiles=(0.0, 0.0, 0.0),
        )
        if forecast.round <= through_round
        else forecast
        for forecast in forecasts
    ]


def load_external_performance_benchmark() -> Optional[Mapping[str, Any]]:
    benchmark_path = config.paths().performance_benchmark_path
    if not benchmark_path.exists():
        return None
    artifact = json.loads(benchmark_path.read_text(encoding="utf-8"))
    if int(artifact.get("schemaVersion", 0)) != 1:
        raise RuntimeError("Externer Performance-Benchmark hat eine unbekannte Version.")
    return artifact


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
