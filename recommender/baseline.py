"""Brücke zum deterministischen v1-Baseline-Modell (Node) und Ensemble-Blending."""

from __future__ import annotations

import json
import subprocess
from collections import defaultdict
from typing import Any, Dict, List, Mapping, Sequence

import numpy as np

from . import config
from .domain import Forecast, mean
from .forecast import role_conditioned_forecast


def load_baseline(year: int, mode: str = "interactive") -> Dict[str, Any]:
    process = subprocess.run(
        [*config.baseline_command(), str(year), mode],
        cwd=config.baseline_cwd(),
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
