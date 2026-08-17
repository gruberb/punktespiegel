"""Zustands-Replay und Feature-Bau für das Rollen- und Punktemodell."""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta
from typing import Any, Dict, List, Mapping, MutableMapping, Sequence, Tuple

import numpy as np

from . import config
from .domain import FEATURE_NAMES, Observation, POSITIONS, PlayerState, ROLE_DNP, ROLE_START, ROLE_SUB, TeamState, mean, parse_time


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
    current_level = config.league_level(league, 3)
    previous_level = config.league_level(previous_league, current_level)
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
