mod media;

use std::{
    collections::{BTreeMap, HashMap},
    path::{Path, PathBuf},
    sync::Arc,
};

use anyhow::{Context, bail};
use chrono::{Datelike, TimeZone, Utc};
use clap::Parser;
use reqwest::{Client, StatusCode};
use serde::{Deserialize, Serialize};
use tokio::sync::Semaphore;

mod news;

use crate::media::{kicker_player_photo_url, kicker_team_logo_url};

const BASE_URL: &str = "https://www.kicker-libero.de";
const SCHEMA_VERSION: u32 = 2;

#[derive(Debug, Parser)]
#[command(about = "Erzeugt die statischen Punktespiegel-Datendateien")]
struct Args {
    #[arg(long, default_value = "frontend/public/data")]
    output: PathBuf,
    #[arg(long, default_value_t = 2022)]
    start_year: i32,
    #[arg(long)]
    end_year: Option<i32>,
    #[arg(long, value_delimiter = ',', default_value = "0001,0002,0003")]
    leagues: Vec<String>,
    #[arg(long)]
    refresh_all: bool,
    #[arg(long)]
    validate_only: bool,
    #[arg(long)]
    news_only: bool,
    #[arg(long, default_value_t = 8)]
    concurrency: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Catalog {
    schema_version: u32,
    generated_at: String,
    leagues: Vec<CatalogLeague>,
    seasons: Vec<CatalogSeason>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CatalogLeague {
    code: String,
    name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CatalogSeason {
    id: String,
    league_code: String,
    start_year: i32,
    display_name: String,
    round_count: i32,
    latest_round: i32,
    data_state: String,
    team_ids: Vec<String>,
    players: Vec<CatalogPlayer>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CatalogPlayer {
    id: String,
    active: bool,
    appearances: i32,
    points: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StaticSeason {
    schema_version: u32,
    generated_at: String,
    id: String,
    league_code: String,
    league_name: String,
    start_year: i32,
    display_name: String,
    round_count: i32,
    latest_round: i32,
    rounds: Vec<StaticRound>,
    teams: Vec<StaticTeam>,
    players: Vec<StaticPlayer>,
    matches: Vec<StaticMatch>,
    scores: Vec<StaticScore>,
}

impl StaticSeason {
    fn catalog_players(&self) -> Vec<CatalogPlayer> {
        let mut players = self
            .players
            .iter()
            .map(|player| {
                (
                    player.id.clone(),
                    CatalogPlayer {
                        id: player.id.clone(),
                        active: player.active,
                        appearances: 0,
                        points: 0,
                    },
                )
            })
            .collect::<BTreeMap<_, _>>();
        for score in &self.scores {
            let Some(player) = players.get_mut(&score.player_id) else {
                continue;
            };
            player.points += score.total_points;
            if score_counts_as_appearance(score) {
                player.appearances += 1;
            }
        }
        players.into_values().collect()
    }

    fn catalog_entry(&self, current_year: i32) -> CatalogSeason {
        let data_state = if self.latest_round >= self.round_count {
            "complete"
        } else if self.start_year == current_year {
            "current"
        } else {
            "partial"
        };
        let mut team_ids = self
            .teams
            .iter()
            .map(|team| team.id.clone())
            .collect::<Vec<_>>();
        team_ids.sort();
        team_ids.dedup();
        CatalogSeason {
            id: self.id.clone(),
            league_code: self.league_code.clone(),
            start_year: self.start_year,
            display_name: self.display_name.clone(),
            round_count: self.round_count,
            latest_round: self.latest_round,
            data_state: data_state.to_owned(),
            team_ids,
            players: self.catalog_players(),
        }
    }
}

fn score_counts_as_appearance(score: &StaticScore) -> bool {
    score.grade.is_some_and(|grade| grade > 0)
        || score.total_points != 0
        || score.goals != 0
        || score.assists != 0
        || score.points_clean_sheet != 0
        || score.points_grade != 0
        || score.points_goals != 0
        || score.points_cards != 0
        || score.points_assists != 0
        || score.points_starter != 0
        || score.points_mvp != 0
        || score.points_joker != 0
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StaticRound {
    id: String,
    number: i32,
    name: String,
    start_at: Option<String>,
    end_at: Option<String>,
    phase: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StaticTeam {
    id: String,
    name: String,
    code: String,
    logo_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StaticPlayer {
    id: String,
    name: String,
    team_id: String,
    position: String,
    price_m: f64,
    active: bool,
    selectable: bool,
    photo_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StaticMatch {
    id: String,
    round: i32,
    home_team_id: String,
    away_team_id: String,
    scheduled_at: Option<String>,
    state: String,
    home_score: Option<i32>,
    away_score: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StaticScore {
    match_id: String,
    player_id: String,
    team_id: String,
    total_points: i32,
    grade: Option<i32>,
    goals: i32,
    assists: i32,
    points_clean_sheet: i32,
    points_grade: i32,
    points_goals: i32,
    points_cards: i32,
    points_assists: i32,
    points_starter: i32,
    points_mvp: i32,
    points_joker: i32,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SeasonDatabase {
    #[serde(default)]
    teams: Vec<UpstreamTeam>,
    #[serde(default)]
    players: Vec<UpstreamPlayer>,
    #[serde(default)]
    rounds: Vec<UpstreamRound>,
    #[serde(default)]
    matches: Vec<UpstreamMatch>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpstreamTeam {
    id: String,
    name: String,
    short_name: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpstreamPlayer {
    id: String,
    #[serde(default)]
    first_name: String,
    #[serde(default)]
    last_name: String,
    #[serde(default)]
    display_long_name: String,
    display_name: String,
    team_id: String,
    position: String,
    market_value: i32,
    #[serde(default)]
    active: bool,
}

impl UpstreamPlayer {
    fn name(&self) -> String {
        if !self.display_long_name.trim().is_empty() {
            return self.display_long_name.trim().to_owned();
        }
        let full_name = format!("{} {}", self.first_name.trim(), self.last_name.trim())
            .trim()
            .to_owned();
        if !full_name.is_empty() {
            return full_name;
        }
        self.display_name.trim().to_owned()
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpstreamRound {
    id: String,
    name: String,
    start_date: i64,
    end_date: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpstreamMatch {
    id: String,
    round_id: String,
    home_team_id: String,
    guest_team_id: String,
    date: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RoundState {
    id: String,
    phase: String,
    #[serde(default)]
    matches: Vec<RoundMatch>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RoundMatch {
    id: String,
    state: String,
    home_score: Option<i32>,
    guest_score: Option<i32>,
    #[serde(default)]
    players: Vec<RoundPlayer>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RoundPlayer {
    id: String,
    #[serde(default, deserialize_with = "null_zero")]
    points: i32,
    #[serde(default)]
    points_break_down: PointsBreakdown,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PointsBreakdown {
    grade: Option<i32>,
    #[serde(default, deserialize_with = "null_zero")]
    goals: i32,
    #[serde(default, deserialize_with = "null_zero")]
    assists: i32,
    #[serde(default, deserialize_with = "null_zero")]
    points_clean_sheet: i32,
    #[serde(default, deserialize_with = "null_zero")]
    points_grade: i32,
    #[serde(default, deserialize_with = "null_zero")]
    points_goals: i32,
    #[serde(default, deserialize_with = "null_zero")]
    points_cards: i32,
    #[serde(default, deserialize_with = "null_zero")]
    points_assists: i32,
    #[serde(default, deserialize_with = "null_zero")]
    points_starter: i32,
    #[serde(default, deserialize_with = "null_zero")]
    points_mvp: i32,
    #[serde(default, deserialize_with = "null_zero")]
    points_joker: i32,
}

#[derive(Debug, Clone)]
struct Target {
    season_id: String,
    league_code: String,
    league_name: String,
    start_year: i32,
}

#[derive(Debug)]
struct SourceSeason {
    target: Target,
    data: SeasonDatabase,
}

fn null_zero<'de, D>(deserializer: D) -> Result<i32, D::Error>
where
    D: serde::Deserializer<'de>,
{
    Ok(Option::<i32>::deserialize(deserializer)?.unwrap_or_default())
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let args = Args::parse();
    validate_args(&args)?;
    if args.validate_only {
        validate_output(&args.output)?;
        println!("Statischer Datenvertrag ist vollständig und konsistent.");
        return Ok(());
    }
    let current_year = args.end_year.unwrap_or_else(current_season_start_year);
    let client = Client::builder()
        .user_agent("Punktespiegel/0.2 (static public football data dashboard)")
        .build()?;
    if args.news_only {
        let season_directory = args.output.join("seasons");
        let mut seasons = std::fs::read_dir(&season_directory)
            .with_context(|| format!("{} lesen", season_directory.display()))?
            .filter_map(Result::ok)
            .filter(|entry| {
                entry
                    .path()
                    .extension()
                    .is_some_and(|extension| extension == "json")
            })
            .map(|entry| read_season(&entry.path()))
            .collect::<anyhow::Result<Vec<_>>>()?;
        seasons.sort_by_key(|season| (season.league_code.clone(), season.start_year));
        news::refresh_news(&client, &args.output, &seasons, current_year).await?;
        return Ok(());
    }
    let targets = build_targets(&args.leagues, args.start_year, current_year)?;

    std::fs::create_dir_all(args.output.join("seasons"))
        .with_context(|| format!("Ausgabeverzeichnis {} anlegen", args.output.display()))?;

    let mut completed = Vec::new();
    let mut sources = Vec::new();
    for target in targets {
        let destination = season_path(&args.output, &target.season_id);
        if !args.refresh_all && target.start_year < current_year && destination.exists() {
            let cached = read_season(&destination)?;
            if cached.latest_round >= cached.round_count {
                completed.push(cached);
                continue;
            }
            println!(
                "{}: unvollständige Vorsaison einmalig abschließen",
                target.season_id
            );
        }
        println!("{}: Saisondaten laden", target.season_id);
        let data = fetch_season(&client, &target.season_id).await?;
        sources.push(SourceSeason { target, data });
    }

    let metadata = build_global_metadata(&sources);
    for source in sources {
        println!("{}: Spieltage laden", source.target.season_id);
        let round_states = fetch_rounds(&client, &source, current_year, args.concurrency).await?;
        let season = build_static_season(source, round_states, &metadata, current_year)?;
        write_json(&season_path(&args.output, &season.id), &season)?;
        println!(
            "{}: {} Spieler, {} Spiele, {} Wertungen",
            season.id,
            season.players.len(),
            season.matches.len(),
            season.scores.len()
        );
        completed.push(season);
    }

    completed.sort_by_key(|season| (season.league_code.clone(), season.start_year));
    let mut leagues = BTreeMap::new();
    for season in &completed {
        leagues.insert(season.league_code.clone(), season.league_name.clone());
    }
    let catalog = Catalog {
        schema_version: SCHEMA_VERSION,
        generated_at: Utc::now().to_rfc3339(),
        leagues: leagues
            .into_iter()
            .map(|(code, name)| CatalogLeague { code, name })
            .collect(),
        seasons: completed
            .iter()
            .map(|season| season.catalog_entry(current_year))
            .collect(),
    };
    write_json(&args.output.join("catalog.json"), &catalog)?;
    println!(
        "Katalog mit {} Liga-Saisons geschrieben: {}",
        catalog.seasons.len(),
        args.output.display()
    );
    if let Err(error) = news::refresh_news(&client, &args.output, &completed, current_year).await {
        eprintln!(
            "Nachrichtenabgleich fehlgeschlagen; vorhandener Stand bleibt erhalten: {error:#}"
        );
    }
    Ok(())
}

fn validate_args(args: &Args) -> anyhow::Result<()> {
    if args.start_year < 2000 {
        bail!("--start-year muss mindestens 2000 sein");
    }
    if args.concurrency == 0 || args.concurrency > 32 {
        bail!("--concurrency muss zwischen 1 und 32 liegen");
    }
    for league in &args.leagues {
        if league.len() != 4 || !league.chars().all(|character| character.is_ascii_digit()) {
            bail!("Liga-Codes müssen vierstellig sein, zum Beispiel 0001");
        }
    }
    Ok(())
}

fn current_season_start_year() -> i32 {
    let today = Utc::now().date_naive();
    if today.month() >= 7 {
        today.year()
    } else {
        today.year() - 1
    }
}

fn build_targets(
    leagues: &[String],
    start_year: i32,
    end_year: i32,
) -> anyhow::Result<Vec<Target>> {
    if end_year < start_year {
        bail!("--end-year darf nicht vor --start-year liegen");
    }
    let mut targets = Vec::new();
    for league_code in leagues {
        let league_name = league_name(league_code).to_owned();
        for year in start_year..=end_year {
            targets.push(Target {
                season_id: format!("se-k{league_code}{year}"),
                league_code: league_code.clone(),
                league_name: league_name.clone(),
                start_year: year,
            });
        }
    }
    Ok(targets)
}

fn league_name(code: &str) -> &str {
    match code {
        "0001" => "Bundesliga",
        "0002" => "2. Bundesliga",
        "0003" => "3. Liga",
        _ => code,
    }
}

async fn fetch_season(client: &Client, season_id: &str) -> anyhow::Result<SeasonDatabase> {
    let url = format!("{BASE_URL}/api/sportsdata/v1/client_database/{season_id}.json");
    client
        .get(&url)
        .send()
        .await
        .with_context(|| format!("Saisondaten anfragen: {url}"))?
        .error_for_status()
        .with_context(|| format!("Saisondaten abrufen: {url}"))?
        .json()
        .await
        .with_context(|| format!("Saisondaten lesen: {url}"))
}

async fn fetch_rounds(
    client: &Client,
    source: &SourceSeason,
    current_year: i32,
    concurrency: usize,
) -> anyhow::Result<HashMap<String, RoundState>> {
    let now = Utc::now().timestamp_millis();
    let historical = source.target.start_year < current_year;
    let round_ids = source
        .data
        .rounds
        .iter()
        .filter(|round| historical || round.end_date <= now)
        .map(|round| round.id.clone())
        .collect::<Vec<_>>();
    let semaphore = Arc::new(Semaphore::new(concurrency));
    let mut tasks = tokio::task::JoinSet::new();
    for round_id in round_ids {
        let client = client.clone();
        let semaphore = semaphore.clone();
        tasks.spawn(async move {
            let _permit = semaphore.acquire_owned().await?;
            let url = format!("{BASE_URL}/api/gameloop/v1/state/round/{round_id}.json");
            let response = client
                .get(&url)
                .send()
                .await
                .with_context(|| format!("Spieltagsdaten anfragen: {url}"))?;
            if response.status() == StatusCode::NOT_FOUND {
                return Ok::<_, anyhow::Error>(None);
            }
            let response = response
                .error_for_status()
                .with_context(|| format!("Spieltagsdaten abrufen: {url}"))?;
            let value = response
                .json::<serde_json::Value>()
                .await
                .with_context(|| format!("Spieltagsdaten lesen: {url}"))?;
            if value.is_null() {
                return Ok(None);
            }
            let state = serde_json::from_value::<RoundState>(value)
                .with_context(|| format!("Spieltagsdaten entsprachen nicht dem Vertrag: {url}"))?;
            if state.id != round_id {
                bail!("Spieltagskennung in {url} war unerwartet");
            }
            Ok(Some((round_id, state)))
        });
    }
    let mut states = HashMap::new();
    while let Some(result) = tasks.join_next().await {
        if let Some((id, state)) = result.context("Spieltags-Task ist fehlgeschlagen")?? {
            states.insert(id, state);
        }
    }
    Ok(states)
}

fn build_global_metadata(sources: &[SourceSeason]) -> HashMap<String, Vec<(i32, UpstreamPlayer)>> {
    let mut result: HashMap<String, Vec<(i32, UpstreamPlayer)>> = HashMap::new();
    for source in sources {
        for player in &source.data.players {
            result
                .entry(player.id.clone())
                .or_default()
                .push((source.target.start_year, player.clone()));
        }
    }
    result
}

fn build_static_season(
    source: SourceSeason,
    round_states: HashMap<String, RoundState>,
    metadata: &HashMap<String, Vec<(i32, UpstreamPlayer)>>,
    current_year: i32,
) -> anyhow::Result<StaticSeason> {
    let SourceSeason { target, data } = source;
    let mut ordered_rounds = data.rounds.clone();
    ordered_rounds.sort_by_key(|round| (round.start_date, round.id.clone()));
    let round_numbers = ordered_rounds
        .iter()
        .enumerate()
        .map(|(index, round)| {
            (
                round.id.clone(),
                parse_round_number(&round.name).unwrap_or(index as i32 + 1),
            )
        })
        .collect::<HashMap<_, _>>();

    let mut match_overlays = HashMap::new();
    let mut raw_scores = Vec::new();
    for state in round_states.values() {
        for fixture in &state.matches {
            match_overlays.insert(
                fixture.id.clone(),
                (
                    fixture.state.clone(),
                    fixture.home_score,
                    fixture.guest_score,
                ),
            );
            for player in &fixture.players {
                raw_scores.push((fixture.id.clone(), player.clone()));
            }
        }
    }

    let source_matches = data
        .matches
        .iter()
        .map(|fixture| (fixture.id.clone(), fixture))
        .collect::<HashMap<_, _>>();
    let mut team_counts: HashMap<(String, String), usize> = HashMap::new();
    for (match_id, player) in &raw_scores {
        let Some(fixture) = source_matches.get(match_id) else {
            continue;
        };
        *team_counts
            .entry((player.id.clone(), fixture.home_team_id.clone()))
            .or_default() += 1;
        *team_counts
            .entry((player.id.clone(), fixture.guest_team_id.clone()))
            .or_default() += 1;
    }
    let dominant_teams = dominant_teams(&team_counts);

    let mut players_by_id = data
        .players
        .iter()
        .map(|player| (player.id.clone(), player.clone()))
        .collect::<HashMap<_, _>>();
    for (_, score) in &raw_scores {
        if players_by_id.contains_key(&score.id) {
            continue;
        }
        if let Some(candidates) = metadata.get(&score.id)
            && let Some((_, candidate)) = candidates
                .iter()
                .min_by_key(|(year, _)| ((year - target.start_year).abs(), -year))
        {
            players_by_id.insert(score.id.clone(), candidate.clone());
        }
    }

    let scoring_players = raw_scores
        .iter()
        .map(|(_, score)| score.id.as_str())
        .collect::<std::collections::HashSet<_>>();
    let season_team_ids = data
        .teams
        .iter()
        .map(|team| team.id.as_str())
        .collect::<std::collections::HashSet<_>>();
    let historical = target.start_year < current_year;
    let mut players = players_by_id
        .values()
        .filter_map(|player| {
            let position = normalize_position(&player.position)?;
            let team_id = if historical || !season_team_ids.contains(player.team_id.as_str()) {
                dominant_teams
                    .get(&player.id)
                    .cloned()
                    .unwrap_or_else(|| player.team_id.clone())
            } else {
                player.team_id.clone()
            };
            let appeared = scoring_players.contains(player.id.as_str());
            Some(StaticPlayer {
                id: player.id.clone(),
                name: player.name(),
                photo_url: kicker_player_photo_url(&player.id, &team_id),
                team_id,
                position: position.to_owned(),
                price_m: f64::from(player.market_value) / 1_000_000.0,
                active: player.active || appeared,
                selectable: appeared || player.active,
            })
        })
        .collect::<Vec<_>>();
    players.sort_by(|left, right| left.name.cmp(&right.name).then(left.id.cmp(&right.id)));

    let mut scores = Vec::new();
    let static_player_ids = players
        .iter()
        .map(|player| player.id.as_str())
        .collect::<std::collections::HashSet<_>>();
    let static_player_teams = players
        .iter()
        .map(|player| (player.id.as_str(), player.team_id.clone()))
        .collect::<HashMap<_, _>>();
    for (match_id, player) in raw_scores {
        let Some(fixture) = source_matches.get(&match_id) else {
            continue;
        };
        if !static_player_ids.contains(player.id.as_str()) {
            continue;
        }
        let source_team = static_player_teams.get(player.id.as_str()).cloned();
        let team_id = if !historical
            && source_team
                .as_ref()
                .is_some_and(|team| team == &fixture.home_team_id || team == &fixture.guest_team_id)
        {
            source_team.expect("Quellverein wurde unmittelbar zuvor geprüft")
        } else {
            observed_team(&player.id, fixture, &team_counts)
                .or_else(|| dominant_teams.get(&player.id).cloned())
                .or(source_team)
                .unwrap_or_else(|| fixture.home_team_id.clone())
        };
        let breakdown = player.points_break_down;
        scores.push(StaticScore {
            match_id,
            player_id: player.id,
            team_id,
            total_points: player.points,
            grade: breakdown.grade,
            goals: breakdown.goals,
            assists: breakdown.assists,
            points_clean_sheet: breakdown.points_clean_sheet,
            points_grade: breakdown.points_grade,
            points_goals: breakdown.points_goals,
            points_cards: breakdown.points_cards,
            points_assists: breakdown.points_assists,
            points_starter: breakdown.points_starter,
            points_mvp: breakdown.points_mvp,
            points_joker: breakdown.points_joker,
        });
    }
    scores.sort_by(|left, right| {
        left.match_id
            .cmp(&right.match_id)
            .then(left.player_id.cmp(&right.player_id))
    });

    let rounds = ordered_rounds
        .iter()
        .map(|round| StaticRound {
            id: round.id.clone(),
            number: *round_numbers.get(&round.id).unwrap_or(&0),
            name: round.name.clone(),
            start_at: timestamp(round.start_date),
            end_at: timestamp(round.end_date),
            phase: round_states
                .get(&round.id)
                .map(|state| state.phase.clone())
                .unwrap_or_else(|| "SCHEDULED".to_owned()),
        })
        .collect::<Vec<_>>();
    let mut matches = data
        .matches
        .iter()
        .map(|fixture| {
            let overlay = match_overlays.get(&fixture.id);
            StaticMatch {
                id: fixture.id.clone(),
                round: *round_numbers.get(&fixture.round_id).unwrap_or(&0),
                home_team_id: fixture.home_team_id.clone(),
                away_team_id: fixture.guest_team_id.clone(),
                scheduled_at: timestamp(fixture.date),
                state: overlay
                    .map(|value| value.0.clone())
                    .unwrap_or_else(|| "SCHEDULED".to_owned()),
                home_score: overlay.and_then(|value| value.1),
                away_score: overlay.and_then(|value| value.2),
            }
        })
        .collect::<Vec<_>>();
    matches.sort_by_key(|fixture| {
        (
            fixture.round,
            fixture.scheduled_at.clone(),
            fixture.id.clone(),
        )
    });

    let teams = data
        .teams
        .into_iter()
        .map(|team| StaticTeam {
            logo_url: kicker_team_logo_url(&team.id),
            id: team.id,
            name: team.name,
            code: team.short_name,
        })
        .collect::<Vec<_>>();
    let latest_round = matches
        .iter()
        .filter(|fixture| scores.iter().any(|score| score.match_id == fixture.id))
        .map(|fixture| fixture.round)
        .max()
        .unwrap_or(0);
    let round_count = rounds.iter().map(|round| round.number).max().unwrap_or(0);
    Ok(StaticSeason {
        schema_version: SCHEMA_VERSION,
        generated_at: Utc::now().to_rfc3339(),
        id: target.season_id,
        league_code: target.league_code,
        league_name: target.league_name,
        start_year: target.start_year,
        display_name: format!("{}/{}", target.start_year, (target.start_year + 1) % 100),
        round_count,
        latest_round,
        rounds,
        teams,
        players,
        matches,
        scores,
    })
}

fn dominant_teams(counts: &HashMap<(String, String), usize>) -> HashMap<String, String> {
    let mut result: HashMap<String, (String, usize)> = HashMap::new();
    for ((player_id, team_id), count) in counts {
        match result.get(player_id) {
            Some((best_team, best_count))
                if best_count > count || (best_count == count && best_team <= team_id) => {}
            _ => {
                result.insert(player_id.clone(), (team_id.clone(), *count));
            }
        }
    }
    result
        .into_iter()
        .map(|(player, (team, _))| (player, team))
        .collect()
}

fn observed_team(
    player_id: &str,
    fixture: &UpstreamMatch,
    counts: &HashMap<(String, String), usize>,
) -> Option<String> {
    let home = counts
        .get(&(player_id.to_owned(), fixture.home_team_id.clone()))
        .copied()
        .unwrap_or(0);
    let away = counts
        .get(&(player_id.to_owned(), fixture.guest_team_id.clone()))
        .copied()
        .unwrap_or(0);
    match home.cmp(&away) {
        std::cmp::Ordering::Greater => Some(fixture.home_team_id.clone()),
        std::cmp::Ordering::Less => Some(fixture.guest_team_id.clone()),
        std::cmp::Ordering::Equal => Some(
            fixture
                .home_team_id
                .clone()
                .min(fixture.guest_team_id.clone()),
        ),
    }
}

fn normalize_position(value: &str) -> Option<&'static str> {
    match value.trim().to_ascii_uppercase().as_str() {
        "GOALKEEPER" | "GK" => Some("GK"),
        "DEFENDER" | "DEF" => Some("DEF"),
        "MIDFIELDER" | "MID" => Some("MID"),
        "FORWARD" | "FWD" => Some("FWD"),
        _ => None,
    }
}

fn parse_round_number(value: &str) -> Option<i32> {
    value
        .split(|character: char| !character.is_ascii_digit())
        .find(|part| !part.is_empty())?
        .parse()
        .ok()
}

fn timestamp(value: i64) -> Option<String> {
    Utc.timestamp_millis_opt(value)
        .single()
        .map(|time| time.to_rfc3339())
}

fn season_path(output: &Path, season_id: &str) -> PathBuf {
    output.join("seasons").join(format!("{season_id}.json"))
}

fn read_season(path: &Path) -> anyhow::Result<StaticSeason> {
    let bytes = std::fs::read(path)
        .with_context(|| format!("Statische Saison lesen: {}", path.display()))?;
    let season = serde_json::from_slice::<StaticSeason>(&bytes)
        .with_context(|| format!("Statische Saison prüfen: {}", path.display()))?;
    if season.schema_version != SCHEMA_VERSION {
        bail!(
            "{} verwendet Datenvertrag {}, erwartet wird {}. Mit --refresh-all neu erzeugen.",
            path.display(),
            season.schema_version,
            SCHEMA_VERSION
        );
    }
    Ok(season)
}

fn write_json<T: Serialize>(path: &Path, value: &T) -> anyhow::Result<()> {
    let bytes = serde_json::to_vec(value)?;
    let temporary = path.with_extension("json.tmp");
    std::fs::write(&temporary, bytes)
        .with_context(|| format!("Temporäres JSON schreiben: {}", temporary.display()))?;
    std::fs::rename(&temporary, path)
        .with_context(|| format!("JSON atomar ersetzen: {}", path.display()))
}

fn validate_output(output: &Path) -> anyhow::Result<()> {
    let catalog_path = output.join("catalog.json");
    let catalog = serde_json::from_slice::<Catalog>(
        &std::fs::read(&catalog_path)
            .with_context(|| format!("Katalog lesen: {}", catalog_path.display()))?,
    )
    .with_context(|| format!("Katalog prüfen: {}", catalog_path.display()))?;
    if catalog.schema_version != SCHEMA_VERSION || catalog.seasons.is_empty() {
        bail!("Katalog ist leer oder verwendet einen unbekannten Datenvertrag");
    }
    for entry in catalog.seasons {
        let path = season_path(output, &entry.id);
        let season = read_season(&path)?;
        let mut catalog_team_ids = season
            .teams
            .iter()
            .map(|team| team.id.clone())
            .collect::<Vec<_>>();
        catalog_team_ids.sort();
        catalog_team_ids.dedup();
        let catalog_players = season.catalog_players();
        if season.id != entry.id
            || season.league_code != entry.league_code
            || season.start_year != entry.start_year
            || season.round_count != entry.round_count
            || season.latest_round != entry.latest_round
            || entry.team_ids != catalog_team_ids
            || entry.players != catalog_players
        {
            bail!("Katalog und Saisondatei widersprechen sich: {}", entry.id);
        }
        let team_ids = season
            .teams
            .iter()
            .map(|team| team.id.as_str())
            .collect::<std::collections::HashSet<_>>();
        let player_ids = season
            .players
            .iter()
            .map(|player| player.id.as_str())
            .collect::<std::collections::HashSet<_>>();
        let match_ids = season
            .matches
            .iter()
            .map(|fixture| fixture.id.as_str())
            .collect::<std::collections::HashSet<_>>();
        if season
            .players
            .iter()
            .any(|player| !team_ids.contains(player.team_id.as_str()))
            || season.matches.iter().any(|fixture| {
                !team_ids.contains(fixture.home_team_id.as_str())
                    || !team_ids.contains(fixture.away_team_id.as_str())
            })
            || season.scores.iter().any(|score| {
                !team_ids.contains(score.team_id.as_str())
                    || !player_ids.contains(score.player_id.as_str())
                    || !match_ids.contains(score.match_id.as_str())
            })
        {
            bail!("Saisondatei enthält verwaiste Verweise: {}", entry.id);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn derives_the_football_round_number() {
        assert_eq!(parse_round_number("34. Spieltag"), Some(34));
        assert_eq!(parse_round_number("Spieltag 7"), Some(7));
    }

    #[test]
    fn normalizes_source_positions() {
        assert_eq!(normalize_position("GOALKEEPER"), Some("GK"));
        assert_eq!(normalize_position("fwd"), Some("FWD"));
        assert_eq!(normalize_position("trainer"), None);
    }

    #[test]
    fn unavailable_market_value_stays_machine_readable() {
        let player = StaticPlayer {
            id: "pl-k1".to_owned(),
            name: "Beispiel".to_owned(),
            team_id: "tm-k1".to_owned(),
            position: "DEF".to_owned(),
            price_m: 999.0,
            active: true,
            selectable: true,
            photo_url: None,
        };
        assert!(serde_json::to_string(&player).unwrap().contains("999.0"));
    }

    #[test]
    fn prefers_the_complete_player_name() {
        let player = UpstreamPlayer {
            id: "pl-k1".to_owned(),
            first_name: "Maxwell".to_owned(),
            last_name: "Gyamfi".to_owned(),
            display_long_name: "Maxwell Gyamfi".to_owned(),
            display_name: "Gyamfi".to_owned(),
            team_id: "tm-k1".to_owned(),
            position: "DEFENDER".to_owned(),
            market_value: 500_000,
            active: true,
        };
        assert_eq!(player.name(), "Maxwell Gyamfi");
    }

    #[test]
    fn catalog_appearance_ignores_empty_score_rows() {
        let mut score = StaticScore {
            match_id: "match".to_owned(),
            player_id: "player".to_owned(),
            team_id: "team".to_owned(),
            total_points: 0,
            grade: Some(0),
            goals: 0,
            assists: 0,
            points_clean_sheet: 0,
            points_grade: 0,
            points_goals: 0,
            points_cards: 0,
            points_assists: 0,
            points_starter: 0,
            points_mvp: 0,
            points_joker: 0,
        };
        assert!(!score_counts_as_appearance(&score));
        score.points_starter = 4;
        assert!(score_counts_as_appearance(&score));
    }
}
