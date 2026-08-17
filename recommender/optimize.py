"""HiGHS-Kaderoptimierung für Interactive und Classic inklusive Validierungen."""

from __future__ import annotations

import math
from collections import defaultdict
from typing import Any, Dict, List, Mapping, Optional, Sequence, Set, Tuple

import highspy
import numpy as np

from . import config
from .domain import ClassicOptimizationResult, FORMATIONS, Forecast, OptimizationResult, POSITIONS, mean, rounded
from .forecast import role_conditioned_forecast


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
    rules = config.rules_for(season, "classic")
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
    rules = config.rules_for(season, "classic")
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
    rules = config.rules_for(season, "interactive")
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
    if len(goalkeeper_ids) != config.interactive_roster_counts()["GK"] or len(goalkeeper_teams) != 1:
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

    rules = config.rules_for(season, "classic")
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
    winter_round = config.rules_for(season, "classic").winter_start_round
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
