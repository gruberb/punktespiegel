"""Exact hindsight roster oracles used to audit the optimizer.

These models deliberately use realized points. They are not forecasts and must
never be used to publish a future team. Their purpose is to prove that the MIP
can recover the highest-scoring legal roster represented by a season artifact
and to put forecast-selected rosters in context.
"""

from __future__ import annotations

import json
from collections import defaultdict
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Dict, List, Mapping, Optional, Sequence, Tuple

import highspy

from . import config
from .artifact import actual_points, formation_label
from .domain import FORMATIONS, POSITIONS, rounded
from .optimize import solver_diagnostics


@dataclass
class OracleResult:
    mode: str
    selected_ids: List[str]
    starter_ids: List[str]
    reserve_ids: List[str]
    lineups: Dict[int, List[str]]
    formations: Dict[int, Dict[str, int]]
    realized_points: int
    spent_m: float
    solver_status: str
    mip_gap: float
    optimal_proven: bool
    goalkeepers_from_same_team: bool = False
    max_field_players_from_team: Optional[int] = None


def _eligible_players(
    season: Mapping[str, Any],
    budget_m: float,
) -> Dict[str, Mapping[str, Any]]:
    return {
        str(player["id"]): player
        for player in season["players"]
        if bool(player.get("active", True))
        and bool(player.get("selectable", True))
        and 0.0 <= float(player["priceM"]) < 999.0
        and float(player["priceM"]) <= budget_m
    }


def _run_exact_mip(
    model: highspy.HighsLp,
    label: str,
    time_limit: float,
) -> Tuple[highspy.Highs, Sequence[float], str, float, bool]:
    solver = highspy.Highs()
    solver.setOptionValue("output_flag", False)
    solver.setOptionValue("time_limit", time_limit)
    solver.setOptionValue("mip_rel_gap", 0.0)
    solver.setOptionValue("random_seed", 42)
    status = solver.passModel(model)
    if status != highspy.HighsStatus.kOk:
        raise RuntimeError(f"{label}: HiGHS konnte das Modell nicht laden: {status}")
    solver.run()
    model_status = solver.getModelStatus()
    if model_status not in (highspy.HighsModelStatus.kOptimal, highspy.HighsModelStatus.kTimeLimit):
        raise RuntimeError(
            f"{label}: kein zertifizierbarer Incumbent; erhalten: "
            f"{solver.modelStatusToString(model_status)}"
        )
    solver_status, mip_gap = solver_diagnostics(
        solver,
        model_status,
        label,
        maximum_mip_gap=0.005,
    )
    return (
        solver,
        solver.getSolution().col_value,
        solver_status,
        mip_gap,
        model_status == highspy.HighsModelStatus.kOptimal,
    )


def optimize_interactive_oracle(
    season: Mapping[str, Any],
    *,
    time_limit: float = 180.0,
    goalkeepers_from_same_team: bool = False,
    max_field_players_from_team: Optional[int] = None,
) -> OracleResult:
    """Find the exact fixed-roster hindsight maximum with legal daily formations."""

    rules = config.rules_for(season, "interactive")
    players = _eligible_players(season, rules.budget_m)
    player_ids = sorted(players)
    rounds = list(range(1, int(season["roundCount"]) + 1))
    points_by_round, _ = actual_points(season)

    costs: List[float] = []
    lower: List[float] = []
    upper: List[float] = []
    integrality: List[highspy.HighsVarType] = []

    def add_binary(cost: float = 0.0) -> int:
        index = len(costs)
        costs.append(cost)
        lower.append(0.0)
        upper.append(1.0)
        integrality.append(highspy.HighsVarType.kInteger)
        return index

    # Lexicographic objective: realized points first, then lower spend. One
    # point outweighs the entire legal budget, so price can only break ties.
    point_scale = 100_000.0
    x_index = {
        player_id: add_binary(round(float(players[player_id]["priceM"]) * 100))
        for player_id in player_ids
    }
    y_index = {
        (player_id, round_number): add_binary(
            -point_scale * points_by_round.get((round_number, player_id), 0.0)
        )
        for round_number in rounds
        for player_id in player_ids
    }
    z_index = {
        (round_number, formation_index): add_binary()
        for round_number in rounds
        for formation_index in range(len(FORMATIONS))
    }
    goalkeeper_team_index: Dict[str, int] = {}
    goalkeepers_by_team: Dict[str, List[str]] = defaultdict(list)
    if goalkeepers_from_same_team:
        for player_id in player_ids:
            if players[player_id]["position"] == "GK":
                goalkeepers_by_team[str(players[player_id]["teamId"])].append(player_id)
        eligible_teams = sorted(
            team_id
            for team_id, goalkeeper_ids in goalkeepers_by_team.items()
            if len(goalkeeper_ids) >= rules.roster_counts["GK"]
        )
        if not eligible_teams:
            raise RuntimeError("Interactive-Orakel: keine vollständige Torwartversicherung möglich.")
        goalkeeper_team_index = {team_id: add_binary() for team_id in eligible_teams}

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
        {x_index[player_id]: round(float(players[player_id]["priceM"]) * 100) for player_id in player_ids},
        -highspy.kHighsInf,
        round(rules.budget_m * 100),
    )
    for position in POSITIONS:
        add_row(
            {
                x_index[player_id]: 1.0
                for player_id in player_ids
                if players[player_id]["position"] == position
            },
            rules.roster_counts[position],
            rules.roster_counts[position],
        )
    if max_field_players_from_team is not None:
        for team_id in sorted({str(player["teamId"]) for player in players.values()}):
            add_row(
                {
                    x_index[player_id]: 1.0
                    for player_id in player_ids
                    if players[player_id]["position"] != "GK"
                    and str(players[player_id]["teamId"]) == team_id
                },
                -highspy.kHighsInf,
                float(max_field_players_from_team),
            )
    if goalkeepers_from_same_team:
        add_row({index: 1.0 for index in goalkeeper_team_index.values()}, 1.0, 1.0)
        for team_id, goalkeeper_ids in goalkeepers_by_team.items():
            coefficients = {x_index[player_id]: 1.0 for player_id in goalkeeper_ids}
            if team_id in goalkeeper_team_index:
                coefficients[goalkeeper_team_index[team_id]] = -float(rules.roster_counts["GK"])
            add_row(coefficients, 0.0, 0.0)
    for round_number in rounds:
        add_row(
            {y_index[(player_id, round_number)]: 1.0 for player_id in player_ids},
            11.0,
            11.0,
        )
        add_row(
            {z_index[(round_number, index)]: 1.0 for index in range(len(FORMATIONS))},
            1.0,
            1.0,
        )
        for player_id in player_ids:
            add_row(
                {y_index[(player_id, round_number)]: 1.0, x_index[player_id]: -1.0},
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

    _solver, solution, solver_status, mip_gap, optimal_proven = _run_exact_mip(
        model,
        "Interactive-Historienorakel",
        time_limit,
    )
    selected_ids = [player_id for player_id in player_ids if solution[x_index[player_id]] > 0.5]
    lineups = {
        round_number: [
            player_id
            for player_id in player_ids
            if solution[y_index[(player_id, round_number)]] > 0.5
        ]
        for round_number in rounds
    }
    formations: Dict[int, Dict[str, int]] = {}
    for round_number in rounds:
        formation_index = next(
            index
            for index in range(len(FORMATIONS))
            if solution[z_index[(round_number, index)]] > 0.5
        )
        formations[round_number] = dict(FORMATIONS[formation_index])
    realized_points = round(
        sum(
            points_by_round.get((round_number, player_id), 0.0)
            for round_number, lineup in lineups.items()
            for player_id in lineup
        )
    )
    return OracleResult(
        mode="interactive",
        selected_ids=selected_ids,
        starter_ids=[],
        reserve_ids=[],
        lineups=lineups,
        formations=formations,
        realized_points=realized_points,
        spent_m=rounded(sum(float(players[player_id]["priceM"]) for player_id in selected_ids), 2),
        solver_status=solver_status,
        mip_gap=mip_gap,
        optimal_proven=optimal_proven,
        goalkeepers_from_same_team=goalkeepers_from_same_team,
        max_field_players_from_team=max_field_players_from_team,
    )


def _result_payload(
    season: Mapping[str, Any],
    result: OracleResult,
) -> Dict[str, Any]:
    players = {str(player["id"]): player for player in season["players"]}
    teams = {str(team["id"]): team for team in season["teams"]}
    payload = asdict(result)
    payload["players"] = [
        {
            "id": player_id,
            "name": players[player_id]["name"],
            "position": players[player_id]["position"],
            "team": teams[str(players[player_id]["teamId"])]["name"],
            "priceM": players[player_id]["priceM"],
            "role": (
                "start"
                if player_id in result.starter_ids
                else "reserve"
                if player_id in result.reserve_ids
                else "roster"
            ),
        }
        for player_id in result.selected_ids
    ]
    payload["formations"] = {
        str(round_number): formation_label(formation)
        for round_number, formation in result.formations.items()
    }
    payload.pop("selected_ids")
    payload.pop("starter_ids")
    payload.pop("reserve_ids")
    payload.pop("lineups")
    return payload


def build_historical_audit(
    seasons: Sequence[Mapping[str, Any]],
    leagues: Sequence[str],
    *,
    time_limit: float,
) -> Dict[str, Any]:
    rows: List[Dict[str, Any]] = []
    for season in sorted(seasons, key=lambda item: (str(item["leagueCode"]), int(item["startYear"]))):
        league = str(season["leagueCode"])
        if league not in leagues or int(season.get("latestRound", 0)) < int(season["roundCount"]):
            continue
        print(f"Historienorakel {season['displayName']} · {league}", flush=True)
        interactive = optimize_interactive_oracle(season, time_limit=time_limit)
        insured = optimize_interactive_oracle(
            season,
            time_limit=time_limit,
            goalkeepers_from_same_team=True,
            max_field_players_from_team=3,
        )
        benchmarks = config.historical_benchmarks(league)
        winner_points: Optional[int] = benchmarks["interactiveWinnerPoints"].get(int(season["startYear"]))
        rows.append(
            {
                "seasonId": season["id"],
                "league": league,
                "season": season["displayName"],
                "artifactMetadataAtDecisionTime": False,
                "classicHistoricalScoringComparable": int(season["startYear"]) >= 2024,
                "interactiveWinnerPoints": winner_points,
                "interactiveOracle": _result_payload(season, interactive),
                "interactiveInsuredDiversifiedOracle": _result_payload(season, insured),
                "interactiveOracleMinusWinner": (
                    None if winner_points is None else interactive.realized_points - winner_points
                ),
                "interactiveInsuredDiversifiedOracleMinusWinner": (
                    None if winner_points is None else insured.realized_points - winner_points
                ),
                "insuranceOpportunityCost": interactive.realized_points - insured.realized_points,
                "classicOracle": {
                    "status": "not-run-on-full-pool",
                    "reason": (
                        "exact automatic-reserve interactions leave a wide MIP bound on the full historical "
                        "player pool; Classic is constraint-checked and exactly rescored, but is not mislabeled "
                        "as a proven global hindsight optimum"
                    ),
                },
            }
        )
    return {
        "schemaVersion": 1,
        "kind": "historical-hindsight-optimizer-audit",
        "leagues": list(leagues),
        "winterTransfersModeled": False,
        "interactiveRules": (
            "fixed 22-player roster, exact 3/7/7/5 quotas, budget ceiling, no club limit, "
            "one legal formation and eleven players per matchday"
        ),
        "classicRules": (
            "fixed 15-player roster and slots, season-correct 3-5-2/4-4-2 quotas, budget ceiling, "
            "three-player club limit, exact automatic reserve activation"
        ),
        "interpretation": (
            "Realized points are supplied to the solver as a hindsight upper bound. This proves optimization "
            "and constraint handling, not forecast skill. Historical price/selectability fields are not proven "
            "kickoff snapshots."
        ),
        "seasons": rows,
    }


def write_historical_audit(payload: Mapping[str, Any], destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
