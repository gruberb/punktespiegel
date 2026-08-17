"""Zusammenbau, Publikationsprüfung und Schreiben der Empfehlungs-Artefakte."""

from __future__ import annotations

import json
import math
from collections import defaultdict
from pathlib import Path
from typing import Any, Dict, List, Mapping, Optional, Sequence, Tuple

import numpy as np

from . import config
from .domain import ClassicOptimizationResult, Forecast, OptimizationResult, POSITIONS, PlayerState, ROLE_DNP, mean, rounded
from .features import previous_league_for_season, score_role
from .forecast import load_current_availability_signals, load_current_role_signals, load_external_performance_benchmark


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
    winter_round = config.winter_start_round(season["leagueCode"], int(season["roundCount"]))
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


def build_recommendation(
    catalog: Mapping[str, Any],
    season: Mapping[str, Any],
    players: Mapping[str, Mapping[str, Any]],
    forecasts: Sequence[Forecast],
    player_states: Mapping[str, PlayerState],
    optimization: OptimizationResult,
) -> Dict[str, Any]:
    rules = config.rules_for(season, "interactive")
    teams = {team["id"]: team for team in season["teams"]}
    forecast_map = {(forecast.player_id, forecast.round): forecast for forecast in forecasts}
    selection_round = min(int(season["roundCount"]), int(season.get("latestRound", 0)) + 1)
    selected_lineup = optimization.lineups[selection_round]
    actual_by_round, actual_by_player = actual_points(season)
    picked_players: List[Dict[str, Any]] = []
    for player_id in optimization.selected_ids:
        player = players[player_id]
        team = teams[player["teamId"]]
        state = player_states.get(player_id, PlayerState())
        summary = player_projection_summary(player_id, forecasts)
        previous_league = previous_league_for_season(state, int(season["startYear"]), season["leagueCode"])
        previous_level = config.league_level(previous_league, config.league_level_strict(season["leagueCode"]))
        promotion_adjusted = previous_level > config.league_level_strict(season["leagueCode"])
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
                "role": "start" if player_id in selected_lineup else "reserve",
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
    winter_round = config.winter_start_round(season["leagueCode"], int(season["roundCount"]))
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
        "formation": formation_label(optimization.formations[selection_round]),
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
    rules = config.rules_for(season, "classic")
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
        previous_level = config.league_level(previous_league, config.league_level_strict(season["leagueCode"]))
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
                "promotionAdjusted": previous_level > config.league_level_strict(season["leagueCode"]),
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
        winter = round_number >= config.winter_start_round(season["leagueCode"], int(season["roundCount"]))
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
            "startMatchday": config.winter_start_round(season["leagueCode"], int(season["roundCount"])),
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
            "startMatchday": config.winter_start_round(season["leagueCode"], int(season["roundCount"])),
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

def validate_publication(recommendation: Mapping[str, Any]) -> None:
    """Fail closed on implausible or internally inconsistent published teams."""
    season_evidence = recommendation.get("currentSeasonEvidence")
    if not season_evidence:
        raise RuntimeError("Veröffentlichung abgebrochen: Audit der aktuellen Saison fehlt.")
    if int(season_evidence.get("throughMatchday", -1)) > 0 and int(season_evidence.get("roleObservations", 0)) < 25:
        raise RuntimeError("Veröffentlichung abgebrochen: aktuelle Saison enthält zu wenige Rollenbeobachtungen.")
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
        if len(goalkeepers) != config.interactive_roster_counts()["GK"] or len({player["teamId"] for player in goalkeepers}) != 1:
            raise RuntimeError(
                "Veröffentlichung abgebrochen: Interactive-Kader enthält keine vollständige Torwartversicherung."
            )
        winter_goalkeepers = {player["id"]: player["team"] for player in goalkeepers}
        for transfer in recommendation.get("winterPlan", {}).get("transfers", []):
            if transfer["position"] != "GK":
                continue
            winter_goalkeepers.pop(transfer["sell"]["id"], None)
            winter_goalkeepers[transfer["buy"]["id"]] = transfer["buy"]["team"]
        if len(winter_goalkeepers) != config.interactive_roster_counts()["GK"] or len(set(winter_goalkeepers.values())) != 1:
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
    realized_through = int(recommendation.get("currentSeasonEvidence", {}).get("throughMatchday", 0))
    for matchday in recommendation.get("projectedMatchdays", []):
        if int(matchday["matchday"]) <= realized_through:
            continue
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
    output_dir: Optional[Path] = None,
) -> None:
    validate_publication(recommendation)
    role_signals = load_current_role_signals(season)
    availability_signals = load_current_availability_signals(season)
    performance_benchmark = load_external_performance_benchmark()
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
            "currentSeasonEvidence": recommendation["currentSeasonEvidence"],
            "externalPerformanceBenchmark": (
                None
                if performance_benchmark is None or str(performance_benchmark["league"]) != str(season["leagueCode"])
                else {
                    "provider": performance_benchmark["provider"],
                    "generatedAt": performance_benchmark["generatedAt"],
                    "sourceUrl": performance_benchmark["sourceUrl"],
                    "season": performance_benchmark["season"],
                    "matchedPlayers": performance_benchmark["matchedPlayers"],
                    "currentSeasonPlayersCovered": performance_benchmark["currentSeasonPlayersCovered"],
                    "metrics": performance_benchmark["metrics"],
                    "method": performance_benchmark["method"],
                }
            ),
            "trainingRows": training_rows,
            "trainingThroughSeason": f"{training_end_year}/{str(training_end_year + 1)[-2:]}",
        },
        "validation": validation,
        "recommendation": recommendation,
    }
    if output_dir is None:
        output_dir = config.paths().recommendations_dir
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
    output_dir: Optional[Path] = None,
) -> None:
    validate_publication(recommendation)
    role_signals = load_current_role_signals(season)
    availability_signals = load_current_availability_signals(season)
    performance_benchmark = load_external_performance_benchmark()
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
            "currentSeasonEvidence": recommendation["currentSeasonEvidence"],
            "externalPerformanceBenchmark": (
                None
                if performance_benchmark is None or str(performance_benchmark["league"]) != str(season["leagueCode"])
                else {
                    "provider": performance_benchmark["provider"],
                    "generatedAt": performance_benchmark["generatedAt"],
                    "sourceUrl": performance_benchmark["sourceUrl"],
                    "season": performance_benchmark["season"],
                    "matchedPlayers": performance_benchmark["matchedPlayers"],
                    "currentSeasonPlayersCovered": performance_benchmark["currentSeasonPlayersCovered"],
                    "metrics": performance_benchmark["metrics"],
                    "method": performance_benchmark["method"],
                }
            ),
            "trainingRows": training_rows,
            "trainingThroughSeason": f"{training_end_year}/{str(training_end_year + 1)[-2:]}",
        },
        "validation": validation,
        "recommendation": recommendation,
    }
    if output_dir is None:
        output_dir = config.paths().recommendations_dir
    output_dir.mkdir(parents=True, exist_ok=True)
    path = output_dir / f"{season['id']}-classic.json"
    path.write_text(json.dumps(artifact, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(
        f"{season['id']}-classic v2: {recommendation['projectedStartingPoints']} erwartete Punkte, "
        f"{recommendation['spentM']:.2f} Mio. €",
        flush=True,
    )
