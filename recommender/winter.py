"""Classic-Winterentscheidung als eigener Anwendungsfall über die Bibliothek."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any, Dict, Mapping, Sequence

import numpy as np

from . import config
from .artifact import pair_classic_transfers
from .baseline import classic_residual_forecasts, load_baseline
from .data import load_json
from .domain import rounded
from .features import build_training_dataset, decision_time, replay_history_as_of
from .forecast import build_priors, fit_models, predict_forecasts
from .optimize import optimize_classic_roster, validate_opening_slots


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
    rules = config.rules_for(season, "classic")
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
