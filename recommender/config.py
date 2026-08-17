"""Konfigurationszugriff für den Empfehlungsgenerator.

Alle liga-spezifischen Werte (Budgets, Ligastufen, Winterstart, Transferlimits)
liegen in JSON-Dateien unter config/recommender/, eine Datei je Liga plus
defaults.json für spielweite Kaderregeln und Modell-Voreinstellungen. Der
Generator lädt diese Dateien einmal über initialize(); alle Module greifen
danach über die Accessor-Funktionen zu. Unbekannte Liga-Codes lösen wie zuvor
einen KeyError aus, damit Tippfehler nicht still zu Fallback-Werten führen.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Mapping, Optional, Sequence, Tuple

from .domain import Rules

REPO_ROOT = Path(__file__).resolve().parent.parent

_BUILTIN_MODEL_DEFAULTS = {
    "iterations": 180,
    "validationIterations": 120,
    "timeLimitSeconds": 180.0,
    "classicResidualWeight": 0.5,
    "classicScenarios": 4,
}
_BUILTIN_BASELINE = {
    "command": ["node", "--experimental-strip-types", "scripts/backtest-manager-baseline.ts"],
    "cwdRelativeToRepoRoot": ".",
}
_BUILTIN_SQUAD_RULES = {
    "classic": {
        "rosterCounts": {"GK": 2, "DEF": 5, "MID": 5, "FWD": 3},
        "starterCounts": {"GK": 1, "DEF": 4, "MID": 4, "FWD": 2},
    },
    "interactive": {
        "rosterCounts": {"GK": 3, "DEF": 7, "MID": 7, "FWD": 5},
        "goalkeepersFromSameTeam": True,
    },
}


@dataclass(frozen=True)
class RunPaths:
    data_dir: Path
    seasons_dir: Path
    recommendations_dir: Path
    role_signal_path: Path
    availability_signal_path: Path
    performance_benchmark_path: Path

    @staticmethod
    def for_data_dir(data_dir: Path, output_dir: Optional[Path] = None) -> "RunPaths":
        return RunPaths(
            data_dir=data_dir,
            seasons_dir=data_dir / "seasons",
            recommendations_dir=output_dir if output_dir is not None else data_dir / "recommendations",
            role_signal_path=data_dir / "current-role-signals.json",
            availability_signal_path=data_dir / "current-availability-signals.json",
            performance_benchmark_path=data_dir / "external-performance-benchmark.json",
        )


@dataclass(frozen=True)
class LeagueConfig:
    code: str
    name: str
    level: int
    winter_start_round: int
    classic_budget_m: float
    classic_max_from_team: int
    classic_transfer_limit: int
    interactive_budget_m: float
    interactive_transfer_limit: int
    interactive_transfer_limit_overrides: Tuple[Tuple[int, int], ...]


@dataclass
class _State:
    leagues: Dict[str, LeagueConfig]
    model_defaults: Dict[str, Any]
    baseline: Dict[str, Any]
    squad_rules: Dict[str, Any]
    paths: RunPaths


_STATE: Optional[_State] = None


def _load_json(path: Path) -> Dict[str, Any]:
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def _league_config(payload: Mapping[str, Any], source: Path) -> LeagueConfig:
    if int(payload.get("schemaVersion", 0)) != 1:
        raise ValueError(f"{source}: unbekannte schemaVersion, erwartet 1")
    league = payload["league"]
    classic = payload["classic"]
    interactive = payload["interactive"]
    overrides = tuple(
        sorted(
            (int(entry["fromSeason"]), int(entry["limit"]))
            for entry in interactive.get("transferLimitOverrides", [])
        )
    )
    return LeagueConfig(
        code=str(league["code"]),
        name=str(league["name"]),
        level=int(league["level"]),
        winter_start_round=int(payload["winterStartRound"]),
        classic_budget_m=float(classic["budgetM"]),
        classic_max_from_team=int(classic["maxFromTeam"]),
        classic_transfer_limit=int(classic["transferLimit"]),
        interactive_budget_m=float(interactive["budgetM"]),
        interactive_transfer_limit=int(interactive["transferLimit"]),
        interactive_transfer_limit_overrides=overrides,
    )


def initialize(config_dir: Path, data_dir: Path, output_dir: Optional[Path] = None) -> None:
    """Lädt Liga-Konfigurationen und Laufpfade; muss vor allen Accessors laufen."""
    global _STATE
    leagues: Dict[str, LeagueConfig] = {}
    for path in sorted(config_dir.glob("*.json")):
        if path.name == "defaults.json":
            continue
        league = _league_config(_load_json(path), path)
        if league.code in leagues:
            raise ValueError(f"Liga-Code {league.code} ist doppelt konfiguriert ({path})")
        leagues[league.code] = league
    if not leagues:
        raise ValueError(f"Keine Liga-Konfigurationen unter {config_dir} gefunden")
    defaults_path = config_dir / "defaults.json"
    defaults = _load_json(defaults_path) if defaults_path.exists() else {}
    _STATE = _State(
        leagues=leagues,
        model_defaults={**_BUILTIN_MODEL_DEFAULTS, **defaults.get("model", {})},
        baseline={**_BUILTIN_BASELINE, **defaults.get("baseline", {})},
        squad_rules=defaults.get("squadRules", _BUILTIN_SQUAD_RULES),
        paths=RunPaths.for_data_dir(data_dir, output_dir),
    )


def _state() -> _State:
    if _STATE is None:
        raise RuntimeError("recommender.config.initialize() wurde noch nicht aufgerufen")
    return _STATE


def paths() -> RunPaths:
    return _state().paths


def league_codes() -> Tuple[str, ...]:
    return tuple(sorted(_state().leagues))


def league_name(code: str) -> str:
    return _state().leagues[code].name


def classic_budget(code: str) -> float:
    return _state().leagues[code].classic_budget_m


def interactive_budget(code: str) -> float:
    return _state().leagues[code].interactive_budget_m


def league_level(code: str, default: int) -> int:
    league = _state().leagues.get(code)
    return league.level if league is not None else default


def league_level_strict(code: str) -> int:
    return _state().leagues[code].level


def winter_start_round(league: str, round_count: int) -> int:
    config = _state().leagues.get(league)
    return config.winter_start_round if config is not None else round_count // 2 + 1


def classic_roster_counts() -> Dict[str, int]:
    return _state().squad_rules["classic"]["rosterCounts"]


def classic_starter_counts() -> Dict[str, int]:
    return _state().squad_rules["classic"]["starterCounts"]


def interactive_roster_counts() -> Dict[str, int]:
    return _state().squad_rules["interactive"]["rosterCounts"]


def model_default(key: str) -> Any:
    return _state().model_defaults[key]


def baseline_command() -> Sequence[str]:
    return list(_state().baseline["command"])


def baseline_cwd() -> Path:
    return (REPO_ROOT / str(_state().baseline.get("cwdRelativeToRepoRoot", "."))).resolve()


def _interactive_transfer_limit(config: LeagueConfig, start_year: int) -> int:
    limit = config.interactive_transfer_limit
    for from_season, override in config.interactive_transfer_limit_overrides:
        if start_year >= from_season:
            limit = override
    return limit


def rules_for(season: Mapping[str, Any], mode: str) -> Rules:
    league = str(season["leagueCode"])
    start_year = int(season["startYear"])
    round_count = int(season["roundCount"])
    if mode == "classic":
        config = _state().leagues[league]
        return Rules(
            mode=mode,
            league=league,
            season=start_year,
            budget_m=config.classic_budget_m,
            roster_counts=classic_roster_counts(),
            starter_counts=classic_starter_counts(),
            max_from_team=config.classic_max_from_team,
            transfer_limit=config.classic_transfer_limit,
            winter_start_round=winter_start_round(league, round_count),
            fixed_classic_slots=True,
        )
    if mode == "interactive":
        config = _state().leagues[league]
        return Rules(
            mode=mode,
            league=league,
            season=start_year,
            budget_m=config.interactive_budget_m,
            roster_counts=interactive_roster_counts(),
            starter_counts=None,
            max_from_team=None,
            transfer_limit=_interactive_transfer_limit(config, start_year),
            winter_start_round=winter_start_round(league, round_count),
            fixed_classic_slots=False,
        )
    raise ValueError(f"Unbekannter Manager-Modus: {mode}")
