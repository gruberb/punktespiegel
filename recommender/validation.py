"""Zeitlich geordnete Validierung mit Champion/Challenger-Entscheid je Liga."""

from __future__ import annotations

import math
from collections import defaultdict
from typing import Any, Dict, List, Mapping, Optional, Sequence, Tuple

import numpy as np

from . import config
from .artifact import actual_points, actual_roles, score_classic_assignments
from .baseline import blend_forecasts, classic_residual_forecasts, load_baseline
from .domain import FORMATIONS, Forecast, OptimizationResult, ROLE_START, mean, rounded
from .features import build_training_dataset, decision_time, replay_history_as_of, score_role
from .forecast import build_priors, fit_models, predict_forecasts
from .optimize import classic_slot_signature, optimize_classic_preseason_recourse, optimize_classic_roster, optimize_roster


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
    fixed_lineup_points = sum(
        actual_values.get((player_id, round_number), 0.0)
        for round_number, lineup in optimization.lineups.items()
        for player_id in lineup
    )
    managed_team_points = score_interactive_with_announced_starters(
        season,
        forecasts,
        optimization.selected_ids,
    )
    return {
        "sampleSize": len(comparable),
        "roleLogLoss": rounded(mean(log_losses), 4),
        "roleBrierScore": rounded(mean(brier_scores), 4),
        "pointsMae": rounded(mean([abs(error) for error in errors]), 3),
        "pointsRmse": rounded(math.sqrt(mean([error * error for error in errors])), 3),
        "p10P90Coverage": rounded(mean([float(value) for value in covered]), 3),
        "optimizedSquadProjectedPoints": round(optimization.objective),
        "optimizedSquadRealizedPoints": round(managed_team_points),
        "preseasonFixedLineupRealizedPoints": round(fixed_lineup_points),
        "matchdayPolicy": "formation and XI reselected from the fixed roster using announced real starters",
    }


def score_interactive_with_announced_starters(
    season: Mapping[str, Any],
    forecasts: Sequence[Forecast],
    selected_ids: Sequence[str],
) -> float:
    """Replay a realistic Interactive lineup policy without outcome leakage.

    Real starting elevens are public before kickoff and may be acted on under the
    current Interactive rules. Actual points and later substitute appearances do
    not influence selection. Non-starters retain their preseason expected value.
    """

    players = {str(player["id"]): player for player in season["players"]}
    forecast_map = {(forecast.player_id, forecast.round): forecast for forecast in forecasts}
    roles = actual_roles(season)
    points_by_round, _ = actual_points(season)
    total = 0.0
    for round_number in range(1, int(season["roundCount"]) + 1):
        best: Optional[Tuple[float, int, List[str]]] = None
        for formation_index, formation in enumerate(FORMATIONS):
            lineup: List[str] = []
            decision_score = 0.0
            valid = True
            for position in ("GK", "DEF", "MID", "FWD"):
                candidates = [
                    player_id
                    for player_id in selected_ids
                    if players[player_id]["position"] == position
                    and (player_id, round_number) in forecast_map
                ]
                ranked = sorted(
                    candidates,
                    key=lambda player_id: (
                        forecast_map[(player_id, round_number)].start_mean
                        if roles.get((round_number, player_id)) == ROLE_START
                        else forecast_map[(player_id, round_number)].mean_points,
                        player_id,
                    ),
                    reverse=True,
                )
                needed = int(formation[position])
                if len(ranked) < needed:
                    valid = False
                    break
                chosen = ranked[:needed]
                lineup.extend(chosen)
                decision_score += sum(
                    forecast_map[(player_id, round_number)].start_mean
                    if roles.get((round_number, player_id)) == ROLE_START
                    else forecast_map[(player_id, round_number)].mean_points
                    for player_id in chosen
                )
            if not valid:
                continue
            candidate = (decision_score, -formation_index, lineup)
            if best is None or candidate[:2] > best[:2]:
                best = candidate
        if best is None:
            raise RuntimeError(f"Interactive-Replay: keine gültige Formation an Spieltag {round_number}.")
        total += sum(points_by_round.get((round_number, player_id), 0.0) for player_id in best[2])
    return total


def run_classic_validation(
    seasons: Sequence[Mapping[str, Any]],
    target_seasons: Mapping[str, Mapping[str, Any]],
    iterations: int,
    time_limit: float,
    residual_weight: float,
    scenario_count: int,
    *,
    allow_winter_transfers: bool = False,
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
            and str(season["leagueCode"]) in target_seasons
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
            challenger_opening = (
                optimize_classic_preseason_recourse(
                    season,
                    players,
                    forecasts,
                    scenario_count=scenario_count,
                    time_limit=time_limit,
                )
                if allow_winter_transfers
                else optimize_classic_roster(
                    season,
                    players,
                    forecasts,
                    time_limit=time_limit,
                )
            )
            challenger_slots = dict(classic_slot_signature(challenger_opening))
            baseline_slots = {
                str(player["id"]): str(player["role"])
                for player in baselines[league]["roster"]
            }
            if allow_winter_transfers:
                cutoff = config.rules_for(season, "classic").winter_start_round - 1
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
                    allow_winter_transfers=True,
                )
                baseline_winter = optimize_classic_roster(
                    season,
                    winter_players,
                    winter_forecasts,
                    time_limit=time_limit,
                    opening_slots=baseline_slots,
                    allow_winter_transfers=True,
                )
            else:
                challenger_winter = challenger_opening
                baseline_winter = optimize_classic_roster(
                    season,
                    players,
                    forecasts,
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
                f"({fold['deltaVsBaseline']:+d} gegen v1 mit "
                f"{'gleichem Winterfenster' if allow_winter_transfers else 'festem Saisonkader'})",
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
            "deploymentModel": (
                "fixed-season-v2"
                if not allow_winter_transfers
                else "scenario-recourse-v2"
                if deploy
                else "availability-aware-stable-v2"
            ),
            "fallbackReason": (
                None
                if deploy
                else "challenger did not win the rolling-origin baseline ladder; stable forecasts are reoptimized with current availability"
            ),
        }
    return (
        {
            "status": "experimental",
            "protocol": (
                "rolling-origin preseason selection with fixed full-season rosters and exact reserve scoring"
                if not allow_winter_transfers
                else "rolling-origin preseason selection followed by actual-cutoff state replay and legal winter "
                "reoptimization; baseline receives the same winter action space and exact reserve scoring"
            ),
            "historicalMarketSnapshots": (
                "unavailable: completed-season metadata is not proven to be a decision-time snapshot, "
                "so these results must not be described as leakage-safe"
            ),
            "years": validation_years,
            "residualWeight": residual_weight,
            "scenarioCount": scenario_count,
            "winterTransfersModeled": allow_winter_transfers,
            "leagues": metrics,
        },
        deploy_challenger,
    )


def run_validation(
    seasons: Sequence[Mapping[str, Any]],
    target_seasons: Mapping[str, Mapping[str, Any]],
    iterations: int,
    time_limit: float,
    *,
    allow_winter_transfers: bool = False,
    bench_weight: float = 0.0,
    max_field_players_from_team: Optional[int] = None,
) -> Tuple[Dict[str, Any], Dict[str, float], Dict[str, float]]:
    holdout_year = max(int(season["startYear"]) for season in target_seasons.values()) - 1
    selection_year = holdout_year - 1
    selection_seasons = {
        season["leagueCode"]: season
        for season in seasons
        if int(season["startYear"]) == selection_year
        and str(season["leagueCode"]) in target_seasons
    }
    selection_rows, selection_player_states, selection_team_states = build_training_dataset(seasons, selection_year)
    selection_bundle = fit_models(selection_rows, iterations)
    selection_priors = build_priors(selection_rows)
    selection_baselines = load_baseline(selection_year)
    weight_grid = (0.0, 0.25, 0.5, 0.75, 1.0)
    bench_weight_grid = tuple(sorted({0.0, bench_weight, 0.15, 0.25}))
    selected_weights: Dict[str, float] = {}
    selected_bench_weights: Dict[str, float] = {}
    selection_results: Dict[str, Any] = {}
    for league, season in sorted(selection_seasons.items()):
        players, raw_forecasts = predict_forecasts(
            season,
            selection_bundle,
            selection_priors,
            selection_player_states,
            selection_team_states,
        )
        candidates = []
        for candidate_bench_weight in bench_weight_grid:
            for weight in weight_grid:
                forecasts = blend_forecasts(
                    raw_forecasts,
                    selection_baselines[league]["playerProjections"],
                    selection_baselines[league]["playerAvailability"],
                    int(season["roundCount"]),
                    weight,
                )
                optimization = optimize_roster(
                    season,
                    players,
                    forecasts,
                    time_limit=time_limit,
                    allow_winter_transfers=allow_winter_transfers,
                    goalkeepers_from_same_team=True,
                    bench_weight=candidate_bench_weight,
                    max_field_players_from_team=max_field_players_from_team,
                )
                realized = score_interactive_with_announced_starters(
                    season,
                    forecasts,
                    optimization.selected_ids,
                )
                candidates.append(
                    {
                        "modelWeight": weight,
                        "benchWeight": candidate_bench_weight,
                        "realizedPoints": round(realized),
                    }
                )
        best = max(
            candidates,
            key=lambda item: (item["realizedPoints"], item["modelWeight"], -item["benchWeight"]),
        )
        selected_weights[league] = float(best["modelWeight"])
        selected_bench_weights[league] = float(best["benchWeight"])
        selection_results[league] = {
            "candidates": candidates,
            "selectedModelWeight": best["modelWeight"],
            "selectedBenchWeight": best["benchWeight"],
            "baselineWeight": rounded(1.0 - float(best["modelWeight"]), 2),
            "winnerPoints": config.historical_benchmarks(str(league))["interactiveWinnerPoints"].get(selection_year),
        }
        print(
            f"Ensemble {season['displayName']} · {league}: CatBoost-Gewicht {best['modelWeight']:.2f}, "
            f"Bankgewicht {best['benchWeight']:.2f}",
            flush=True,
        )

    holdouts = {
        season["leagueCode"]: season
        for season in seasons
        if int(season["startYear"]) == holdout_year
        and str(season["leagueCode"]) in target_seasons
    }
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
        selected_optimization = optimize_roster(
            season,
            players,
            selected_forecasts,
            time_limit=time_limit,
            allow_winter_transfers=allow_winter_transfers,
            goalkeepers_from_same_team=True,
            bench_weight=selected_bench_weights[league],
            max_field_players_from_team=max_field_players_from_team,
        )
        selected_metrics = validation_metrics(season, selected_forecasts, selected_optimization)
        baseline_forecasts = blend_forecasts(
            raw_forecasts,
            holdout_baselines[league]["playerProjections"],
            holdout_baselines[league]["playerAvailability"],
            int(season["roundCount"]),
            0.0,
        )
        baseline_roster_ids = [str(player["id"]) for player in holdout_baselines[league]["roster"]]
        baseline_points = round(
            score_interactive_with_announced_starters(
                season,
                baseline_forecasts,
                baseline_roster_ids,
            )
        )
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
            fallback_optimization = optimize_roster(
                season,
                players,
                fallback_forecasts,
                time_limit=time_limit,
                allow_winter_transfers=allow_winter_transfers,
                goalkeepers_from_same_team=True,
                bench_weight=selected_bench_weights[league],
                max_field_players_from_team=max_field_players_from_team,
            )
            deployed_metrics = validation_metrics(season, fallback_forecasts, fallback_optimization)
            fallback_reason = "CatBoost challenger did not beat the fixed-v1 champion on the later holdout"
        deployment_weights[league] = deployment_weight
        league_metrics[league] = {
            **deployed_metrics,
            "baselineRealizedPoints": baseline_points,
            "deltaVsBaseline": deployed_metrics["optimizedSquadRealizedPoints"] - baseline_points,
            "selectionModelWeight": selected_weights[league],
            "deployedBenchWeight": selected_bench_weights[league],
            "deployedModelWeight": deployment_weight,
            "challengerRealizedPoints": selected_metrics["optimizedSquadRealizedPoints"],
            "fallbackReason": fallback_reason,
        }
        winner_points = config.historical_benchmarks(str(league))["interactiveWinnerPoints"].get(holdout_year)
        league_metrics[league]["winnerPoints"] = winner_points
        league_metrics[league]["deltaVsWinner"] = (
            None
            if winner_points is None
            else deployed_metrics["optimizedSquadRealizedPoints"] - winner_points
        )
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
        "winterTransfersModeled": allow_winter_transfers,
        "interactiveBenchWeightGrid": bench_weight_grid,
        "interactiveMaxFieldPlayersFromTeam": max_field_players_from_team,
        "selectionSeason": next(iter(selection_seasons.values()))["displayName"] if selection_seasons else str(selection_year),
        "selection": selection_results,
        "holdoutSeason": next(iter(holdouts.values()))["displayName"] if holdouts else str(holdout_year),
        "leagues": league_metrics,
    }, deployment_weights, selected_bench_weights
