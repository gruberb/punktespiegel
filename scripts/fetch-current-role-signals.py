#!/usr/bin/env python3
"""Fetch static season-role and current medical availability signals."""

from __future__ import annotations

import argparse
import html
import json
import re
import unicodedata
from datetime import datetime, timezone
from difflib import SequenceMatcher
from html.parser import HTMLParser
from pathlib import Path
from typing import Any, Mapping, Sequence
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "frontend" / "public" / "data"
CONFIG_PATH = ROOT / "config" / "external-sources.json"
OUTPUT_PATH = DATA_DIR / "current-role-signals.json"
AVAILABILITY_OUTPUT_PATH = DATA_DIR / "current-availability-signals.json"
USER_AGENT = "Mozilla/5.0 (compatible; punktespiegel/1.5; +https://github.com/gruberb/punktespiegel)"


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


class LigaInsiderAvailabilityParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.depth = 0
        self.team_table_depth: int | None = None
        self.team_heading = False
        self.team_text: list[str] = []
        self.team: str | None = None
        self.row_depth: int | None = None
        self.row: dict[str, Any] | None = None
        self.field_depth: int | None = None
        self.field: str | None = None
        self.field_text: list[str] = []
        self.link_href: str | None = None
        self.link_text: list[str] = []
        self.rows: list[dict[str, Any]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attributes = dict(attrs)
        if tag == "div":
            self.depth += 1
            classes = set((attributes.get("class") or "").split())
            if "personal_table" in classes:
                self.team_table_depth = self.depth
                self.team = None
            if "small_table_row" in classes and self.team is not None:
                self.row_depth = self.depth
                self.row = {"team": self.team}
            if self.row is not None:
                if "small_table_column2" in classes:
                    self.field_depth, self.field, self.field_text = self.depth, "reason", []
                elif "small_table_column4" in classes:
                    self.field_depth, self.field, self.field_text = self.depth, "absentSince", []
        elif tag == "h2" and self.team_table_depth is not None:
            self.team_heading = True
            self.team_text = []
        elif tag == "img" and self.row is not None and attributes.get("alt"):
            self.row.setdefault("sourceStatus", html.unescape(attributes["alt"] or "").strip())
        elif tag == "a" and self.row is not None and attributes.get("href"):
            self.link_href = attributes["href"]
            self.link_text = []

    def handle_data(self, data: str) -> None:
        if self.team_heading:
            self.team_text.append(data)
        if self.field is not None:
            self.field_text.append(data)
        if self.link_href is not None:
            self.link_text.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag == "a" and self.row is not None and self.link_href is not None:
            label = html.unescape("".join(self.link_text)).replace("\u00ad", "").strip()
            absolute = self.link_href if self.link_href.startswith("http") else f"https://www.ligainsider.de{self.link_href}"
            if re.fullmatch(r"/[^/]+_\d+/", self.link_href):
                self.row["name"] = label
                self.row["profileUrl"] = absolute
            elif label:
                self.row["latestNewsTitle"] = label
                self.row["latestNewsUrl"] = absolute
            self.link_href = None
            self.link_text = []
        elif tag == "h2" and self.team_heading:
            self.team = html.unescape("".join(self.team_text)).strip()
            self.team_heading = False
            self.team_text = []
        elif tag == "div":
            if self.field_depth == self.depth and self.row is not None and self.field is not None:
                self.row[self.field] = " ".join("".join(self.field_text).split())
                self.field_depth, self.field, self.field_text = None, None, []
            if self.row_depth == self.depth and self.row is not None:
                if self.row.get("name") and self.row.get("sourceStatus"):
                    self.rows.append(self.row)
                self.row_depth, self.row = None, None
            if self.team_table_depth == self.depth:
                self.team_table_depth = None
                self.team = None
            self.depth -= 1


class TransfermarktAvailabilityParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.in_table = False
        self.row_depth = 0
        self.row: dict[str, Any] | None = None
        self.cell = -1
        self.cell_text: list[str] = []
        self.player_cell_text: list[str] = []
        self.rows: list[dict[str, Any]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attributes = dict(attrs)
        if tag == "table" and "items" in set((attributes.get("class") or "").split()):
            self.in_table = True
        elif tag == "tr" and self.in_table:
            if self.row is None and set((attributes.get("class") or "").split()).intersection({"odd", "even"}):
                self.row = {}
                self.row_depth = 1
                self.cell = -1
                self.player_cell_text = []
            elif self.row is not None:
                self.row_depth += 1
        elif tag == "td" and self.row is not None and self.row_depth == 1:
            self.cell += 1
            self.cell_text = []
        elif tag == "a" and self.row is not None:
            href = attributes.get("href") or ""
            title = html.unescape(attributes.get("title") or "").strip()
            if self.cell == 0 and "/profil/spieler/" in href:
                self.row["name"] = title
                self.row["profileUrl"] = f"https://www.transfermarkt.de{href}"
            elif self.cell == 1 and title:
                self.row["team"] = title

    def handle_data(self, data: str) -> None:
        if self.row is not None and self.row_depth == 1 and self.cell >= 0:
            self.cell_text.append(data)
        elif self.row is not None and self.row_depth > 1 and self.cell == 0:
            self.player_cell_text.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag == "td" and self.row is not None and self.row_depth == 1:
            value = " ".join("".join(self.cell_text).split())
            if self.cell == 2:
                self.row["reason"] = value
            elif self.cell == 3:
                self.row["expectedReturn"] = value
            self.cell_text = []
        elif tag == "tr" and self.row is not None:
            self.row_depth -= 1
            if self.row_depth == 0:
                player_cell = " ".join("".join(self.player_cell_text).split())
                position_map = {
                    "Torwart": "GK",
                    "Innenverteidiger": "DEF",
                    "Rechter Verteidiger": "DEF",
                    "Linker Verteidiger": "DEF",
                    "Defensives Mittelfeld": "MID",
                    "Zentrales Mittelfeld": "MID",
                    "Offensives Mittelfeld": "MID",
                    "Rechtes Mittelfeld": "MID",
                    "Linkes Mittelfeld": "MID",
                    "Rechtsaußen": "FWD",
                    "Linksaußen": "FWD",
                    "Mittelstürmer": "FWD",
                    "Hängende Spitze": "FWD",
                }
                for label, position in position_map.items():
                    if label in player_cell:
                        self.row["position"] = position
                        break
                if self.row.get("name") and self.row.get("reason"):
                    self.rows.append(self.row)
                self.row = None
                self.cell = -1
                self.player_cell_text = []
        elif tag == "table" and self.in_table and self.row is None:
            self.in_table = False


def fetch_page(url: str) -> str:
    request = Request(url, headers={"User-Agent": USER_AGENT})
    with urlopen(request, timeout=30) as response:
        return response.read().decode("utf-8", errors="replace")


def parse_ligainsider_availability(page: str) -> list[dict[str, Any]]:
    parser = LigaInsiderAvailabilityParser()
    parser.feed(page)
    if len(parser.rows) < 10:
        raise RuntimeError("LigaInsider-Verfügbarkeitsseite enthält zu wenige Statuszeilen.")
    status_map = {
        "Verletzung": "injured",
        "Aufbautraining": "rehab",
        "Gelb-Rote Karte": "suspended",
        "Rote Karte": "suspended",
        "Nicht im Kader": "not_considered",
    }
    return [{**row, "status": status_map.get(str(row["sourceStatus"]), "unavailable")} for row in parser.rows]


def parse_transfermarkt_availability(page: str) -> list[dict[str, Any]]:
    parser = TransfermarktAvailabilityParser()
    parser.feed(page)
    if len(parser.rows) < 10:
        raise RuntimeError("Transfermarkt-Verfügbarkeitsseite enthält zu wenige Statuszeilen.")
    result = []
    for row in parser.rows:
        status = "rehab" if normalize(str(row.get("reason", ""))) in {"trainingsruckstand", "fitness"} else "injured"
        expected_return = str(row.get("expectedReturn", "")).strip()
        parsed_return = None
        if expected_return:
            try:
                parsed_return = datetime.strptime(expected_return, "%d.%m.%Y").date().isoformat()
            except ValueError:
                parsed_return = None
        result.append({**row, "status": status, "expectedReturn": parsed_return})
    return result


def match_medical_player(
    row: Mapping[str, Any],
    season: Mapping[str, Any],
    profile_player_ids: Mapping[str, str] | None = None,
) -> Mapping[str, Any] | None:
    profile_url = str(row.get("profileUrl", ""))
    profile_player_id = (profile_player_ids or {}).get(profile_url)
    if profile_player_id:
        return next((player for player in season["players"] if str(player["id"]) == profile_player_id), None)
    source_team = normalize(str(row.get("team", "")))
    team_ids = {
        str(team["id"])
        for team in season["teams"]
        if source_team and (
            normalize(str(team["name"])) == source_team
            or normalize(str(team.get("code", ""))) == source_team
        )
    }
    scoped_players = [
        player for player in season["players"]
        if not team_ids or str(player["teamId"]) in team_ids
    ]
    candidates = [player for player in scoped_players if normalize(str(player["name"])) == normalize(str(row["name"]))]
    if not candidates:
        fuzzy = match_player(str(row["name"]), scoped_players)
        candidates = [fuzzy] if fuzzy is not None else []
    source_last_name = normalize(str(row["name"])).split()[-1]
    if not candidates:
        candidates = [
            player for player in scoped_players
            if normalize(str(player["name"])).split()[-1] == source_last_name
        ]
    if not candidates:
        source_tokens = normalize(str(row["name"])).split()
        candidates = [
            player for player in scoped_players
            if set(normalize(str(player["name"])).split()).issubset(source_tokens)
        ]
    if not candidates:
        ranked = sorted(
            [(
                SequenceMatcher(
                    None,
                    normalize(str(row["name"])),
                    normalize(str(player["name"])),
                ).ratio(),
                player,
            ) for player in scoped_players],
            key=lambda item: item[0],
        )
        if ranked and ranked[-1][0] >= 0.82 and (len(ranked) == 1 or ranked[-1][0] - ranked[-2][0] >= 0.08):
            candidates = [ranked[-1][1]]
    source_position = row.get("position")
    if len(candidates) > 1 and source_position:
        position_candidates = [player for player in candidates if player["position"] == source_position]
        if len(position_candidates) == 1:
            return position_candidates[0]
    if len(candidates) == 1:
        return candidates[0]
    if team_ids:
        team_candidates = [player for player in candidates if str(player["teamId"]) in team_ids]
        if len(team_candidates) == 1:
            return team_candidates[0]
    return None


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
    parser.add_argument("--availability-output", type=Path, default=AVAILABILITY_OUTPUT_PATH)
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
            page = fetch_page(source["ligaInsiderUrl"])
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
        "method": "preferred season-hierarchy player in each Topelf slot; medical availability is applied separately",
        "players": signals,
        "teams": teams,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(artifact, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    medical_leagues: dict[str, dict[str, Any]] = {}
    for league, source in config["medicalSources"].items():
        medical_season = json.loads((DATA_DIR / "seasons" / f"se-k{league}2026.json").read_text(encoding="utf-8"))
        medical_page = fetch_page(source["url"])
        rows = (
            parse_ligainsider_availability(medical_page)
            if source["format"] == "ligainsider"
            else parse_transfermarkt_availability(medical_page)
        )
        medical_players: dict[str, dict[str, Any]] = {}
        unmatched: list[str] = []
        profile_player_ids = {
            str(signal["sourceUrl"]): player_id
            for player_id, signal in signals.items()
            if league == "0001" and signal.get("sourceUrl")
        }
        for row in rows:
            player = match_medical_player(row, medical_season, profile_player_ids)
            if player is None:
                unmatched.append(str(row["name"]))
                continue
            source_url = row.get("latestNewsUrl") or row.get("profileUrl") or source["url"]
            medical_players[str(player["id"])] = {
                "status": row["status"],
                "reason": row.get("reason") or row.get("sourceStatus"),
                "absentSince": row.get("absentSince"),
                "expectedReturn": row.get("expectedReturn"),
                "latestNewsTitle": row.get("latestNewsTitle"),
                "source": source["provider"],
                "sourceUrl": source_url,
                "profileUrl": row.get("profileUrl"),
            }
        if not medical_players:
            raise RuntimeError(f"{source['provider']} lieferte für Liga {league} keine zuordenbaren Ausfälle.")
        medical_leagues[league] = {
            "provider": source["provider"],
            "sourceUrl": source["url"],
            "sourceRows": len(rows),
            "matchedPlayers": len(medical_players),
            "unmatchedPlayers": unmatched,
            "players": medical_players,
        }
    availability_artifact = {
        "schemaVersion": 1,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "season": 2026,
        "policy": "current medical status overrides season hierarchy; missing return dates are never interpreted as healthy",
        "leagues": medical_leagues,
    }
    args.availability_output.parent.mkdir(parents=True, exist_ok=True)
    args.availability_output.write_text(
        json.dumps(availability_artifact, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(
        f"{len(signals)} Bundesliga-Rollensignale und "
        f"{sum(len(item['players']) for item in medical_leagues.values())} aktuelle Ausfälle geschrieben"
    )


if __name__ == "__main__":
    main()
