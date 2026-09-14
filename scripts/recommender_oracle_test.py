from __future__ import annotations

import unittest
from pathlib import Path

from recommender import config
from recommender.oracle import optimize_interactive_oracle


class HistoricalOracleTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        repo_root = Path(__file__).resolve().parent.parent
        config.initialize(repo_root / "config" / "recommender", repo_root / "frontend" / "public" / "data")

    def test_interactive_uses_budget_as_a_ceiling_and_maximizes_points(self) -> None:
        counts = {"GK": 3, "DEF": 7, "MID": 7, "FWD": 5}
        teams = [
            {"id": f"team-{index}", "name": f"Team {index}", "code": f"T{index}"}
            for index in range(10)
        ]
        players = []
        scores = []
        weak_expensive_ids = set()
        for position_index, (position, required) in enumerate(counts.items()):
            for index in range(required + 1):
                player_id = f"{position}-{index}"
                weak_expensive = index == required
                if weak_expensive:
                    weak_expensive_ids.add(player_id)
                players.append(
                    {
                        "id": player_id,
                        "name": player_id,
                        "teamId": teams[(position_index + index) % len(teams)]["id"],
                        "position": position,
                        "priceM": 2.0 if weak_expensive else 0.5,
                        "active": True,
                        "selectable": True,
                    }
                )
                points = 1 if weak_expensive else 20 - index
                scores.append(
                    {
                        "matchId": "match-1",
                        "playerId": player_id,
                        "teamId": teams[(position_index + index) % len(teams)]["id"],
                        "totalPoints": points,
                        "pointsStarter": 4,
                        "pointsJoker": 0,
                    }
                )
        season = {
            "id": "test-season",
            "leagueCode": "0001",
            "leagueName": "Bundesliga",
            "startYear": 2026,
            "displayName": "2026/27",
            "roundCount": 1,
            "latestRound": 1,
            "teams": teams,
            "players": players,
            "matches": [{"id": "match-1", "round": 1}],
            "scores": scores,
        }

        result = optimize_interactive_oracle(season, time_limit=10)

        self.assertTrue(result.optimal_proven)
        self.assertEqual(result.mip_gap, 0.0)
        self.assertEqual(len(result.selected_ids), 22)
        self.assertEqual(len(result.lineups[1]), 11)
        self.assertTrue(weak_expensive_ids.isdisjoint(result.selected_ids))
        self.assertEqual(result.spent_m, 11.0)
        self.assertLess(result.spent_m, 42.5)


if __name__ == "__main__":
    unittest.main()

