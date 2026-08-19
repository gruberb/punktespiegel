#!/usr/bin/env python3
"""Fetch static Transfermarkt club and player profile snapshots.

Per league and season this writes two artifacts:

- club-profiles/{league}.json: squad bio data (birth date, height, nationality,
  joined/contract dates, market value), coach, captain and the season's
  transfer ledger per club.
- player-careers/{league}.json: appearances, goals and assists grouped by club
  for every squad player that could be matched to a kicker player id.

Club ids come from config/external-sources.json where present (Bundesliga) and
are otherwise resolved from the Transfermarkt league page and matched by club
name. Player ids are matched by normalized name within each club; ambiguous or
missing cases can be pinned in config/transfermarkt-overrides.json.
"""

from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import hashlib
import html
import json
import re
import sys
import threading
import time
import unicodedata
from datetime import date, datetime, timezone
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "frontend" / "public" / "data"
CONFIG_PATH = ROOT / "config" / "external-sources.json"
OVERRIDES_PATH = ROOT / "config" / "transfermarkt-overrides.json"
CLUB_OUTPUT_DIR = DATA_DIR / "club-profiles"
CAREER_OUTPUT_DIR = DATA_DIR / "player-careers"
CACHE_DIR = ROOT / ".cache" / "transfermarkt"
BASE_URL = "https://www.transfermarkt.de"
API_URL = "https://tmapi.transfermarkt.technology"
USER_AGENT = "Mozilla/5.0 (compatible; punktespiegel/1.5; +https://github.com/gruberb/punktespiegel)"
LEAGUE_COMPETITIONS = {"0001": ("bundesliga", "L1"), "0002": ("2-bundesliga", "L2"), "0003": ("3-liga", "L3")}


def normalize(value: str) -> str:
    value = html.unescape(re.sub(r"<[^>]+>", " ", value))
    value = "".join(character for character in unicodedata.normalize("NFKD", value) if not unicodedata.combining(character))
    value = value.translate(str.maketrans({"ø": "o", "đ": "d", "ð": "d", "ł": "l", "æ": "ae", "ß": "ss"}))
    return re.sub(r"[^a-z0-9]+", " ", value.lower()).strip()


def clean_text(value: str) -> str:
    return " ".join(html.unescape(re.sub(r"<[^>]+>", " ", value)).replace("­", "").split())


class Fetcher:
    """Polite HTTP client with an on-disk cache for repeated local runs."""

    def __init__(self, cache_dir: Path, delay_seconds: float, use_cache: bool) -> None:
        self.cache_dir = cache_dir
        self.delay_seconds = delay_seconds
        self.use_cache = use_cache
        self.last_request_at = 0.0
        self.request_count = 0
        self.request_lock = threading.Lock()

    def fetch(self, url: str) -> str:
        cache_path = self.cache_path(url)
        if self.use_cache and cache_path.exists():
            return cache_path.read_text()
        request = Request(url, headers={
            "User-Agent": USER_AGENT,
            "Accept": "application/json, text/html;q=0.9, */*;q=0.8",
            "Accept-Language": "de-DE,de;q=0.9,en;q=0.7",
        })
        # Transfermarkt occasionally times out or resets a connection mid-run;
        # retry with growing pauses before giving up on the whole run.
        page: str | None = None
        for attempt in range(4):
            try:
                # Serialize request starts, not downloads. Slow responses can
                # overlap without exceeding the configured request frequency.
                with self.request_lock:
                    wait = self.delay_seconds - (time.monotonic() - self.last_request_at)
                    if wait > 0:
                        time.sleep(wait)
                    self.last_request_at = time.monotonic()
                with urlopen(request, timeout=30) as response:
                    page = response.read().decode("utf-8", errors="replace")
                break
            except (HTTPError, URLError, OSError):
                if attempt == 3:
                    raise
                time.sleep(max(5.0, self.delay_seconds * 4) * (attempt + 1))
        assert page is not None
        with self.request_lock:
            self.request_count += 1
        if self.use_cache:
            self.cache_dir.mkdir(parents=True, exist_ok=True)
            cache_path.write_text(page)
        return page

    def cache_path(self, url: str) -> Path:
        return self.cache_dir / f"{hashlib.sha256(url.encode()).hexdigest()}.html"

    def is_cached(self, url: str) -> bool:
        return self.use_cache and self.cache_path(url).exists()


def parse_money(value: str) -> dict[str, Any] | None:
    raw = clean_text(value)
    if not raw or raw in {"-", "?"}:
        return None
    lowered = raw.lower()
    if "ablösefrei" in lowered or "ablosefrei" in lowered:
        return {"raw": raw, "eur": 0, "kind": "free"}
    if "leih-ende" in lowered or "leihende" in lowered:
        return {"raw": raw, "eur": None, "kind": "loanEnd"}
    if "leihgebühr" in lowered or "leihgebuhr" in lowered:
        amount = parse_amount(raw)
        return {"raw": raw, "eur": amount, "kind": "loan"}
    if "leihe" in lowered:
        return {"raw": raw, "eur": None, "kind": "loan"}
    amount = parse_amount(raw)
    if amount is None:
        return {"raw": raw, "eur": None, "kind": "unknown"}
    return {"raw": raw, "eur": amount, "kind": "fee"}


def parse_amount(value: str) -> int | None:
    match = re.search(r"(\d+(?:,\d+)?)\s*(Mio\.|Tsd\.)?\s*€", value)
    if not match:
        return None
    number = float(match.group(1).replace(",", "."))
    unit = match.group(2)
    if unit == "Mio.":
        number *= 1_000_000
    elif unit == "Tsd.":
        number *= 1_000
    return int(round(number))


def parse_german_date(value: str) -> str | None:
    match = re.search(r"(\d{2})\.(\d{2})\.(\d{4})", value)
    if not match:
        return None
    day, month, year = match.groups()
    return f"{year}-{month}-{day}"


def age_at_season_end(birth_date: str | None, season_year: int) -> int | None:
    if not birth_date:
        return None
    born = date.fromisoformat(birth_date)
    reference = date(season_year + 1, 6, 30)
    return reference.year - born.year - ((reference.month, reference.day) < (born.month, born.day))


def split_top_level_cells(row: str) -> list[str]:
    """Split a <tr> body into top-level <td> contents, ignoring nested tables."""
    cells: list[str] = []
    depth = 0
    current_start: int | None = None
    for match in re.finditer(r"<(/?)(td|table)[^>]*>", row):
        closing, tag = match.groups()
        if tag == "table":
            depth += -1 if closing else 1
            continue
        if depth > 0:
            continue
        if not closing and current_start is None:
            current_start = match.end()
        elif closing and current_start is not None:
            cells.append(row[current_start:match.start()])
            current_start = None
    return cells


def iterate_rows(section: str) -> list[str]:
    starts = [match.start() for match in re.finditer(r'<tr class="(?:odd|even)"', section)]
    if not starts:
        return []
    end = section.find("</tbody>", starts[0])
    if end == -1:
        end = len(section)
    starts = [start for start in starts if start < end]
    boundaries = starts + [end]
    return [section[boundaries[index]:boundaries[index + 1]] for index in range(len(starts))]


def nationality_titles(cell: str) -> list[str]:
    titles: list[str] = []
    for title in re.findall(r'class="flaggenrahmen"[^>]*title="([^"]+)"|title="([^"]+)"[^>]*class="flaggenrahmen"', cell):
        name = html.unescape(title[0] or title[1]).strip()
        if name and name not in titles:
            titles.append(name)
    return titles


def parse_squad_page(page: str) -> list[dict[str, Any]]:
    """Parse the /kader/verein/{id}/saison_id/{year}/plus/1 squad table."""
    if 'class="items"' not in page:
        raise RuntimeError("Transfermarkt-Kaderseite enthält keine Kadertabelle.")
    section = page.split('class="items"', 1)[1]
    players: list[dict[str, Any]] = []
    for row in iterate_rows(section):
        profile = re.search(r'href="(/[^"/]+/profil/spieler/(\d+))"[^>]*>\s*([^<]+)', row)
        if not profile:
            continue
        cells = split_top_level_cells(row)
        if len(cells) < 10:
            continue
        name = clean_text(profile.group(3))
        birth_cell = clean_text(cells[2])
        age_match = re.search(r"\((\d+)\)", birth_cell)
        height_match = re.search(r"(\d),(\d{2})\s*m", clean_text(cells[4]))
        foot = clean_text(cells[5]) or None
        previous_cell = cells[7]
        previous_club = re.search(r'title="([^":]+)(?::[^"]*)?"', previous_cell)
        signing_fee = re.search(r'title="[^":]+:\s*Ablöse\s*([^"]+)"', previous_cell)
        shirt_number = re.search(r"rn_nummer>([^<]*)<", row)
        position_detail = re.search(r"<tr>\s*<td>\s*([^<]+?)\s*</td>\s*</tr>\s*</table>", row, flags=re.DOTALL)
        shirt_number_value = clean_text(shirt_number.group(1)) if shirt_number else ""
        players.append({
            "tmId": int(profile.group(2)),
            "tmUrl": f"{BASE_URL}{profile.group(1)}",
            "tmName": name,
            "captain": "kapitaenicon" in row,
            "shirtNumber": shirt_number_value if shirt_number_value not in {"", "-"} else None,
            "positionDetail": clean_text(position_detail.group(1)) if position_detail else None,
            "birthDate": parse_german_date(birth_cell),
            "age": int(age_match.group(1)) if age_match else None,
            "nationalities": nationality_titles(cells[3]),
            "heightCm": int(height_match.group(1)) * 100 + int(height_match.group(2)) if height_match else None,
            "foot": foot if foot in {"rechts", "links", "beidfüßig"} else None,
            "joinedAt": parse_german_date(clean_text(cells[6])),
            "previousClub": clean_text(previous_club.group(1)) if previous_club else None,
            "signingFee": parse_money(signing_fee.group(1)) if signing_fee else None,
            "contractUntil": parse_german_date(clean_text(cells[8])),
            "marketValue": parse_money(cells[9]),
        })
    if len(players) < 15:
        raise RuntimeError("Transfermarkt-Kaderseite enthält zu wenige Spielerzeilen.")
    return players


def parse_transfer_section(section: str) -> list[dict[str, Any]]:
    transfers: list[dict[str, Any]] = []
    for row in iterate_rows(section):
        profile = re.search(r'href="/[^"/]+/profil/spieler/(\d+)"[^>]*>([^<]+)', row)
        if not profile:
            continue
        cells = split_top_level_cells(row)
        if len(cells) < 6:
            continue
        position = re.search(r'<td class="bg_(\w+)"', row)
        club_link = re.search(r'href="(/[^"/]+/(?:startseite|transfers)/verein/\d+[^"]*)"[^>]*>([^<]*)', cells[4])
        club_title = re.search(r'title="([^"]+)"', cells[4])
        club_name = (clean_text(club_link.group(2)) if club_link else "") or (clean_text(club_title.group(1)) if club_title else "")
        age = clean_text(cells[2])
        transfers.append({
            "tmId": int(profile.group(1)),
            "name": clean_text(profile.group(2)),
            "position": position.group(1) if position else None,
            "age": int(age) if age.isdigit() else None,
            "nationalities": nationality_titles(cells[3]),
            "club": club_name or None,
            "fee": parse_money(cells[5]),
        })
    return transfers


def parse_transfers_page(page: str) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    def section_after(title: str) -> str:
        match = re.search(rf"<h2[^>]*>\s*{title}", page)
        if not match:
            return ""
        rest = page[match.end():]
        next_heading = re.search(r"<h2[^>]*>", rest)
        return rest[:next_heading.start()] if next_heading else rest

    return parse_transfer_section(section_after("Zugänge")), parse_transfer_section(section_after("Abgänge"))


def parse_coach(page: str) -> dict[str, Any] | None:
    """Extract the head coach from the /mitarbeiter staff page.

    Staff rows carry no odd/even classes; the head coach is the inline table
    whose role row reads exactly "Trainer", followed by age, nationality,
    appointment date and contract cells in the same outer row.
    """
    match = re.search(
        r'<table class="inline-table">(?:(?!</table>).)*?href="(/[^"/]+/profil/trainer/\d+)"[^>]*>([^<]+)</a>'
        r'(?:(?!</table>).)*?<tr>\s*<td>\s*Trainer\s*</td>\s*</tr>\s*</table>'
        r'((?:(?!<table class="inline-table">).)*?)</tr>',
        page,
        flags=re.DOTALL,
    )
    if not match:
        return None
    tail = match.group(3)
    cell_values = [clean_text(cell) for cell in re.findall(r"<td[^>]*>(.*?)</td>", tail, flags=re.DOTALL)]
    dates = [value for value in (parse_german_date(cell) for cell in cell_values) if value]
    age_values = [cell for cell in cell_values if cell.isdigit()]
    return {
        "name": clean_text(match.group(2)),
        "tmUrl": f"{BASE_URL}{match.group(1)}",
        "age": int(age_values[0]) if age_values else None,
        "nationalities": nationality_titles(tail),
        "appointedAt": dates[0] if dates else None,
        "contractUntil": dates[1] if len(dates) > 1 else None,
    }


def parse_league_clubs(page: str) -> dict[str, dict[str, Any]]:
    clubs: dict[str, dict[str, Any]] = {}
    for match in re.finditer(r'href="/([^"/]+)/startseite/verein/(\d+)/saison_id/\d+"[^>]*>([^<]*)', page):
        slug, club_id, label = match.groups()
        label = clean_text(label)
        if label and club_id not in clubs:
            clubs[club_id] = {"slug": slug, "id": int(club_id), "name": label}
    return clubs


def parse_player_performance(payload: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
    """Aggregate Transfermarkt's game-level career data by club and season.

    The profile component excludes national-team competition types and counts
    only rows in which the player actually appeared. Mirroring those rules
    keeps the totals consistent with the public "Leistungsdaten pro Verein"
    table while avoiding another request for every club-season combination.
    """
    data = payload.get("data") or {}
    totals: dict[str, dict[str, Any]] = {}
    seasons: dict[tuple[str, int, str], dict[str, Any]] = {}
    national_team_types = {11, 17, 19, 20}
    for item in data.get("performance", []):
        game = item.get("gameInformation") or {}
        if game.get("isNationalGame") or game.get("competitionTypeId") in national_team_types:
            continue
        clubs = item.get("clubsInformation") or {}
        club = clubs.get("club") or {}
        statistics = item.get("statistics") or {}
        general = statistics.get("generalStatistics") or {}
        if general.get("participationState") != "played":
            continue
        club_id = str(club.get("clubId") or "")
        if not club_id or club_id == "0":
            continue
        goals = statistics.get("goalStatistics") or {}
        aggregate = totals.setdefault(club_id, {
            "clubId": int(club_id),
            "appearances": 0,
            "goals": 0,
            "assists": 0,
        })
        aggregate["appearances"] += 1
        aggregate["goals"] += int(goals.get("goalsScoredTotal") or 0)
        aggregate["assists"] += int(goals.get("assists") or 0)

        season_year = game.get("seasonId")
        competition_id = str(game.get("competitionId") or "")
        if season_year is None or not competition_id:
            continue
        season_key = (club_id, int(season_year), competition_id)
        season = seasons.setdefault(season_key, {
            "clubId": int(club_id),
            "seasonStartYear": int(season_year),
            "competitionId": competition_id,
            "appearances": 0,
            "goals": 0,
            "assists": 0,
        })
        season["appearances"] += 1
        season["goals"] += int(goals.get("goalsScoredTotal") or 0)
        season["assists"] += int(goals.get("assists") or 0)
    return {
        "clubs": sorted(totals.values(), key=lambda entry: (-entry["appearances"], entry["clubId"])),
        "seasons": sorted(
            seasons.values(),
            key=lambda entry: (-entry["seasonStartYear"], entry["clubId"], entry["competitionId"]),
        ),
    }


def resolve_career_clubs(fetcher: Fetcher, club_ids: set[int]) -> dict[int, dict[str, Any]]:
    """Resolve Transfermarkt club ids in batches through the site's entity API."""
    resolved: dict[int, dict[str, Any]] = {}
    ordered = sorted(club_ids)
    for offset in range(0, len(ordered), 200):
        batch = ordered[offset:offset + 200]
        query = urlencode({"ids[]": [str(club_id) for club_id in batch]}, doseq=True)
        payload = json.loads(fetcher.fetch(f"{API_URL}/clubs?{query}"))
        for club in payload.get("data", []):
            club_id = int(club["id"])
            relative_url = club.get("relativeUrl")
            resolved[club_id] = {
                "name": club.get("name") or f"Verein {club_id}",
                "tmUrl": f"{BASE_URL}{relative_url}" if relative_url else None,
            }
    return resolved


def resolve_career_competitions(fetcher: Fetcher, competition_ids: set[str]) -> dict[str, dict[str, Any]]:
    """Resolve Transfermarkt competition ids in batches through the entity API."""
    resolved: dict[str, dict[str, Any]] = {}
    ordered = sorted(competition_ids)
    for offset in range(0, len(ordered), 200):
        batch = ordered[offset:offset + 200]
        query = urlencode({"ids[]": batch}, doseq=True)
        payload = json.loads(fetcher.fetch(f"{API_URL}/competitions?{query}"))
        for competition in payload.get("data", []):
            competition_id = str(competition["id"])
            relative_url = competition.get("relativeUrl")
            resolved[competition_id] = {
                "name": competition.get("shortName") or competition.get("name") or competition_id,
                "tmUrl": f"{BASE_URL}{relative_url}" if relative_url else None,
            }
    return resolved


def fetch_player_performance(fetcher: Fetcher, player_id: int) -> dict[str, Any]:
    """Use cached legacy responses, otherwise the current direct API endpoint."""
    legacy_url = f"{BASE_URL}/ceapi/performance-game/{player_id}"
    url = legacy_url if fetcher.is_cached(legacy_url) else f"{API_URL}/player/{player_id}/performance-game"
    return json.loads(fetcher.fetch(url))


def match_by_name(wanted: str, candidates: dict[str, str]) -> str | None:
    """Match a normalized name against candidate ids; exact, then fuzzy-unique."""
    for candidate_id, candidate in candidates.items():
        if candidate == wanted:
            return candidate_id
    scored = sorted(
        ((SequenceMatcher(None, wanted, candidate).ratio(), candidate_id) for candidate_id, candidate in candidates.items()),
        reverse=True,
    )
    if scored and scored[0][0] >= 0.82 and (len(scored) == 1 or scored[0][0] - scored[1][0] >= 0.08):
        return scored[0][1]
    # Last names disambiguate kicker's short forms ("Grimaldo" vs "Alejandro Grimaldo").
    wanted_tokens = set(wanted.split())
    token_hits = [candidate_id for candidate_id, candidate in candidates.items() if wanted_tokens and wanted_tokens.issubset(set(candidate.split()))]
    if len(token_hits) == 1:
        return token_hits[0]
    reverse_hits = [candidate_id for candidate_id, candidate in candidates.items() if set(candidate.split()).issubset(wanted_tokens)]
    if len(reverse_hits) == 1:
        return reverse_hits[0]
    return None


def load_json(path: Path) -> Any:
    return json.loads(path.read_text())


def newest_season(catalog: dict[str, Any], league: str) -> dict[str, Any]:
    seasons = [season for season in catalog["seasons"] if season["leagueCode"] == league]
    return max(seasons, key=lambda season: season["startYear"])


def resolve_club_ids(
    fetcher: Fetcher,
    league: str,
    season_year: int,
    kicker_teams: list[dict[str, Any]],
    config: dict[str, Any],
    overrides: dict[str, Any],
) -> tuple[dict[str, dict[str, Any]], list[str]]:
    """Map kicker team ids to Transfermarkt club ids for one league."""
    configured = {
        team_id: {"id": source["transfermarktClubId"], "slug": None, "name": None}
        for team_id, source in config.get("leagues", {}).get(league, {}).get("teams", {}).items()
        if source.get("transfermarktClubId")
    }
    override_clubs = {str(key): value for key, value in overrides.get("clubs", {}).get(league, {}).items()}
    slug, competition = LEAGUE_COMPETITIONS[league]
    league_page = fetcher.fetch(f"{BASE_URL}/{slug}/startseite/wettbewerb/{competition}/saison_id/{season_year}")
    tm_clubs = parse_league_clubs(league_page)
    tm_by_name = {club_id: normalize(club["name"]) for club_id, club in tm_clubs.items()}

    resolved: dict[str, dict[str, Any]] = {}
    unmatched: list[str] = []
    for team in kicker_teams:
        team_id = team["id"]
        if team_id in override_clubs:
            club_id = str(override_clubs[team_id])
            resolved[team_id] = tm_clubs.get(club_id, {"id": int(club_id), "slug": "verein", "name": team["name"]})
            continue
        if team_id in configured:
            club_id = str(configured[team_id]["id"])
            resolved[team_id] = tm_clubs.get(club_id, {"id": int(club_id), "slug": "verein", "name": team["name"]})
            continue
        match = match_by_name(normalize(team["name"]), tm_by_name)
        if match:
            resolved[team_id] = tm_clubs[match]
        else:
            unmatched.append(f"{team_id} ({team['name']})")
    return resolved, unmatched


def build_league_snapshot(
    fetcher: Fetcher,
    league: str,
    season_year: int,
    config: dict[str, Any],
    overrides: dict[str, Any],
    include_careers: bool,
    career_workers: int,
) -> tuple[dict[str, Any], dict[str, Any]]:
    season_file = load_json(DATA_DIR / "seasons" / f"se-k{league}{season_year}.json")
    catalog = load_json(DATA_DIR / "catalog.json")
    is_current_season = season_year == newest_season(catalog, league)["startYear"]
    stable_bios: dict[int, dict[str, Any]] = {}
    current_profile_path = CLUB_OUTPUT_DIR / f"{league}.json"
    if not is_current_season and current_profile_path.exists():
        current_profiles = load_json(current_profile_path)
        for current_team in current_profiles.get("teams", {}).values():
            for current_member in current_team.get("squad", {}).values():
                stable_bios[int(current_member["tmId"])] = {
                    "clubId": int(current_team["transfermarktClubId"]),
                    "member": current_member,
                }
    teams = [team for team in season_file["teams"]]
    players_by_team: dict[str, dict[str, str]] = {}
    player_names: dict[str, str] = {}
    for player in season_file["players"]:
        if not player.get("active", True):
            continue
        player_names[player["id"]] = player["name"]
        players_by_team.setdefault(player["teamId"], {})[player["id"]] = normalize(player["name"])

    clubs, unmatched_clubs = resolve_club_ids(fetcher, league, season_year, teams, config, overrides)
    if unmatched_clubs:
        print(f"[{league}] Ohne Transfermarkt-Zuordnung: {', '.join(unmatched_clubs)}", file=sys.stderr)

    player_overrides = {str(key): value for key, value in overrides.get("players", {}).items()}
    generated_at = datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    club_teams: dict[str, Any] = {}
    careers: dict[str, Any] = {}
    total_unmatched_players: list[str] = []
    total_unmatched_kicker: list[str] = []

    for team in teams:
        team_id = team["id"]
        club = clubs.get(team_id)
        if not club:
            continue
        slug = club.get("slug") or "verein"
        club_url = f"{BASE_URL}/{slug}/startseite/verein/{club['id']}"
        squad_page = fetcher.fetch(f"{BASE_URL}/{slug}/kader/verein/{club['id']}/saison_id/{season_year}/plus/1")
        transfers_page = fetcher.fetch(f"{BASE_URL}/{slug}/transfers/verein/{club['id']}/saison_id/{season_year}")
        # The public staff page is current-state only. Do not stamp today's
        # coach onto a historical season; captain data remains season-specific
        # because it comes from the archived squad page.
        staff_page = fetcher.fetch(f"{BASE_URL}/{slug}/mitarbeiter/verein/{club['id']}") if is_current_season else None

        squad = parse_squad_page(squad_page)
        for member in squad:
            stable_entry = stable_bios.get(member["tmId"])
            stable = stable_entry["member"] if stable_entry and stable_entry["clubId"] == int(club["id"]) else None
            if stable:
                for field in ("birthDate", "nationalities", "heightCm", "foot", "joinedAt", "previousClub"):
                    if not member.get(field):
                        member[field] = stable.get(field)
            historical_age = age_at_season_end(member.get("birthDate"), season_year)
            if historical_age is not None and not is_current_season:
                member["age"] = historical_age
        arrivals, departures = parse_transfers_page(transfers_page)
        coach = parse_coach(staff_page) if staff_page else None

        kicker_candidates = dict(players_by_team.get(team_id, {}))
        matched: dict[str, Any] = {}
        unmatched_squad: list[dict[str, Any]] = []
        tm_to_kicker: dict[int, str] = {}
        for member in squad:
            override_hit = next((kicker_id for kicker_id, tm_id in player_overrides.items() if int(tm_id) == member["tmId"] and kicker_id in kicker_candidates), None)
            kicker_id = override_hit or match_by_name(normalize(member["tmName"]), kicker_candidates)
            if kicker_id:
                matched[kicker_id] = member
                tm_to_kicker[member["tmId"]] = kicker_id
                kicker_candidates.pop(kicker_id, None)
            else:
                unmatched_squad.append({"tmName": member["tmName"], "tmId": member["tmId"]})
        total_unmatched_players.extend(f"{entry['tmName']} ({team['name']})" for entry in unmatched_squad)
        unmatched_kicker = [{"playerId": player_id, "name": player_names[player_id]} for player_id in kicker_candidates]
        total_unmatched_kicker.extend(f"{entry['name']} ({team['name']})" for entry in unmatched_kicker)

        captain_id = next((kicker_id for kicker_id, member in matched.items() if member["captain"]), None)
        for transfer in arrivals + departures:
            transfer["playerId"] = tm_to_kicker.get(transfer["tmId"])

        club_teams[team_id] = {
            "name": team["name"],
            "transfermarktClubId": club["id"],
            "transfermarktUrl": club_url,
            "coach": coach,
            "captainPlayerId": captain_id,
            "squad": matched,
            "unmatchedSquad": unmatched_squad,
            "unmatchedKicker": unmatched_kicker,
            "arrivals": arrivals,
            "departures": departures,
        }

        if include_careers:
            performances: dict[str, dict[str, list[dict[str, Any]]]] = {}
            failures: list[str] = []

            def load_performance(kicker_id: str, member: dict[str, Any]) -> tuple[str, dict[str, list[dict[str, Any]]]]:
                payload = fetch_player_performance(fetcher, member["tmId"])
                return kicker_id, parse_player_performance(payload)

            with ThreadPoolExecutor(max_workers=career_workers) as executor:
                pending = {
                    executor.submit(load_performance, kicker_id, member): (kicker_id, member)
                    for kicker_id, member in matched.items()
                }
                for future in as_completed(pending):
                    kicker_id, member = pending[future]
                    try:
                        resolved_id, performance = future.result()
                        performances[resolved_id] = performance
                    except (HTTPError, URLError, OSError, ValueError, RuntimeError) as error:
                        failures.append(f"{member['tmName']} ({member['tmId']}): {error}")

            for kicker_id in sorted(performances):
                member = matched[kicker_id]
                careers[kicker_id] = {
                    "tmId": member["tmId"],
                    "tmUrl": member["tmUrl"],
                    "clubs": performances[kicker_id]["clubs"],
                    "seasons": performances[kicker_id]["seasons"],
                }
            if failures:
                print(f"[{league}] Karrierewerte fehlgeschlagen: {', '.join(sorted(failures))}", file=sys.stderr)
        print(f"[{league}] {team['name']}: {len(matched)} Spieler zugeordnet, {len(unmatched_squad)} offen, {len(arrivals)} Zugänge, {len(departures)} Abgänge", file=sys.stderr)

    if total_unmatched_players:
        print(f"[{league}] Ohne kicker-Zuordnung: {', '.join(total_unmatched_players)}", file=sys.stderr)
    if total_unmatched_kicker:
        print(f"[{league}] Ohne Transfermarkt-Zuordnung: {', '.join(total_unmatched_kicker)}", file=sys.stderr)
    if len(club_teams) != len(teams):
        raise RuntimeError(f"[{league}] Nur {len(club_teams)} von {len(teams)} Vereinen verarbeitet; Snapshot wird nicht geschrieben.")

    if include_careers:
        club_ids = {
            club["clubId"]
            for career in careers.values()
            for club in career["clubs"]
        }
        career_clubs = resolve_career_clubs(fetcher, club_ids)
        competition_ids = {
            season["competitionId"]
            for career in careers.values()
            for season in career["seasons"]
        }
        career_competitions = resolve_career_competitions(fetcher, competition_ids)
        for career in careers.values():
            for club in career["clubs"]:
                entity = career_clubs.get(club["clubId"], {})
                club["name"] = entity.get("name") or f"Verein {club['clubId']}"
                club["tmUrl"] = entity.get("tmUrl")
            for season in career["seasons"]:
                club = career_clubs.get(season["clubId"], {})
                competition = career_competitions.get(season["competitionId"], {})
                season["name"] = club.get("name") or f"Verein {season['clubId']}"
                season["tmUrl"] = club.get("tmUrl")
                season["competition"] = competition.get("name") or season["competitionId"]
                season["competitionUrl"] = competition.get("tmUrl")

    club_snapshot = {
        "schemaVersion": 1,
        "generatedAt": generated_at,
        "leagueCode": league,
        "season": season_year,
        "provider": "Transfermarkt",
        "teams": club_teams,
    }
    career_snapshot = {
        "schemaVersion": 2,
        "generatedAt": generated_at,
        "leagueCode": league,
        "season": season_year,
        "provider": "Transfermarkt",
        "players": careers,
    }
    return club_snapshot, career_snapshot


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--leagues", default="0001,0002,0003", help="Comma-separated kicker league codes")
    parser.add_argument("--season", type=int, help="Season start year; defaults to the newest season in the catalog")
    parser.add_argument("--all-seasons", action="store_true", help="Generate every archived season in the catalog")
    parser.add_argument("--skip-careers", action="store_true", help="Skip the per-player career performance requests")
    parser.add_argument("--delay", type=float, default=0.8, help="Seconds between requests")
    parser.add_argument("--career-workers", type=int, default=4, help="Concurrent career downloads; request starts remain rate-limited")
    parser.add_argument("--no-cache", action="store_true", help="Bypass the on-disk HTTP cache")
    args = parser.parse_args()
    if args.season and args.all_seasons:
        parser.error("--season and --all-seasons cannot be used together")

    catalog = load_json(DATA_DIR / "catalog.json")
    config = load_json(CONFIG_PATH)
    overrides = load_json(OVERRIDES_PATH) if OVERRIDES_PATH.exists() else {}
    fetcher = Fetcher(CACHE_DIR, args.delay, not args.no_cache)

    for league in [code.strip() for code in args.leagues.split(",") if code.strip()]:
        if league not in LEAGUE_COMPETITIONS:
            raise RuntimeError(f"Unbekannter Liga-Code: {league}")
        newest_year = newest_season(catalog, league)["startYear"]
        archived_years = sorted(
            season["startYear"]
            for season in catalog["seasons"]
            if season["leagueCode"] == league and season["startYear"] != newest_year
        )
        # Generate the current snapshot first so its stable biographical
        # fields can enrich sparse archive tables in the same backfill run.
        season_years = [newest_year, *archived_years] if args.all_seasons else [args.season or newest_year]
        for season_year in season_years:
            club_snapshot, career_snapshot = build_league_snapshot(
                fetcher,
                league,
                season_year,
                config,
                overrides,
                not args.skip_careers,
                max(1, args.career_workers),
            )
            CLUB_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
            club_payload = json.dumps(club_snapshot, ensure_ascii=False, separators=(",", ":")) + "\n"
            (CLUB_OUTPUT_DIR / f"{league}-{season_year}.json").write_text(club_payload)
            if season_year == newest_year:
                (CLUB_OUTPUT_DIR / f"{league}.json").write_text(club_payload)
            if not args.skip_careers:
                CAREER_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
                career_payload = json.dumps(career_snapshot, ensure_ascii=False, separators=(",", ":")) + "\n"
                (CAREER_OUTPUT_DIR / f"{league}-{season_year}.json").write_text(career_payload)
                if season_year == newest_year:
                    (CAREER_OUTPUT_DIR / f"{league}.json").write_text(career_payload)
            print(f"[{league}/{season_year}] Snapshot geschrieben ({fetcher.request_count} Anfragen bisher)", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
