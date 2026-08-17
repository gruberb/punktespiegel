"""Kommandozeileneinstieg des Empfehlungsgenerators.

Der Generator liest Saisonartefakte aus --data-dir, Liga-Konfigurationen aus
--config-dir und schreibt Empfehlungs-Artefakte nach --recommendation-output-dir.
Alle drei Pfade haben Repo-Voreinstellungen, sodass `python -m recommender`
im Checkout ohne Argumente läuft, sich aber auch vollständig gegen fremde
Datenstände betreiben lässt. --league begrenzt einen Preseason-Lauf auf
einzelne Ligen; das Training nutzt weiterhin die Historie aller Saisons.
"""

from __future__ import annotations

import argparse
from pathlib import Path
from typing import Any, Dict

from . import config
from .artifact import build_classic_recommendation, build_recommendation, write_artifact, write_classic_artifact
from .baseline import blend_forecasts, classic_residual_forecasts, load_baseline
from .data import load_data
from .features import build_training_dataset, decision_time, replay_history_as_of
from .forecast import (
    apply_current_availability_signals,
    apply_current_match_role_evidence,
    apply_current_role_signals,
    apply_realized_match_evidence,
    availability_excluded_player_ids,
    build_availability_audit,
    build_priors,
    current_season_evidence,
    fit_models,
    forecasts_for_remaining_optimization,
    load_current_availability_signals,
    load_current_role_signals,
    predict_forecasts,
)
from .optimize import optimize_classic_preseason_recourse, optimize_classic_roster, optimize_roster
from .validation import find_target_seasons, run_classic_validation, run_validation
from .winter import run_classic_winter

DEFAULT_CONFIG_DIR = config.REPO_ROOT / "config" / "recommender"
DEFAULT_DATA_DIR = config.REPO_ROOT / "frontend" / "public" / "data"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--mode",
        choices=("preseason", "classic-winter"),
        default="preseason",
        help="Generate all preseason artifacts or execute one real Classic winter decision",
    )
    parser.add_argument("--config-dir", default=str(DEFAULT_CONFIG_DIR), help="Directory with per-league JSON configs plus defaults.json")
    parser.add_argument("--data-dir", default=str(DEFAULT_DATA_DIR), help="Directory containing catalog.json, seasons/ and signal artifacts")
    parser.add_argument("--iterations", type=int, help="CatBoost iterations for the final mean/class models")
    parser.add_argument("--validation-iterations", type=int, help="CatBoost iterations for holdout models")
    parser.add_argument("--time-limit", type=float, help="HiGHS time limit per roster in seconds")
    parser.add_argument("--skip-validation", action="store_true", help="Skip holdout fitting for a faster local iteration")
    parser.add_argument(
        "--league",
        action="append",
        help="League code; repeatable. Limits preseason generation to these leagues, selects the league for classic-winter",
    )
    parser.add_argument("--season-year", type=int, help="Season start year for classic-winter")
    parser.add_argument("--through-round", type=int, help="Last completed round replayed for classic-winter")
    parser.add_argument("--opening-roster", help="JSON file containing the actual 15-player opening roster and slots")
    parser.add_argument("--output", help="Destination for classic-winter output (never defaults to a production artifact)")
    parser.add_argument(
        "--classic-residual-weight",
        type=float,
        help="CatBoost fixture-residual weight on top of the stable Classic season prior",
    )
    parser.add_argument(
        "--classic-scenarios",
        type=int,
        help="Latent winter states used to value preseason Classic recourse",
    )
    parser.add_argument(
        "--recommendation-output-dir",
        help="Preseason artifact directory; use a temporary path for evaluation runs",
    )
    return parser.parse_args()


def _resolve_defaults(args: argparse.Namespace) -> None:
    if args.iterations is None:
        args.iterations = int(config.model_default("iterations"))
    if args.validation_iterations is None:
        args.validation_iterations = int(config.model_default("validationIterations"))
    if args.time_limit is None:
        args.time_limit = float(config.model_default("timeLimitSeconds"))
    if args.classic_residual_weight is None:
        args.classic_residual_weight = float(config.model_default("classicResidualWeight"))
    if args.classic_scenarios is None:
        args.classic_scenarios = int(config.model_default("classicScenarios"))


def main() -> int:
    args = parse_args()
    output_dir_override = Path(args.recommendation_output_dir) if args.recommendation_output_dir else None
    config.initialize(Path(args.config_dir), Path(args.data_dir), output_dir_override)
    _resolve_defaults(args)
    if not 0.0 <= args.classic_residual_weight <= 1.0:
        raise RuntimeError("--classic-residual-weight muss zwischen 0 und 1 liegen.")
    if args.classic_scenarios < 2:
        raise RuntimeError("--classic-scenarios muss mindestens 2 sein.")
    if args.league:
        unknown = sorted(set(args.league) - set(config.league_codes()))
        if unknown:
            raise RuntimeError(f"Nicht konfigurierte Liga-Codes: {', '.join(unknown)} (konfiguriert: {', '.join(config.league_codes())})")
    catalog, seasons = load_data()
    if args.mode == "classic-winter":
        if not args.league or len(args.league) != 1:
            raise RuntimeError("classic-winter erwartet genau eine Liga über --league.")
        args.league = args.league[0]
        return run_classic_winter(catalog, seasons, args)
    all_targets = find_target_seasons(catalog, seasons)
    target_year = max(int(season["startYear"]) for season in all_targets.values())
    targets = all_targets
    if args.league:
        missing = sorted(set(args.league) - set(all_targets))
        if missing:
            raise RuntimeError(f"Keine Katalog-Saison für Liga-Codes: {', '.join(missing)}")
        targets = {league: season for league, season in all_targets.items() if league in set(args.league)}
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
    output_dir = config.paths().recommendations_dir
    for league, season in sorted(targets.items()):
        through_round = int(season.get("latestRound", 0))
        if through_round > 0:
            production_player_states, production_team_states = replay_history_as_of(
                seasons,
                season,
                through_round,
            )
        else:
            production_player_states, production_team_states = player_states, team_states
        players, raw_forecasts = predict_forecasts(
            season,
            bundle,
            priors,
            production_player_states,
            production_team_states,
            as_of=decision_time(season, through_round),
        )
        all_players = players
        raw_forecasts = apply_current_role_signals(
            season,
            players,
            raw_forecasts,
            load_current_role_signals(season),
        )
        raw_forecasts = apply_current_match_role_evidence(season, raw_forecasts)
        availability_signals = load_current_availability_signals(season)
        raw_forecasts = apply_current_availability_signals(raw_forecasts, availability_signals, through_round)
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
        forecasts = apply_realized_match_evidence(season, forecasts)
        optimization_forecasts = forecasts_for_remaining_optimization(forecasts, through_round)
        optimization = optimize_roster(season, players, optimization_forecasts, time_limit=args.time_limit)
        recommendation = build_recommendation(
            catalog,
            season,
            players,
            forecasts,
            production_player_states,
            optimization,
        )
        recommendation["availabilityAudit"] = availability_audit
        recommendation["currentSeasonEvidence"] = current_season_evidence(season)
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
        classic_forecasts = apply_realized_match_evidence(season, classic_forecasts)
        classic_optimization_forecasts = forecasts_for_remaining_optimization(classic_forecasts, through_round)
        if classic_deploy_challenger[league]:
            classic_optimization = optimize_classic_preseason_recourse(
                season,
                players,
                classic_optimization_forecasts,
                scenario_count=args.classic_scenarios,
                time_limit=args.time_limit,
            )
        else:
            classic_optimization = optimize_classic_roster(
                season,
                players,
                classic_optimization_forecasts,
                time_limit=args.time_limit,
            )
        classic_recommendation = build_classic_recommendation(
            season,
            players,
            classic_forecasts,
            production_player_states,
            classic_optimization,
        )
        classic_recommendation["availabilityAudit"] = availability_audit
        classic_recommendation["currentSeasonEvidence"] = current_season_evidence(season)
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
