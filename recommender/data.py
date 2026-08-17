"""Laden der Saisonartefakte und Prüfung des Datenvertrags."""

from __future__ import annotations

import json
from collections import defaultdict
from pathlib import Path
from typing import Any, Dict, List, Mapping, Set, Tuple

import numpy as np

from . import config
from .domain import ROLE_DNP, ROLE_START, ROLE_SUB, SCORING_COMPONENTS
from .features import score_role


def load_json(path: Path) -> Dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def load_data() -> Tuple[Dict[str, Any], List[Dict[str, Any]]]:
    catalog = load_json(config.paths().data_dir / "catalog.json")
    seasons = [load_json(path) for path in sorted(config.paths().seasons_dir.glob("se-k*.json"))]
    if not seasons:
        raise RuntimeError("Keine Saisonartefakte gefunden.")
    for season in seasons:
        validate_score_contract(season)
    return catalog, seasons

def validate_score_contract(season: Mapping[str, Any]) -> None:
    scores = list(season.get("scores", []))
    if not scores:
        return
    required = {"matchId", "playerId", "teamId", "totalPoints", *SCORING_COMPONENTS}
    roles: Set[int] = set()
    dnp_count = 0
    rows_by_match: Dict[str, int] = defaultdict(int)
    rows_by_match_team: Dict[Tuple[str, str], int] = defaultdict(int)
    for index, score in enumerate(scores):
        missing = sorted(required.difference(score))
        if missing:
            raise RuntimeError(f"{season['id']}: Score-Zeile {index} fehlt {', '.join(missing)}.")
        normalized_total = sum(int(score[field] or 0) for field in SCORING_COMPONENTS)
        if normalized_total != int(score["totalPoints"]):
            raise RuntimeError(
                f"{season['id']}: totalPoints ist nicht aus den aktuellen Komponenten normalisiert "
                f"({score['playerId']} / {score['matchId']})."
            )
        role = score_role(score)
        roles.add(role)
        dnp_count += int(role == ROLE_DNP)
        rows_by_match[str(score["matchId"])] += 1
        rows_by_match_team[(str(score["matchId"]), str(score["teamId"]))] += 1
    if roles != {ROLE_DNP, ROLE_SUB, ROLE_START}:
        raise RuntimeError(f"{season['id']}: unvollständige Rollenklassen {sorted(roles)}.")
    dnp_prevalence = dnp_count / len(scores)
    if not 0.10 <= dnp_prevalence <= 0.80:
        raise RuntimeError(f"{season['id']}: unplausible DNP-Quote {dnp_prevalence:.1%}.")
    if rows_by_match and min(rows_by_match.values()) < 25:
        raise RuntimeError(f"{season['id']}: mindestens ein Spiel enthält weniger als 25 Spielerbeobachtungen.")
    for match in season["matches"]:
        match_id = str(match["id"])
        if match_id not in rows_by_match:
            continue
        for team_id in (str(match["homeTeamId"]), str(match["awayTeamId"])):
            # Historical 3. Liga artifacts can reconstruct affiliations from
            # appearances and therefore contain fewer inactive squad members.
            if rows_by_match_team[(match_id, team_id)] < 8:
                raise RuntimeError(
                    f"{season['id']}: {match_id}/{team_id} enthält weniger als acht Rollenbeobachtungen."
                )
