#!/usr/bin/env python3
"""Fetch static Bundesliga Topelf signals from configured public source pages."""

from __future__ import annotations

import argparse
import html
import json
import re
import unicodedata
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from typing import Any, Mapping, Sequence
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "frontend" / "public" / "data"
CONFIG_PATH = ROOT / "config" / "external-sources.json"
OUTPUT_PATH = DATA_DIR / "current-role-signals.json"
USER_AGENT = "punktespiegel/1.5 (+https://github.com/gruberb/punktespiegel)"


def normalize(value: str) -> str:
    value = html.unescape(re.sub(r"<[^>]+>", " ", value))
    value = "".join(character for character in unicodedata.normalize("NFKD", value) if not unicodedata.combining(character))
    value = value.translate(str.maketrans({"ø": "o", "đ": "d", "ð": "d", "ł": "l", "æ": "ae", "ß": "ss"}))
    return re.sub(r"[^a-z0-9]+", " ", value.lower()).strip()


class TopelfParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.depth = 0
        self.stadium_depth: int | None = None
        self.column_depth: int | None = None
        self.player_name_depth: int | None = None
        self.href: str | None = None
        self.text: list[str] = []
        self.column_has_primary = False
        self.players: list[dict[str, str]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attributes = dict(attrs)
        if tag == "div":
            self.depth += 1
            classes = set((attributes.get("class") or "").split())
            if "stadium_container_bg" in classes and self.stadium_depth is None:
                self.stadium_depth = self.depth
            elif self.stadium_depth is not None and "player_position_column" in classes:
                self.column_depth = self.depth
                self.column_has_primary = False
            elif self.column_depth is not None and "player_name" in classes:
                self.player_name_depth = self.depth
        elif tag == "a" and self.player_name_depth is not None:
            self.href = attributes.get("href")
            self.text = []

    def handle_data(self, data: str) -> None:
        if self.href is not None:
            self.text.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag == "a" and self.href is not None:
            name = html.unescape("".join(self.text)).strip()
            if name and self.href:
                self.players.append({
                    "name": name,
                    "url": f"https://www.ligainsider.de{self.href}",
                    "role": "starter" if not self.column_has_primary else "alternative",
                })
                self.column_has_primary = True
            self.href = None
            self.text = []
        elif tag == "div":
            if self.player_name_depth == self.depth:
                self.player_name_depth = None
            if self.column_depth == self.depth:
                self.column_depth = None
            if self.stadium_depth == self.depth:
                self.stadium_depth = None
            self.depth -= 1


def parse_topelf(page: str) -> tuple[str | None, list[dict[str, str]]]:
    updated = re.search(r"Letzte Aktualisierung:.*?\|\s*([^<]+)", page, flags=re.DOTALL)
    parser = TopelfParser()
    parser.feed(page)
    return (html.unescape(updated.group(1)).strip() if updated else None), parser.players


def parse_headlines(page: str) -> list[dict[str, str]]:
    if "AKTUELLE THEMEN DES VEREINS" not in page:
        return []
    section = page.split("AKTUELLE THEMEN DES VEREINS", 1)[1].split('class="carousel_slider_area', 1)[0]
    result: list[dict[str, str]] = []
    seen: set[str] = set()
    for url, title in re.findall(r'<strong><a href="([^"]+)">(.*?)</a></strong>', section, flags=re.DOTALL):
        absolute = url if url.startswith("http") else f"https://www.ligainsider.de{url}"
        if absolute in seen:
            continue
        seen.add(absolute)
        clean_title = html.unescape(re.sub(r"<[^>]+>", "", title)).replace("\u00ad", "").strip()
        result.append({"source": "LigaInsider", "title": clean_title, "url": absolute})
    return result[:6]


def match_player(source_name: str, players: Sequence[Mapping[str, Any]]) -> Mapping[str, Any] | None:
    target = normalize(source_name)
    exact = [player for player in players if normalize(str(player["name"])) == target]
    if len(exact) == 1:
        return exact[0]
    suffix = [player for player in players if normalize(str(player["name"])).endswith(f" {target}") or target.endswith(f" {normalize(str(player['name']))}")]
    if len(suffix) == 1:
        return suffix[0]
    source_tokens = target.split()
    fuzzy = []
    for player in players:
        player_tokens = normalize(str(player["name"])).split()
        if len(source_tokens) == 1 and source_tokens[0] in player_tokens:
            fuzzy.append(player)
        elif len(source_tokens) >= 2:
            last_matches = source_tokens[-1] == player_tokens[-1]
            first_matches = source_tokens[0] in player_tokens or (
                len(source_tokens[0]) == 1 and any(token.startswith(source_tokens[0]) for token in player_tokens[:-1])
            )
            if last_matches and first_matches:
                fuzzy.append(player)
    return fuzzy[0] if len(fuzzy) == 1 else None


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, default=CONFIG_PATH)
    parser.add_argument("--output", type=Path, default=OUTPUT_PATH)
    args = parser.parse_args()
    config = json.loads(args.config.read_text(encoding="utf-8"))
    season = json.loads((DATA_DIR / "seasons" / "se-k00012026.json").read_text(encoding="utf-8"))
    players_by_team: dict[str, list[Mapping[str, Any]]] = {}
    for player in season["players"]:
        players_by_team.setdefault(str(player["teamId"]), []).append(player)
    signals: dict[str, dict[str, Any]] = {}
    teams: dict[str, dict[str, Any]] = {}
    failures: list[str] = []
    for team_id, source in config["leagues"]["0001"]["teams"].items():
        try:
            request = Request(source["ligaInsiderUrl"], headers={"User-Agent": USER_AGENT})
            with urlopen(request, timeout=30) as response:
                page = response.read().decode("utf-8", errors="replace")
            updated_at, lineup = parse_topelf(page)
            headlines = parse_headlines(page)
            matched = 0
            matched_starters = 0
            unmatched_starters: list[str] = []
            source_starters = [row for row in lineup if row["role"] == "starter"]
            for row in lineup:
                if normalize(row["name"]) == "neuzugang":
                    continue
                player = match_player(row["name"], players_by_team.get(team_id, []))
                if player is None:
                    if row["role"] == "starter":
                        unmatched_starters.append(row["name"])
                    continue
                matched += 1
                matched_starters += int(row["role"] == "starter")
                signals[str(player["id"])] = {
                    "role": row["role"],
                    "source": "LigaInsider",
                    "sourceUrl": row["url"],
                    "sourceUpdatedAt": updated_at,
                }
            for url, name in re.findall(r'<a href="(/[^"/]+_\d+/)"[^>]*>(.*?)</a>', page, flags=re.DOTALL):
                player = match_player(html.unescape(re.sub(r"<[^>]+>", "", name)).strip(), players_by_team.get(team_id, []))
                if player is None:
                    continue
                signals.setdefault(str(player["id"]), {
                    "role": "squad",
                    "source": "LigaInsider",
                    "sourceUrl": f"https://www.ligainsider.de{url}",
                    "sourceUpdatedAt": updated_at,
                })
            teams[team_id] = {
                "ligaInsiderUrl": source["ligaInsiderUrl"],
                "transfermarktUrl": f"https://www.transfermarkt.de/-/startseite/verein/{source['transfermarktClubId']}",
                "sourceUpdatedAt": updated_at,
                "matchedPlayers": matched,
                "matchedStarters": matched_starters,
                "unmatchedStarters": unmatched_starters,
                "headlines": headlines,
            }
            if len(source_starters) != 11:
                failures.append(f"{team_id}: Quellseite enthält {len(source_starters)} statt 11 Topelf-Slots")
        except Exception as error:  # keep the previous production snapshot on any incomplete run
            failures.append(f"{team_id}: {error}")
    if failures:
        raise RuntimeError("Aktuelle Rollensignale sind unvollständig:\n" + "\n".join(failures))
    artifact = {
        "schemaVersion": 1,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "league": "0001",
        "season": 2026,
        "provider": "LigaInsider Topelf",
        "method": "preferred player in each published Topelf slot; alternatives are retained as alternatives",
        "players": signals,
        "teams": teams,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(artifact, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"{len(signals)} Bundesliga-Spieler mit aktuellen Rollensignalen geschrieben")


if __name__ == "__main__":
    main()
