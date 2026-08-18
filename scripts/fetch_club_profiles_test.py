from __future__ import annotations

import importlib.util
import json
import unittest
from pathlib import Path


SCRIPT_PATH = Path(__file__).with_name("fetch-club-profiles.py")
SPEC = importlib.util.spec_from_file_location("fetch_club_profiles", SCRIPT_PATH)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)
DATA_ROOT = SCRIPT_PATH.parents[1] / "frontend" / "public" / "data"


class ProfileParserTests(unittest.TestCase):
    def test_parses_money_variants(self) -> None:
        self.assertEqual(MODULE.parse_money("4,50 Mio. €"), {"raw": "4,50 Mio. €", "eur": 4_500_000, "kind": "fee"})
        self.assertEqual(MODULE.parse_money("ablösefrei"), {"raw": "ablösefrei", "eur": 0, "kind": "free"})
        self.assertEqual(MODULE.parse_money("Leih-Ende"), {"raw": "Leih-Ende", "eur": None, "kind": "loanEnd"})
        self.assertIsNone(MODULE.parse_money("?"))

    def test_aggregates_only_club_appearances(self) -> None:
        def performance(club_id: int, state: str = "played", goals: int | None = 0, assists: int | None = 0,
                        national: bool = False, competition_type: int = 1) -> dict:
            return {
                "gameInformation": {"isNationalGame": national, "competitionTypeId": competition_type},
                "clubsInformation": {"club": {"clubId": str(club_id)}},
                "statistics": {
                    "generalStatistics": {"participationState": state},
                    "goalStatistics": {"goalsScoredTotal": goals, "assists": assists},
                },
            }

        payload = {"data": {"performance": [
            performance(27, goals=2, assists=1),
            performance(27, goals=None, assists=None),
            performance(27, state="in squad"),
            performance(3299, goals=1, national=True, competition_type=11),
            performance(148, goals=1),
        ]}}

        self.assertEqual(MODULE.parse_player_performance(payload), [
            {"clubId": 27, "appearances": 2, "goals": 2, "assists": 1},
            {"clubId": 148, "appearances": 1, "goals": 1, "assists": 0},
        ])

    def test_matches_unique_short_name(self) -> None:
        self.assertEqual(MODULE.match_by_name("grimaldo", {"1": "alejandro grimaldo", "2": "manuel neuer"}), "1")
        self.assertIsNone(MODULE.match_by_name("mueller", {"1": "thomas mueller", "2": "florian mueller"}))


class ProfileArtifactTests(unittest.TestCase):
    def test_current_profile_artifacts_match_the_catalog(self) -> None:
        catalog = json.loads((DATA_ROOT / "catalog.json").read_text())
        for league in ("0001", "0002", "0003"):
            current = max(
                (season for season in catalog["seasons"] if season["leagueCode"] == league),
                key=lambda season: season["startYear"],
            )
            profiles = json.loads((DATA_ROOT / "club-profiles" / f"{league}.json").read_text())
            careers = json.loads((DATA_ROOT / "player-careers" / f"{league}.json").read_text())

            self.assertEqual(profiles["schemaVersion"], 1)
            self.assertEqual(careers["schemaVersion"], 1)
            self.assertEqual(profiles["leagueCode"], league)
            self.assertEqual(careers["leagueCode"], league)
            self.assertEqual(profiles["season"], current["startYear"])
            self.assertEqual(careers["season"], current["startYear"])
            self.assertEqual(set(profiles["teams"]), set(current["teamIds"]))

            squad_players = {
                player_id
                for team in profiles["teams"].values()
                for player_id in team["squad"]
            }
            self.assertEqual(squad_players, set(careers["players"]))
            self.assertGreaterEqual(len(squad_players), len(current["players"]) * 0.85)

            for player in careers["players"].values():
                self.assertGreater(player["tmId"], 0)
                for club in player["clubs"]:
                    self.assertTrue(club["name"])
                    self.assertGreaterEqual(club["appearances"], 0)
                    self.assertGreaterEqual(club["goals"], 0)
                    self.assertGreaterEqual(club["assists"], 0)


if __name__ == "__main__":
    unittest.main()
