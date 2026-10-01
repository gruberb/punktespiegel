//! Spieltagstexte: the hero cards and "Der Spieltag in Zahlen" facts on the
//! Überblick page.
//!
//! Code computes every number. Per matchday it derives a set of candidate
//! cards and facts, each with a deterministic German template text. When an
//! API key is configured, Claude picks the most telling candidates and
//! rephrases the question or sentence. Every model text is validated against
//! the candidate's own facts (numbers, team and player names, length); a text
//! that fails keeps the template, so a published card can never state a number
//! the data does not contain.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::fmt;
use std::path::Path;
use std::time::Duration;

use anyhow::{Context, bail};
use chrono::Utc;
use reqwest::{Client, StatusCode};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use super::{StaticMatch, StaticPlayer, StaticSeason, StaticTeam, write_json};

pub const INSIGHTS_SCHEMA_VERSION: u32 = 1;
// Part of the cache key: bump it when the prompt, the candidate set or a
// template changes, so every matchday is rebuilt on the next run.
const PROMPT_VERSION: u32 = 1;
const MAX_MODEL_ATTEMPTS: u32 = 3;
const CARD_COUNT: usize = 3;
const FACT_COUNT: usize = 4;
const MAX_QUESTION_CHARS: usize = 70;
const MAX_TEXT_CHARS: usize = 220;
const RECENT_ROUNDS: i32 = 5;
const MESSAGES_URL: &str = "https://api.anthropic.com/v1/messages";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(180);

const SYSTEM_PROMPT: &str = "You write short German copy for Punktespiegel, a football statistics site built on kicker data for the Bundesliga, 2. Bundesliga and 3. Liga. \
You receive candidate cards and facts for one matchday. Code computed them from the match data; they are correct and complete.

Choose the cards and facts a football fan would find most telling for this matchday (the payload says how many of each), and write German text for each one you choose:
- card: `question`, one short question of at most 70 characters that the card's `answer` responds to.
- fact: `text`, one or two plain sentences of at most 220 characters that put the fact's `value` in context.

Rules:
- Use only information contained in that candidate's `facts`, `answer`, `detail`, `value` and `context`. Do not add other results, history, records, streaks, injuries, causes or opinions.
- Write every number as digits, exactly as it appears in the facts. Do not write dates or times.
- Name teams and players only with the `name` or `short` given in the facts. Never use nicknames or club abbreviations.
- Neutral, factual tone, like a kicker ticker line. No exclamation marks, no emojis, no markdown, no quotation marks.
- Prefer variety: avoid two choices about the same team when other candidates are notable.
- Use the candidate ids exactly as given.";

#[derive(Debug, Clone)]
pub struct InsightsConfig {
    pub api_key: Option<String>,
    pub model: String,
    pub effort: String,
    /// Upper bound on model requests per run; newest matchdays are served first.
    pub model_budget: usize,
}

// ---------------------------------------------------------------- artifact

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Source {
    Model,
    Template,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Kind {
    Leader,
    TopPlayer,
    RoundGoals,
    RoundTopPlayer,
    WinStreak,
    BiggestWin,
    MostGoals,
    BiggestClimb,
    BiggestFall,
    MultiGoal,
    Unbeaten,
    Winless,
    CleanSheets,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Visual {
    /// The team's most recent results, oldest first.
    Results { label: String, rows: Vec<ResultRow> },
    /// The player's points in their most recent appearances, oldest first.
    RoundPoints { label: String, rows: Vec<PointsRow> },
    /// One entry per match of the matchday: "H", "U" or "A".
    Outcomes { label: String, values: Vec<String> },
}

/// The team or player a card or fact is about, so the page can show its logo
/// or portrait and link to the profile.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Subject {
    pub kind: SubjectKind,
    pub id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub image_url: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SubjectKind {
    Team,
    Player,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResultRow {
    pub round: i32,
    /// "S", "U" or "N".
    pub outcome: String,
    /// From the team's point of view, e.g. "3:1".
    pub score: String,
    pub opponent: String,
    pub home: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PointsRow {
    pub round: i32,
    pub points: i32,
    pub opponent: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Card {
    pub id: String,
    pub kind: Kind,
    pub title: String,
    pub category: String,
    pub question: String,
    pub answer: String,
    pub detail_label: String,
    pub detail: String,
    pub visual: Visual,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub subject: Option<Subject>,
    pub source: Source,
    /// Why a model text was replaced by the template; absent otherwise.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rejected: Option<String>,
    pub facts: BTreeMap<String, Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FactItem {
    pub id: String,
    pub kind: Kind,
    pub title: String,
    pub value: String,
    pub context: String,
    /// "up", "down" or "" for neutral.
    pub tone: String,
    pub text: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub subjects: Vec<Subject>,
    pub source: Source,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rejected: Option<String>,
    pub facts: BTreeMap<String, Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoundInsights {
    pub round: i32,
    pub facts_hash: String,
    pub generated_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    pub model_attempts: u32,
    pub cards: Vec<Card>,
    pub facts: Vec<FactItem>,
}

impl RoundInsights {
    fn wants_model(&self) -> bool {
        self.model_attempts < MAX_MODEL_ATTEMPTS
            && (self
                .cards
                .iter()
                .any(|card| card.source == Source::Template)
                || self
                    .facts
                    .iter()
                    .any(|fact| fact.source == Source::Template))
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InsightsFile {
    pub schema_version: u32,
    pub prompt_version: u32,
    pub season_id: String,
    pub league_code: String,
    pub start_year: i32,
    pub rounds: Vec<RoundInsights>,
}

// ---------------------------------------------------------------- refresh

pub async fn refresh_insights(
    client: &Client,
    output: &Path,
    seasons: &[StaticSeason],
    config: &InsightsConfig,
) -> anyhow::Result<()> {
    let directory = output.join("insights");
    std::fs::create_dir_all(&directory)
        .with_context(|| format!("{} anlegen", directory.display()))?;

    let mut files = Vec::new();
    let mut pending = Vec::new();
    for (season_index, season) in seasons.iter().enumerate() {
        let path = insights_path(output, &season.id);
        let cached = read_cached(&path);
        let index = SeasonIndex::new(season);
        let mut rounds = Vec::new();
        for round in 1..=season.latest_round {
            let candidates = index.candidates(round);
            if candidates.is_empty() {
                continue;
            }
            let hash = facts_hash(&candidates);
            let entry = cached
                .get(&round)
                .filter(|entry| entry.facts_hash == hash)
                .cloned()
                .unwrap_or_else(|| template_round(round, hash, &candidates));
            if entry.wants_model() {
                pending.push((season.start_year, round, season_index, rounds.len()));
            }
            rounds.push((entry, candidates));
        }
        files.push((path, rounds));
    }

    // Newest matchdays first, so a small budget always covers the current round
    // of every league before backfilling older ones.
    pending.sort_by(|left, right| (right.0, right.1, left.2).cmp(&(left.0, left.1, right.2)));
    let budget = if config.api_key.is_some() {
        config.model_budget
    } else {
        0
    };
    let (mut written, mut fallback) = (0usize, 0usize);
    for &(_, round, season_index, round_index) in pending.iter().take(budget) {
        let season = &seasons[season_index];
        let (entry, candidates) = &mut files[season_index].1[round_index];
        let index = SeasonIndex::new(season);
        match request_model(client, config, &model_payload(season, round, candidates)).await {
            Ok(output) => {
                *entry = apply_model(entry, candidates, &output, &index.vocabulary(round), config);
                written += 1;
            }
            Err(ModelError::Rejected(reason)) => {
                entry.model_attempts += 1;
                fallback += 1;
                eprintln!(
                    "{} Spieltag {round}: Modellantwort verworfen: {reason}",
                    season.id
                );
            }
            Err(ModelError::Transient(reason)) => {
                fallback += 1;
                eprintln!(
                    "{} Spieltag {round}: Modell nicht erreichbar, Vorlage bleibt: {reason}",
                    season.id
                );
            }
        }
    }

    for ((path, rounds), season) in files.into_iter().zip(seasons) {
        let file = InsightsFile {
            schema_version: INSIGHTS_SCHEMA_VERSION,
            prompt_version: PROMPT_VERSION,
            season_id: season.id.clone(),
            league_code: season.league_code.clone(),
            start_year: season.start_year,
            rounds: rounds.into_iter().map(|(entry, _)| entry).collect(),
        };
        write_json(&path, &file)?;
    }
    let waiting = pending.len().saturating_sub(written + fallback);
    if config.api_key.is_some() {
        println!(
            "Spieltagstexte: {written} Spieltage neu formuliert, {fallback} ohne verwertbare Modellantwort, {waiting} warten auf einen späteren Lauf"
        );
    } else {
        println!("Spieltagstexte: Vorlagentexte geschrieben, ANTHROPIC_API_KEY ist nicht gesetzt");
    }
    Ok(())
}

pub fn insights_path(output: &Path, season_id: &str) -> std::path::PathBuf {
    output.join("insights").join(format!("{season_id}.json"))
}

fn read_cached(path: &Path) -> HashMap<i32, RoundInsights> {
    let Ok(bytes) = std::fs::read(path) else {
        return HashMap::new();
    };
    match serde_json::from_slice::<InsightsFile>(&bytes) {
        Ok(file)
            if file.schema_version == INSIGHTS_SCHEMA_VERSION
                && file.prompt_version == PROMPT_VERSION =>
        {
            file.rounds
                .into_iter()
                .map(|round| (round.round, round))
                .collect()
        }
        // An unreadable or outdated cache only costs a rebuild.
        _ => HashMap::new(),
    }
}

pub fn validate_insights_file(path: &Path, season: &StaticSeason) -> anyhow::Result<()> {
    if !path.exists() {
        return Ok(());
    }
    let file = serde_json::from_slice::<InsightsFile>(
        &std::fs::read(path).with_context(|| format!("{} lesen", path.display()))?,
    )
    .with_context(|| format!("{} prüfen", path.display()))?;
    if file.schema_version != INSIGHTS_SCHEMA_VERSION || file.season_id != season.id {
        bail!("Spieltagstexte passen nicht zur Saison: {}", path.display());
    }
    for round in &file.rounds {
        if round.round < 1 || round.round > season.latest_round {
            bail!(
                "{}: Spieltag {} liegt außerhalb der Saisondaten",
                path.display(),
                round.round
            );
        }
        if round.cards.len() > CARD_COUNT || round.facts.len() > FACT_COUNT {
            bail!(
                "{}: Spieltag {} enthält zu viele Einträge",
                path.display(),
                round.round
            );
        }
        let texts = round
            .cards
            .iter()
            .map(|card| (card.question.as_str(), MAX_QUESTION_CHARS))
            .chain(
                round
                    .facts
                    .iter()
                    .map(|fact| (fact.text.as_str(), MAX_TEXT_CHARS)),
            );
        for (text, limit) in texts {
            if text.trim().is_empty() || text.chars().count() > limit {
                bail!(
                    "{}: Spieltag {} enthält einen leeren oder zu langen Text",
                    path.display(),
                    round.round
                );
            }
        }
    }
    Ok(())
}

// ---------------------------------------------------------------- season index

#[derive(Debug, Clone, Default, PartialEq, Eq)]
struct Row {
    team_id: String,
    rank: i32,
    played: i32,
    wins: i32,
    draws: i32,
    losses: i32,
    goals_for: i32,
    goals_against: i32,
    points: i32,
}

#[derive(Debug, Clone, Default)]
struct PlayerTotals {
    points: i32,
    goals: i32,
    assists: i32,
    grade_total: i32,
    graded: i32,
    by_round: BTreeMap<i32, RoundLine>,
}

#[derive(Debug, Clone, Default)]
struct RoundLine {
    points: i32,
    goals: i32,
    assists: i32,
    grade: Option<i32>,
    opponent: Option<String>,
}

struct PlayedMatch<'a> {
    home: &'a str,
    away: &'a str,
    home_goals: i32,
    away_goals: i32,
    scheduled_at: Option<&'a str>,
    id: &'a str,
}

struct SeasonIndex<'a> {
    season: &'a StaticSeason,
    teams: HashMap<&'a str, &'a StaticTeam>,
    players: HashMap<&'a str, &'a StaticPlayer>,
    matches: HashMap<&'a str, &'a StaticMatch>,
}

impl<'a> SeasonIndex<'a> {
    fn new(season: &'a StaticSeason) -> Self {
        Self {
            season,
            teams: season
                .teams
                .iter()
                .map(|team| (team.id.as_str(), team))
                .collect(),
            players: season
                .players
                .iter()
                .map(|player| (player.id.as_str(), player))
                .collect(),
            matches: season
                .matches
                .iter()
                .map(|fixture| (fixture.id.as_str(), fixture))
                .collect(),
        }
    }

    fn team_subject(&self, team_id: &str) -> Option<Subject> {
        let team = self.teams.get(team_id)?;
        Some(Subject {
            kind: SubjectKind::Team,
            id: team.id.clone(),
            name: team.name.clone(),
            image_url: team.logo_url.clone(),
        })
    }

    fn player_subject(&self, player_id: &str) -> Option<Subject> {
        let player = self.players.get(player_id)?;
        Some(Subject {
            kind: SubjectKind::Player,
            id: player.id.clone(),
            name: player.name.clone(),
            image_url: player.photo_url.clone(),
        })
    }

    /// Players first: a scorer fact is about the scorer, not the club.
    fn attach_subjects(&self, candidate: &mut Candidate) {
        let players = candidate
            .player_ids
            .iter()
            .filter_map(|id| self.player_subject(id))
            .collect::<Vec<_>>();
        let teams = candidate
            .team_ids
            .iter()
            .filter_map(|id| self.team_subject(id))
            .collect::<Vec<_>>();
        match &mut candidate.item {
            Item::Card(card) => card.subject = players.into_iter().chain(teams).next(),
            Item::Fact(fact) => fact.subjects = if players.is_empty() { teams } else { players },
        }
    }

    fn short(&self, team_id: &str) -> String {
        self.teams
            .get(team_id)
            .map_or_else(|| team_id.to_owned(), |team| team.code.clone())
    }

    fn name(&self, team_id: &str) -> String {
        self.teams
            .get(team_id)
            .map_or_else(|| team_id.to_owned(), |team| team.name.clone())
    }

    fn played(&self, through: i32) -> impl Iterator<Item = (i32, PlayedMatch<'a>)> + '_ {
        self.season
            .matches
            .iter()
            .filter(move |fixture| fixture.round <= through)
            .filter_map(|fixture| {
                Some((
                    fixture.round,
                    PlayedMatch {
                        home: &fixture.home_team_id,
                        away: &fixture.away_team_id,
                        home_goals: fixture.home_score?,
                        away_goals: fixture.away_score?,
                        scheduled_at: fixture.scheduled_at.as_deref(),
                        id: &fixture.id,
                    },
                ))
            })
    }

    /// Mirrors `computeTable` in frontend/src/standings.ts so ranks match the UI.
    fn table(&self, through: i32) -> Vec<Row> {
        let mut rows = self
            .season
            .teams
            .iter()
            .map(|team| {
                (
                    team.id.as_str(),
                    Row {
                        team_id: team.id.clone(),
                        ..Row::default()
                    },
                )
            })
            .collect::<HashMap<_, _>>();
        for (_, fixture) in self.played(through) {
            let (home_points, away_points) = match fixture.home_goals.cmp(&fixture.away_goals) {
                std::cmp::Ordering::Greater => (3, 0),
                std::cmp::Ordering::Less => (0, 3),
                std::cmp::Ordering::Equal => (1, 1),
            };
            for (team, scored, conceded, points) in [
                (
                    fixture.home,
                    fixture.home_goals,
                    fixture.away_goals,
                    home_points,
                ),
                (
                    fixture.away,
                    fixture.away_goals,
                    fixture.home_goals,
                    away_points,
                ),
            ] {
                let Some(row) = rows.get_mut(team) else {
                    continue;
                };
                row.played += 1;
                row.goals_for += scored;
                row.goals_against += conceded;
                row.points += points;
                match points {
                    3 => row.wins += 1,
                    1 => row.draws += 1,
                    _ => row.losses += 1,
                }
            }
        }
        let mut table = rows.into_values().collect::<Vec<_>>();
        table.sort_by(|left, right| {
            right
                .points
                .cmp(&left.points)
                .then(
                    (right.goals_for - right.goals_against)
                        .cmp(&(left.goals_for - left.goals_against)),
                )
                .then(right.goals_for.cmp(&left.goals_for))
                .then_with(|| {
                    collation_key(&self.name(&left.team_id))
                        .cmp(&collation_key(&self.name(&right.team_id)))
                })
        });
        for (index, row) in table.iter_mut().enumerate() {
            row.rank = index as i32 + 1;
        }
        table
    }

    /// The team's played matches through `through`, in round order.
    fn results(&self, team_id: &str, through: i32) -> Vec<ResultRow> {
        let mut rows = self
            .played(through)
            .filter_map(|(round, fixture)| {
                let home = fixture.home == team_id;
                if !home && fixture.away != team_id {
                    return None;
                }
                let (scored, conceded, opponent) = if home {
                    (fixture.home_goals, fixture.away_goals, fixture.away)
                } else {
                    (fixture.away_goals, fixture.home_goals, fixture.home)
                };
                Some(ResultRow {
                    round,
                    outcome: outcome(scored, conceded).to_owned(),
                    score: format!("{scored}:{conceded}"),
                    opponent: self.short(opponent),
                    home,
                })
            })
            .collect::<Vec<_>>();
        rows.sort_by_key(|row| row.round);
        rows
    }

    fn player_totals(&self, through: i32) -> BTreeMap<&'a str, PlayerTotals> {
        let mut totals = BTreeMap::<&str, PlayerTotals>::new();
        for score in &self.season.scores {
            let Some(fixture) = self.matches.get(score.match_id.as_str()) else {
                continue;
            };
            let round = fixture.round;
            if round > through || !super::score_counts_as_appearance(score) {
                continue;
            }
            let opponent = if fixture.home_team_id == score.team_id {
                &fixture.away_team_id
            } else {
                &fixture.home_team_id
            };
            let entry = totals.entry(score.player_id.as_str()).or_default();
            entry.points += score.total_points;
            entry.goals += score.goals;
            entry.assists += score.assists;
            let grade = score.grade.filter(|grade| *grade > 0);
            if let Some(grade) = grade {
                entry.grade_total += grade;
                entry.graded += 1;
            }
            let line = entry.by_round.entry(round).or_default();
            line.points += score.total_points;
            line.goals += score.goals;
            line.assists += score.assists;
            line.grade = grade.or(line.grade);
            line.opponent = Some(self.short(opponent));
        }
        totals
    }

    fn vocabulary(&self, through: i32) -> Vocabulary {
        let mut teams = self
            .season
            .teams
            .iter()
            .map(|team| (team.id.clone(), vec![team.name.clone(), team.code.clone()]))
            .collect::<Vec<_>>();
        teams.sort();
        let players = self
            .player_totals(through)
            .into_keys()
            .filter_map(|id| self.players.get(id))
            .map(|player| {
                let mut names = vec![player.name.clone()];
                let last = last_name(&player.name);
                // Short surnames ("Can", "Kim") collide with ordinary words.
                if last != player.name && last.chars().count() >= 4 {
                    names.push(last.to_owned());
                }
                (player.id.clone(), names)
            })
            .collect();
        Vocabulary { teams, players }
    }

    fn candidates(&self, round: i32) -> Vec<Candidate> {
        let matches = self
            .played(round)
            .filter(|(match_round, _)| *match_round == round)
            .map(|(_, fixture)| fixture)
            .collect::<Vec<_>>();
        if matches.is_empty() {
            return Vec::new();
        }
        let table = self.table(round);
        let previous = (round > 1).then(|| self.table(round - 1));
        let totals = self.player_totals(round);
        let context = RoundContext {
            index: self,
            round,
            table,
            previous,
            totals,
            matches,
        };
        let mut candidates = Vec::new();
        candidates.extend(context.leader());
        candidates.extend(context.top_player());
        candidates.extend(context.round_goals());
        candidates.extend(context.round_top_player());
        candidates.extend(context.win_streak());
        candidates.extend(context.biggest_win());
        candidates.extend(context.most_goals());
        candidates.extend(context.rank_moves());
        candidates.extend(context.multi_goal());
        candidates.extend(context.unbeaten());
        candidates.extend(context.winless());
        candidates.extend(context.clean_sheets());
        for candidate in &mut candidates {
            self.attach_subjects(candidate);
        }
        candidates
    }
}

// ---------------------------------------------------------------- candidates

#[derive(Debug, Clone)]
enum Item {
    Card(Card),
    Fact(FactItem),
}

#[derive(Debug, Clone)]
struct Candidate {
    item: Item,
    /// Template ranking when no model is available; higher is more notable.
    score: i32,
    team_ids: Vec<String>,
    player_ids: Vec<String>,
}

impl Candidate {
    fn id(&self) -> &str {
        match &self.item {
            Item::Card(card) => &card.id,
            Item::Fact(fact) => &fact.id,
        }
    }

    /// Every string the generated text may draw numbers from.
    fn number_sources(&self) -> Vec<String> {
        let (facts, fields) = match &self.item {
            Item::Card(card) => (
                &card.facts,
                vec![
                    card.answer.clone(),
                    card.detail.clone(),
                    card.question.clone(),
                ],
            ),
            Item::Fact(fact) => (
                &fact.facts,
                vec![fact.value.clone(), fact.context.clone(), fact.text.clone()],
            ),
        };
        let mut sources = fields;
        for value in facts.values() {
            collect_strings(value, &mut sources);
        }
        sources
    }
}

struct FactMeta {
    id: &'static str,
    kind: Kind,
    title: &'static str,
    context: &'static str,
}

struct RoundContext<'s, 'a> {
    index: &'s SeasonIndex<'a>,
    round: i32,
    table: Vec<Row>,
    previous: Option<Vec<Row>>,
    totals: BTreeMap<&'a str, PlayerTotals>,
    matches: Vec<PlayedMatch<'a>>,
}

impl RoundContext<'_, '_> {
    fn team_facts(&self, team_id: &str) -> Value {
        json!({ "name": self.index.name(team_id), "short": self.index.short(team_id) })
    }

    fn row(&self, team_id: &str) -> Option<&Row> {
        self.table.iter().find(|row| row.team_id == team_id)
    }

    fn player(&self, player_id: &str) -> Option<&StaticPlayer> {
        self.index.players.get(player_id).copied()
    }

    fn recent_points(&self, player_id: &str) -> Visual {
        let first = self.round - RECENT_ROUNDS + 1;
        let rows = self
            .totals
            .get(player_id)
            .into_iter()
            .flat_map(|totals| totals.by_round.range(first..=self.round))
            .map(|(round, line)| PointsRow {
                round: *round,
                points: line.points,
                opponent: line.opponent.clone(),
            })
            .collect();
        Visual::RoundPoints {
            label: "Punkte je Spieltag".to_owned(),
            rows,
        }
    }

    fn recent_results(&self, team_id: &str) -> Visual {
        let mut rows = self.index.results(team_id, self.round);
        let skip = rows.len().saturating_sub(RECENT_ROUNDS as usize);
        rows.drain(..skip);
        Visual::Results {
            label: "Letzte Spiele".to_owned(),
            rows,
        }
    }

    fn leader(&self) -> Option<Candidate> {
        let leader = self.table.first().filter(|row| row.played > 0)?;
        let second = self.table.get(1)?;
        let share = percent(leader.points, leader.played * 3);
        let short = self.index.short(&leader.team_id);
        Some(Candidate {
            score: 60 + 2 * (leader.points - second.points),
            team_ids: vec![leader.team_id.clone(), second.team_id.clone()],
            player_ids: Vec::new(),
            item: Item::Card(Card {
                id: "leader".to_owned(),
                kind: Kind::Leader,
                title: "Spitze".to_owned(),
                category: "Tabelle".to_owned(),
                question: "Wer führt die Tabelle an?".to_owned(),
                answer: format!("{short} · {} Pkt", leader.points),
                detail_label: "Bilanz".to_owned(),
                detail: format!(
                    "{share} % · {} S / {} U / {} N",
                    leader.wins, leader.draws, leader.losses
                ),
                visual: self.recent_results(&leader.team_id),
                subject: None,
                source: Source::Template,
                rejected: None,
                facts: facts([
                    ("team", self.team_facts(&leader.team_id)),
                    ("points", json!(leader.points)),
                    ("played", json!(leader.played)),
                    ("wins", json!(leader.wins)),
                    ("draws", json!(leader.draws)),
                    ("losses", json!(leader.losses)),
                    ("pointShare", json!(share)),
                    ("second", self.team_facts(&second.team_id)),
                    ("leadOverSecond", json!(leader.points - second.points)),
                ]),
            }),
        })
    }

    fn best_player(&self, value: impl Fn(&PlayerTotals) -> i32) -> Option<(&str, &PlayerTotals)> {
        self.totals
            .iter()
            .filter(|(_, totals)| value(totals) > 0)
            .max_by(|left, right| {
                value(left.1)
                    .cmp(&value(right.1))
                    .then_with(|| right.0.cmp(left.0))
            })
            .map(|(id, totals)| (*id, totals))
    }

    fn top_player(&self) -> Option<Candidate> {
        let (player_id, totals) = self.best_player(|totals| totals.points)?;
        let player = self.player(player_id)?;
        let grade = (totals.graded > 0)
            .then(|| f64::from(totals.grade_total) / f64::from(totals.graded) / 100.0);
        Some(Candidate {
            score: 55,
            team_ids: vec![player.team_id.clone()],
            player_ids: vec![player.id.clone()],
            item: Item::Card(Card {
                id: "top-player".to_owned(),
                kind: Kind::TopPlayer,
                title: "Punkte".to_owned(),
                category: "Spieler".to_owned(),
                question: "Wer sammelt die meisten Punkte?".to_owned(),
                answer: format!("{} · {}", last_name(&player.name), totals.points),
                detail_label: "Ø-Note".to_owned(),
                detail: format!(
                    "{} · {} Tore · {} Vorl.",
                    grade.map_or_else(|| "–".to_owned(), |grade| decimal(grade, 2)),
                    totals.goals,
                    totals.assists
                ),
                visual: self.recent_points(player_id),
                subject: None,
                source: Source::Template,
                rejected: None,
                facts: facts([
                    (
                        "player",
                        json!({ "name": player.name, "short": last_name(&player.name) }),
                    ),
                    ("team", self.team_facts(&player.team_id)),
                    ("points", json!(totals.points)),
                    (
                        "averageGrade",
                        grade.map_or(Value::Null, |grade| json!(decimal(grade, 2))),
                    ),
                    ("goals", json!(totals.goals)),
                    ("assists", json!(totals.assists)),
                ]),
            }),
        })
    }

    fn round_goals(&self) -> Option<Candidate> {
        let mut ordered = self.matches.iter().collect::<Vec<_>>();
        ordered.sort_by_key(|fixture| (fixture.scheduled_at, fixture.id));
        let goals = ordered
            .iter()
            .map(|fixture| fixture.home_goals + fixture.away_goals)
            .sum::<i32>();
        let outcomes = ordered
            .iter()
            .map(
                |fixture| match fixture.home_goals.cmp(&fixture.away_goals) {
                    std::cmp::Ordering::Greater => "H",
                    std::cmp::Ordering::Less => "A",
                    std::cmp::Ordering::Equal => "U",
                },
            )
            .collect::<Vec<_>>();
        let count = |value: &str| outcomes.iter().filter(|outcome| **outcome == value).count();
        let per_match = f64::from(goals) / ordered.len() as f64;
        let per_match_text = decimal(per_match, 1);
        Some(Candidate {
            score: 40 + if per_match >= 3.5 { 15 } else { 0 },
            team_ids: Vec::new(),
            player_ids: Vec::new(),
            item: Item::Card(Card {
                id: "round-goals".to_owned(),
                kind: Kind::RoundGoals,
                title: "Tore".to_owned(),
                category: "Spieltag".to_owned(),
                question: "Wie torreich war der Spieltag?".to_owned(),
                answer: format!("{goals} · Ø {per_match_text}"),
                detail_label: "Heim / Remis / Auswärts".to_owned(),
                detail: format!("{} / {} / {}", count("H"), count("U"), count("A")),
                visual: Visual::Outcomes {
                    label: "Ausgang je Spiel".to_owned(),
                    values: outcomes
                        .iter()
                        .map(|outcome| (*outcome).to_owned())
                        .collect(),
                },
                subject: None,
                source: Source::Template,
                rejected: None,
                facts: facts([
                    ("round", json!(self.round)),
                    ("goals", json!(goals)),
                    ("matches", json!(ordered.len())),
                    ("goalsPerMatch", json!(per_match_text)),
                    ("homeWins", json!(count("H"))),
                    ("draws", json!(count("U"))),
                    ("awayWins", json!(count("A"))),
                ]),
            }),
        })
    }

    fn round_top_player(&self) -> Option<Candidate> {
        let round = self.round;
        let line = |totals: &PlayerTotals| totals.by_round.get(&round).cloned().unwrap_or_default();
        let (player_id, totals) = self.best_player(|totals| line(totals).points)?;
        let player = self.player(player_id)?;
        let this_round = line(totals);
        let grade = this_round
            .grade
            .map(|grade| decimal(f64::from(grade) / 100.0, 2));
        let season_leader = self.best_player(|totals| totals.points).map(|(id, _)| id);
        Some(Candidate {
            score: 50
                - if season_leader == Some(player_id) {
                    15
                } else {
                    0
                },
            team_ids: vec![player.team_id.clone()],
            player_ids: vec![player.id.clone()],
            item: Item::Card(Card {
                id: "round-top-player".to_owned(),
                kind: Kind::RoundTopPlayer,
                title: "Bester".to_owned(),
                category: format!("Spieltag {round}"),
                question: format!("Wer punktete an Spieltag {round} am besten?"),
                answer: format!("{} · {}", last_name(&player.name), this_round.points),
                detail_label: format!("Spieltag {round}"),
                detail: format!(
                    "{} Tore · {} Vorl. · Note {}",
                    this_round.goals,
                    this_round.assists,
                    grade.clone().unwrap_or_else(|| "–".to_owned())
                ),
                visual: self.recent_points(player_id),
                subject: None,
                source: Source::Template,
                rejected: None,
                facts: facts([
                    ("round", json!(round)),
                    (
                        "player",
                        json!({ "name": player.name, "short": last_name(&player.name) }),
                    ),
                    ("team", self.team_facts(&player.team_id)),
                    ("points", json!(this_round.points)),
                    ("goals", json!(this_round.goals)),
                    ("assists", json!(this_round.assists)),
                    ("grade", grade.map_or(Value::Null, Value::String)),
                ]),
            }),
        })
    }

    fn win_streak(&self) -> Option<Candidate> {
        let (row, streak) = self
            .table
            .iter()
            .map(|row| {
                let results = self.index.results(&row.team_id, self.round);
                let streak = results
                    .iter()
                    .rev()
                    .take_while(|result| result.outcome == "S")
                    .count();
                (row, streak as i32)
            })
            .filter(|(_, streak)| *streak >= 3)
            .max_by(|left, right| left.1.cmp(&right.1).then(right.0.rank.cmp(&left.0.rank)))?;
        let short = self.index.short(&row.team_id);
        Some(Candidate {
            score: 35 + 5 * streak - if row.rank == 1 { 20 } else { 0 },
            team_ids: vec![row.team_id.clone()],
            player_ids: Vec::new(),
            item: Item::Card(Card {
                id: "win-streak".to_owned(),
                kind: Kind::WinStreak,
                title: "Serie".to_owned(),
                category: "Form".to_owned(),
                question: "Wer hat die längste Siegesserie?".to_owned(),
                answer: format!("{short} · {streak} Siege"),
                detail_label: "Platz".to_owned(),
                detail: format!("{} · {} Pkt", row.rank, row.points),
                visual: self.recent_results(&row.team_id),
                subject: None,
                source: Source::Template,
                rejected: None,
                facts: facts([
                    ("team", self.team_facts(&row.team_id)),
                    ("wins", json!(streak)),
                    ("rank", json!(row.rank)),
                    ("points", json!(row.points)),
                ]),
            }),
        })
    }

    fn result_sentence(&self, fixture: &PlayedMatch) -> String {
        let (home, away) = (
            self.index.short(fixture.home),
            self.index.short(fixture.away),
        );
        let (h, a) = (fixture.home_goals, fixture.away_goals);
        match h.cmp(&a) {
            std::cmp::Ordering::Greater => format!("{home} gewinnt {h}:{a} gegen {away}."),
            std::cmp::Ordering::Less => format!("{away} gewinnt {a}:{h} bei {home}."),
            std::cmp::Ordering::Equal => format!("{home} und {away} trennen sich {h}:{a}."),
        }
    }

    fn match_facts(&self, fixture: &PlayedMatch) -> BTreeMap<String, Value> {
        let rank = |team: &str| self.row(team).map_or(Value::Null, |row| json!(row.rank));
        facts([
            ("home", self.team_facts(fixture.home)),
            ("away", self.team_facts(fixture.away)),
            ("homeGoals", json!(fixture.home_goals)),
            ("awayGoals", json!(fixture.away_goals)),
            ("homeRankAfter", rank(fixture.home)),
            ("awayRankAfter", rank(fixture.away)),
        ])
    }

    fn match_fact(
        &self,
        fixture: &PlayedMatch,
        id: &str,
        kind: Kind,
        title: &str,
        score: i32,
        text: String,
    ) -> Candidate {
        Candidate {
            score,
            team_ids: vec![fixture.home.to_owned(), fixture.away.to_owned()],
            player_ids: Vec::new(),
            item: Item::Fact(FactItem {
                id: id.to_owned(),
                kind,
                title: title.to_owned(),
                value: format!("{}:{}", fixture.home_goals, fixture.away_goals),
                context: format!(
                    "{} – {}",
                    self.index.short(fixture.home),
                    self.index.short(fixture.away)
                ),
                tone: String::new(),
                text,
                subjects: Vec::new(),
                source: Source::Template,
                rejected: None,
                facts: self.match_facts(fixture),
            }),
        }
    }

    fn biggest_win_match(&self) -> Option<&PlayedMatch<'_>> {
        self.matches
            .iter()
            .filter(|fixture| (fixture.home_goals - fixture.away_goals).abs() >= 2)
            .max_by_key(|fixture| {
                (
                    (fixture.home_goals - fixture.away_goals).abs(),
                    fixture.home_goals + fixture.away_goals,
                    std::cmp::Reverse(fixture.id),
                )
            })
    }

    fn biggest_win(&self) -> Option<Candidate> {
        let fixture = self.biggest_win_match()?;
        let loser = if fixture.home_goals > fixture.away_goals {
            fixture.away
        } else {
            fixture.home
        };
        let mut text = self.result_sentence(fixture);
        if let Some(row) = self.row(loser) {
            text.push_str(&format!(
                " {} steht danach auf Platz {}.",
                self.index.short(loser),
                row.rank
            ));
        }
        let margin = (fixture.home_goals - fixture.away_goals).abs();
        Some(self.match_fact(
            fixture,
            "biggest-win",
            Kind::BiggestWin,
            "Höchster Sieg",
            30 + 5 * margin,
            text,
        ))
    }

    fn most_goals(&self) -> Option<Candidate> {
        let excluded = self.biggest_win_match().map(|fixture| fixture.id);
        let fixture = self
            .matches
            .iter()
            .filter(|fixture| {
                Some(fixture.id) != excluded && fixture.home_goals + fixture.away_goals >= 4
            })
            .max_by_key(|fixture| {
                (
                    fixture.home_goals + fixture.away_goals,
                    std::cmp::Reverse(fixture.id),
                )
            })?;
        let total = fixture.home_goals + fixture.away_goals;
        let text = format!(
            "{} {total} Tore in einem Spiel.",
            self.result_sentence(fixture)
        );
        let mut candidate = self.match_fact(
            fixture,
            "most-goals",
            Kind::MostGoals,
            "Torreichstes Spiel",
            20 + 4 * total,
            text,
        );
        if let Item::Fact(fact) = &mut candidate.item {
            fact.facts.insert("goals".to_owned(), json!(total));
        }
        Some(candidate)
    }

    fn rank_moves(&self) -> Vec<Candidate> {
        let Some(previous) = &self.previous else {
            return Vec::new();
        };
        let before = previous
            .iter()
            .map(|row| (row.team_id.as_str(), row.rank))
            .collect::<HashMap<_, _>>();
        let moves = self
            .table
            .iter()
            .filter_map(|row| Some((row, before.get(row.team_id.as_str())? - row.rank)))
            .collect::<Vec<_>>();
        let mut candidates = Vec::new();
        for (up, id, kind, title) in [
            (true, "biggest-climb", Kind::BiggestClimb, "Größter Sprung"),
            (false, "biggest-fall", Kind::BiggestFall, "Größter Absturz"),
        ] {
            let signed = |delta: i32| if up { delta } else { -delta };
            let Some(best) = moves
                .iter()
                .map(|(_, delta)| signed(*delta))
                .filter(|delta| *delta >= 2)
                .max()
            else {
                continue;
            };
            let teams = moves
                .iter()
                .filter(|(_, delta)| signed(*delta) == best)
                .take(2)
                .map(|(row, _)| *row)
                .collect::<Vec<_>>();
            let shorts = teams
                .iter()
                .map(|row| self.index.short(&row.team_id))
                .collect::<Vec<_>>();
            let verb = match (up, teams.len()) {
                (true, 1) => "klettert",
                (true, _) => "klettern",
                (false, 1) => "fällt",
                (false, _) => "fallen",
            };
            let text = if let [row] = teams.as_slice() {
                format!(
                    "{} {verb} von Platz {} auf Platz {}.",
                    shorts[0],
                    before[row.team_id.as_str()],
                    row.rank
                )
            } else {
                format!("{} {verb} um je {best} Plätze.", join_de(&shorts))
            };
            candidates.push(Candidate {
                score: 20 + 4 * best,
                team_ids: teams.iter().map(|row| row.team_id.clone()).collect(),
                player_ids: Vec::new(),
                item: Item::Fact(FactItem {
                    id: id.to_owned(),
                    kind,
                    title: title.to_owned(),
                    value: format!("{}{best}", if up { "▲" } else { "▼" }),
                    context: shorts.join(" · "),
                    tone: if up { "up" } else { "down" }.to_owned(),
                    text,
                    subjects: Vec::new(),
                    source: Source::Template,
                    rejected: None,
                    facts: facts([
                        ("places", json!(best)),
                        (
                            "teams",
                            Value::Array(
                                teams
                                    .iter()
                                    .map(|row| {
                                        let mut team = self.team_facts(&row.team_id);
                                        team["rankBefore"] = json!(before[row.team_id.as_str()]);
                                        team["rankAfter"] = json!(row.rank);
                                        team
                                    })
                                    .collect(),
                            ),
                        ),
                    ]),
                }),
            });
        }
        candidates
    }

    fn multi_goal(&self) -> Option<Candidate> {
        let round = self.round;
        let goals =
            |totals: &PlayerTotals| totals.by_round.get(&round).map_or(0, |line| line.goals);
        let best = self
            .totals
            .values()
            .map(goals)
            .max()
            .filter(|best| *best >= 2)?;
        let scorers = self
            .totals
            .iter()
            .filter(|(_, totals)| goals(totals) == best)
            .filter_map(|(id, _)| self.player(id))
            .take(2)
            .collect::<Vec<_>>();
        let names = scorers
            .iter()
            .map(|player| last_name(&player.name).to_owned())
            .collect::<Vec<_>>();
        let text = if let [player] = scorers.as_slice() {
            format!(
                "{} trifft {best}-mal für {}.",
                player.name,
                self.index.short(&player.team_id)
            )
        } else {
            format!(
                "{} treffen je {best}-mal.",
                join_de(
                    &scorers
                        .iter()
                        .map(|player| player.name.clone())
                        .collect::<Vec<_>>()
                )
            )
        };
        Some(Candidate {
            score: 25 + 8 * best,
            team_ids: scorers.iter().map(|player| player.team_id.clone()).collect(),
            player_ids: scorers.iter().map(|player| player.id.clone()).collect(),
            item: Item::Fact(FactItem {
                id: "multi-goal".to_owned(),
                kind: Kind::MultiGoal,
                title: match best {
                    2 => "Doppelpack".to_owned(),
                    3 => "Dreierpack".to_owned(),
                    _ => format!("{best} Tore"),
                },
                value: best.to_string(),
                context: names.join(" · "),
                tone: String::new(),
                text,
                subjects: Vec::new(),
                source: Source::Template,
                rejected: None,
                facts: facts([
                    ("goals", json!(best)),
                    (
                        "players",
                        Value::Array(
                            scorers
                                .iter()
                                .map(|player| json!({ "name": player.name, "short": last_name(&player.name), "team": self.team_facts(&player.team_id) }))
                                .collect(),
                        ),
                    ),
                ]),
            }),
        })
    }

    fn team_list_fact(
        &self,
        rows: Vec<&Row>,
        meta: FactMeta,
        score: i32,
        text: String,
    ) -> Candidate {
        Candidate {
            score,
            team_ids: rows.iter().map(|row| row.team_id.clone()).collect(),
            player_ids: Vec::new(),
            item: Item::Fact(FactItem {
                id: meta.id.to_owned(),
                kind: meta.kind,
                title: meta.title.to_owned(),
                value: rows.len().to_string(),
                context: meta.context.to_owned(),
                tone: String::new(),
                text,
                subjects: Vec::new(),
                source: Source::Template,
                rejected: None,
                facts: facts([
                    ("round", json!(self.round)),
                    ("count", json!(rows.len())),
                    (
                        "teams",
                        Value::Array(
                            rows.iter()
                                .map(|row| self.team_facts(&row.team_id))
                                .collect(),
                        ),
                    ),
                ]),
            }),
        }
    }

    fn unbeaten(&self) -> Option<Candidate> {
        if self.round < 3 {
            return None;
        }
        let rows = self
            .table
            .iter()
            .filter(|row| row.played > 0 && row.losses == 0)
            .collect::<Vec<_>>();
        if rows.is_empty() || rows.len() > 3 {
            return None;
        }
        let shorts = rows
            .iter()
            .map(|row| self.index.short(&row.team_id))
            .collect::<Vec<_>>();
        let text = if rows.len() == 1 {
            format!("{} ist als einziges Team ohne Niederlage.", shorts[0])
        } else {
            format!(
                "{} Teams sind noch ohne Niederlage: {}.",
                rows.len(),
                join_de(&shorts)
            )
        };
        let score = if rows.len() == 1 { 25 } else { 15 };
        Some(self.team_list_fact(
            rows,
            FactMeta {
                id: "unbeaten",
                kind: Kind::Unbeaten,
                title: "Ungeschlagen",
                context: "ohne Niederlage",
            },
            score,
            text,
        ))
    }

    fn winless(&self) -> Option<Candidate> {
        if self.round < 4 {
            return None;
        }
        let rows = self
            .table
            .iter()
            .filter(|row| row.played > 0 && row.wins == 0)
            .collect::<Vec<_>>();
        if rows.is_empty() || rows.len() > 3 {
            return None;
        }
        let shorts = rows
            .iter()
            .map(|row| self.index.short(&row.team_id))
            .collect::<Vec<_>>();
        let round = self.round;
        let text = if rows.len() == 1 {
            format!(
                "{} wartet nach {round} Spieltagen auf den ersten Sieg.",
                shorts[0]
            )
        } else {
            format!(
                "{} warten nach {round} Spieltagen auf den ersten Sieg.",
                join_de(&shorts)
            )
        };
        Some(self.team_list_fact(
            rows,
            FactMeta {
                id: "winless",
                kind: Kind::Winless,
                title: "Ohne Sieg",
                context: "ohne Sieg",
            },
            20,
            text,
        ))
    }

    fn clean_sheets(&self) -> Option<Candidate> {
        let count = self
            .matches
            .iter()
            .map(|fixture| i32::from(fixture.home_goals == 0) + i32::from(fixture.away_goals == 0))
            .sum::<i32>();
        if count == 0 {
            return None;
        }
        Some(Candidate {
            score: 10 + count,
            team_ids: Vec::new(),
            player_ids: Vec::new(),
            item: Item::Fact(FactItem {
                id: "clean-sheets".to_owned(),
                kind: Kind::CleanSheets,
                title: "Zu null".to_owned(),
                value: count.to_string(),
                context: format!("in {} Spielen", self.matches.len()),
                tone: String::new(),
                text: format!("{count}-mal blieb ein Team an diesem Spieltag ohne Gegentor."),
                subjects: Vec::new(),
                source: Source::Template,
                rejected: None,
                facts: facts([
                    ("cleanSheets", json!(count)),
                    ("matches", json!(self.matches.len())),
                ]),
            }),
        })
    }
}

fn template_round(round: i32, facts_hash: String, candidates: &[Candidate]) -> RoundInsights {
    let ranked = |cards: bool| {
        let mut list = candidates
            .iter()
            .filter(|candidate| matches!(candidate.item, Item::Card(_)) == cards)
            .collect::<Vec<_>>();
        list.sort_by(|left, right| {
            right
                .score
                .cmp(&left.score)
                .then_with(|| left.id().cmp(right.id()))
        });
        list
    };
    RoundInsights {
        round,
        facts_hash,
        generated_at: Utc::now().to_rfc3339(),
        model: None,
        model_attempts: 0,
        cards: ranked(true)
            .into_iter()
            .take(CARD_COUNT)
            .filter_map(|candidate| as_card(candidate).cloned())
            .collect(),
        facts: ranked(false)
            .into_iter()
            .take(FACT_COUNT)
            .filter_map(|candidate| as_fact(candidate).cloned())
            .collect(),
    }
}

fn as_card(candidate: &Candidate) -> Option<&Card> {
    match &candidate.item {
        Item::Card(card) => Some(card),
        Item::Fact(_) => None,
    }
}

fn as_fact(candidate: &Candidate) -> Option<&FactItem> {
    match &candidate.item {
        Item::Fact(fact) => Some(fact),
        Item::Card(_) => None,
    }
}

/// FNV-1a over the serialized candidates. `DefaultHasher` is not stable across
/// Rust releases, and this hash is persisted as a cache key.
fn facts_hash(candidates: &[Candidate]) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325 ^ u64::from(PROMPT_VERSION);
    for candidate in candidates {
        let bytes = match &candidate.item {
            Item::Card(card) => serde_json::to_vec(card),
            Item::Fact(fact) => serde_json::to_vec(fact),
        }
        .unwrap_or_default();
        for byte in bytes {
            hash ^= u64::from(byte);
            hash = hash.wrapping_mul(0x0100_0000_01b3);
        }
    }
    format!("{hash:016x}")
}

// ---------------------------------------------------------------- model

#[derive(Debug, Clone, PartialEq, Deserialize)]
struct ModelOutput {
    cards: Vec<ModelCard>,
    facts: Vec<ModelFact>,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
struct ModelCard {
    id: String,
    question: String,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
struct ModelFact {
    id: String,
    text: String,
}

#[derive(Debug)]
enum ModelError {
    /// Network, rate limit or server error: retried on the next run for free.
    Transient(String),
    /// The model answered but the answer is unusable; counts as an attempt.
    Rejected(String),
}

impl fmt::Display for ModelError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Transient(reason) | Self::Rejected(reason) => formatter.write_str(reason),
        }
    }
}

#[derive(Debug, Deserialize)]
struct MessagesResponse {
    stop_reason: Option<String>,
    #[serde(default)]
    content: Vec<ContentBlock>,
}

#[derive(Debug, Deserialize)]
struct ContentBlock {
    #[serde(rename = "type")]
    kind: String,
    #[serde(default)]
    text: Option<String>,
}

fn output_schema() -> Value {
    let item = |text_field: &str| {
        json!({
            "type": "object",
            "additionalProperties": false,
            "required": ["id", text_field],
            "properties": { "id": { "type": "string" }, text_field: { "type": "string" } }
        })
    };
    json!({
        "type": "object",
        "additionalProperties": false,
        "required": ["cards", "facts"],
        "properties": {
            "cards": { "type": "array", "items": item("question") },
            "facts": { "type": "array", "items": item("text") }
        }
    })
}

fn model_payload(season: &StaticSeason, round: i32, candidates: &[Candidate]) -> Value {
    let cards = candidates.iter().filter_map(as_card).collect::<Vec<_>>();
    let facts = candidates.iter().filter_map(as_fact).collect::<Vec<_>>();
    json!({
        "league": season.league_name,
        "season": season.display_name,
        "round": round,
        "roundCount": season.round_count,
        "chooseCards": CARD_COUNT.min(cards.len()),
        "chooseFacts": FACT_COUNT.min(facts.len()),
        "cards": cards.iter().map(|card| json!({
            "id": card.id, "kind": card.kind, "answer": card.answer, "detailLabel": card.detail_label,
            "detail": card.detail, "facts": card.facts, "templateQuestion": card.question,
        })).collect::<Vec<_>>(),
        "facts": facts.iter().map(|fact| json!({
            "id": fact.id, "kind": fact.kind, "title": fact.title, "value": fact.value,
            "context": fact.context, "facts": fact.facts, "templateText": fact.text,
        })).collect::<Vec<_>>(),
    })
}

async fn request_model(
    client: &Client,
    config: &InsightsConfig,
    payload: &Value,
) -> Result<ModelOutput, ModelError> {
    let api_key = config
        .api_key
        .as_deref()
        .ok_or_else(|| ModelError::Transient("kein API-Schlüssel".to_owned()))?;
    let body = json!({
        "model": config.model,
        // Thinking is always on for current Opus models; low effort keeps it short.
        "max_tokens": 8000,
        "output_config": {
            "effort": config.effort,
            "format": { "type": "json_schema", "schema": output_schema() }
        },
        // A safety decline is re-run server-side on Anthropic's recommended fallback.
        "fallbacks": "default",
        "system": SYSTEM_PROMPT,
        "messages": [{ "role": "user", "content": payload.to_string() }]
    });
    let response = client
        .post(MESSAGES_URL)
        .timeout(REQUEST_TIMEOUT)
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .header("anthropic-beta", "server-side-fallback-2026-07-01")
        .json(&body)
        .send()
        .await
        .map_err(|error| ModelError::Transient(format!("Anfrage fehlgeschlagen: {error}")))?;
    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|error| ModelError::Transient(format!("Antwort nicht lesbar: {error}")))?;
    if !status.is_success() {
        let detail = text.chars().take(300).collect::<String>();
        let retryable = status == StatusCode::TOO_MANY_REQUESTS
            || status == StatusCode::REQUEST_TIMEOUT
            || status.is_server_error()
            || status.as_u16() == 529;
        let message = format!("HTTP {status}: {detail}");
        return Err(if retryable {
            ModelError::Transient(message)
        } else {
            ModelError::Rejected(message)
        });
    }
    parse_response(&text)
}

fn parse_response(text: &str) -> Result<ModelOutput, ModelError> {
    let response = serde_json::from_str::<MessagesResponse>(text)
        .map_err(|error| ModelError::Rejected(format!("unerwartetes Antwortformat: {error}")))?;
    match response.stop_reason.as_deref() {
        Some("end_turn") | None => {}
        Some(reason) => return Err(ModelError::Rejected(format!("stop_reason {reason}"))),
    }
    let json_text = response
        .content
        .iter()
        .find(|block| block.kind == "text")
        .and_then(|block| block.text.as_deref())
        .ok_or_else(|| ModelError::Rejected("keine Textausgabe".to_owned()))?;
    serde_json::from_str(json_text)
        .map_err(|error| ModelError::Rejected(format!("JSON ungültig: {error}")))
}

/// Takes the model's choice and texts where they validate; everything else
/// falls back to the template ranking and template text.
fn apply_model(
    previous: &RoundInsights,
    candidates: &[Candidate],
    output: &ModelOutput,
    vocabulary: &Vocabulary,
    config: &InsightsConfig,
) -> RoundInsights {
    let by_id = candidates
        .iter()
        .map(|candidate| (candidate.id(), candidate))
        .collect::<HashMap<_, _>>();
    let template = template_round(previous.round, previous.facts_hash.clone(), candidates);

    let pick =
        |chosen: Vec<(&str, &str)>, template_ids: Vec<&str>, want_card: bool, limit: usize| {
            let mut seen = HashSet::new();
            let mut picked = chosen
                .into_iter()
                .filter(|(id, _)| {
                    by_id.get(id).is_some_and(|candidate| {
                        matches!(candidate.item, Item::Card(_)) == want_card
                    })
                })
                .filter(|(id, _)| seen.insert(id.to_string()))
                .map(|(id, text)| (id.to_owned(), Some(text.to_owned())))
                .take(limit)
                .collect::<Vec<_>>();
            for id in template_ids {
                if picked.len() >= limit {
                    break;
                }
                if seen.insert(id.to_owned()) {
                    picked.push((id.to_owned(), None));
                }
            }
            picked
        };

    let cards = pick(
        output
            .cards
            .iter()
            .map(|card| (card.id.as_str(), card.question.as_str()))
            .collect(),
        template.cards.iter().map(|card| card.id.as_str()).collect(),
        true,
        CARD_COUNT,
    )
    .into_iter()
    .filter_map(|(id, text)| {
        let candidate = by_id.get(id.as_str())?;
        let mut card = as_card(candidate)?.clone();
        if let Some(text) = text {
            match validate_text(&text, candidate, vocabulary, MAX_QUESTION_CHARS) {
                Ok(()) => {
                    card.question = text.trim().to_owned();
                    card.source = Source::Model;
                }
                Err(reason) => card.rejected = Some(reason),
            }
        }
        Some(card)
    })
    .collect();

    let facts = pick(
        output
            .facts
            .iter()
            .map(|fact| (fact.id.as_str(), fact.text.as_str()))
            .collect(),
        template.facts.iter().map(|fact| fact.id.as_str()).collect(),
        false,
        FACT_COUNT,
    )
    .into_iter()
    .filter_map(|(id, text)| {
        let candidate = by_id.get(id.as_str())?;
        let mut fact = as_fact(candidate)?.clone();
        if let Some(text) = text {
            match validate_text(&text, candidate, vocabulary, MAX_TEXT_CHARS) {
                Ok(()) => {
                    fact.text = text.trim().to_owned();
                    fact.source = Source::Model;
                }
                Err(reason) => fact.rejected = Some(reason),
            }
        }
        Some(fact)
    })
    .collect();

    RoundInsights {
        round: previous.round,
        facts_hash: previous.facts_hash.clone(),
        generated_at: Utc::now().to_rfc3339(),
        model: Some(config.model.clone()),
        model_attempts: previous.model_attempts + 1,
        cards,
        facts,
    }
}

// ---------------------------------------------------------------- validation

struct Vocabulary {
    /// (id, names) for every team of the season.
    teams: Vec<(String, Vec<String>)>,
    /// (id, names) for every player with a scored appearance so far.
    players: Vec<(String, Vec<String>)>,
}

// Number words that would bypass the digit check. "null" and "elf" are left
// out on purpose: "zu null" and "die Elf" are ordinary football phrases.
const NUMBER_WORDS: &[&str] = &[
    "zwei", "drei", "vier", "fünf", "sechs", "sieben", "acht", "neun", "zehn", "zwölf", "zweimal",
    "dreimal", "viermal", "fünfmal", "doppelt", "dreifach",
];

fn validate_text(
    text: &str,
    candidate: &Candidate,
    vocabulary: &Vocabulary,
    max_chars: usize,
) -> Result<(), String> {
    let text = text.trim();
    if text.is_empty() {
        return Err("leerer Text".to_owned());
    }
    if text.chars().count() > max_chars {
        return Err(format!("länger als {max_chars} Zeichen"));
    }
    if let Some(character) = text.chars().find(|character| {
        matches!(
            character,
            '\n' | '*'
                | '#'
                | '`'
                | '<'
                | '>'
                | '['
                | ']'
                | '{'
                | '}'
                | '|'
                | '_'
                | '!'
                | '"'
                | '„'
                | '“'
        )
    }) {
        return Err(format!("unzulässiges Zeichen {character:?}"));
    }

    let mut stripped = text.to_owned();
    let mut all_names = Vec::new();
    for (allowed, entries) in [
        (&candidate.team_ids, &vocabulary.teams),
        (&candidate.player_ids, &vocabulary.players),
    ] {
        for (id, names) in entries {
            for name in names {
                if contains_word(text, name) && !allowed.contains(id) {
                    return Err(format!("nennt {name}, nicht in den Fakten"));
                }
                all_names.push(name.as_str());
            }
        }
    }
    // Remove names before reading numbers, so "Schalke 04" or "Mainz 05" do not count.
    all_names.sort_by_key(|name| std::cmp::Reverse(name.len()));
    for name in all_names {
        stripped = stripped.replace(name, " ");
    }

    let allowed = candidate
        .number_sources()
        .iter()
        .flat_map(|source| numbers(source))
        .collect::<HashSet<_>>();
    for number in numbers(&stripped) {
        if !allowed.contains(&number) {
            return Err(format!("Zahl {} nicht in den Fakten", number_label(number)));
        }
    }
    for word in stripped.split(|character: char| !character.is_alphabetic()) {
        if NUMBER_WORDS.contains(&word.to_lowercase().as_str()) {
            return Err(format!("Zahlwort {word} statt Ziffern"));
        }
    }
    Ok(())
}

/// Numbers in hundredths, so "3,7", "3.7" and "3,70" compare equal.
fn numbers(text: &str) -> Vec<i64> {
    let characters = text.chars().collect::<Vec<_>>();
    let mut found = Vec::new();
    let mut index = 0;
    while index < characters.len() {
        if !characters[index].is_ascii_digit() {
            index += 1;
            continue;
        }
        let start = index;
        while index < characters.len() && characters[index].is_ascii_digit() {
            index += 1;
        }
        // A decimal separator only counts when digits follow ("3,7"), not at a
        // sentence end ("Platz 4.") or in a list ("4, 5").
        if index + 1 < characters.len()
            && matches!(characters[index], ',' | '.')
            && characters[index + 1].is_ascii_digit()
        {
            index += 1;
            while index < characters.len() && characters[index].is_ascii_digit() {
                index += 1;
            }
        }
        let token = characters[start..index]
            .iter()
            .collect::<String>()
            .replace(',', ".");
        if let Ok(value) = token.parse::<f64>() {
            found.push((value * 100.0).round() as i64);
        }
    }
    found
}

fn number_label(hundredths: i64) -> String {
    if hundredths % 100 == 0 {
        (hundredths / 100).to_string()
    } else {
        decimal(hundredths as f64 / 100.0, 2)
    }
}

fn contains_word(text: &str, word: &str) -> bool {
    if word.is_empty() {
        return false;
    }
    text.match_indices(word).any(|(start, matched)| {
        let before = text[..start].chars().next_back();
        let after = text[start + matched.len()..].chars().next();
        !before.is_some_and(char::is_alphanumeric) && !after.is_some_and(char::is_alphanumeric)
    })
}

// ---------------------------------------------------------------- helpers

fn facts<const N: usize>(entries: [(&str, Value); N]) -> BTreeMap<String, Value> {
    entries
        .into_iter()
        .map(|(key, value)| (key.to_owned(), value))
        .collect()
}

fn collect_strings(value: &Value, out: &mut Vec<String>) {
    match value {
        Value::Number(number) => out.push(number.to_string()),
        Value::String(text) => out.push(text.clone()),
        Value::Array(items) => items.iter().for_each(|item| collect_strings(item, out)),
        Value::Object(map) => map.values().for_each(|item| collect_strings(item, out)),
        Value::Null | Value::Bool(_) => {}
    }
}

fn outcome(scored: i32, conceded: i32) -> &'static str {
    match scored.cmp(&conceded) {
        std::cmp::Ordering::Greater => "S",
        std::cmp::Ordering::Less => "N",
        std::cmp::Ordering::Equal => "U",
    }
}

fn percent(part: i32, whole: i32) -> i32 {
    if whole == 0 {
        0
    } else {
        (f64::from(part) * 100.0 / f64::from(whole)).round() as i32
    }
}

fn decimal(value: f64, places: usize) -> String {
    format!("{value:.places$}").replace('.', ",")
}

fn last_name(name: &str) -> &str {
    name.split_whitespace().next_back().unwrap_or(name)
}

fn join_de(items: &[String]) -> String {
    match items {
        [] => String::new(),
        [single] => single.clone(),
        [rest @ .., last] => format!("{} und {last}", rest.join(", ")),
    }
}

/// Approximates `localeCompare(…, "de")` for the tie-break on team names.
fn collation_key(name: &str) -> String {
    name.to_lowercase()
        .replace('ä', "a")
        .replace('ö', "o")
        .replace('ü', "u")
        .replace('ß', "ss")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{StaticRound, StaticScore};

    fn team(id: &str, name: &str, code: &str) -> StaticTeam {
        StaticTeam {
            id: id.to_owned(),
            name: name.to_owned(),
            code: code.to_owned(),
            logo_url: None,
        }
    }

    fn player(id: &str, name: &str, team_id: &str) -> StaticPlayer {
        StaticPlayer {
            id: id.to_owned(),
            name: name.to_owned(),
            team_id: team_id.to_owned(),
            position: "FWD".to_owned(),
            price_m: 1.0,
            active: true,
            selectable: true,
            photo_url: None,
        }
    }

    fn fixture(id: &str, round: i32, home: &str, away: &str, score: (i32, i32)) -> StaticMatch {
        StaticMatch {
            id: id.to_owned(),
            round,
            home_team_id: home.to_owned(),
            away_team_id: away.to_owned(),
            scheduled_at: Some(format!("2026-09-{:02}T15:30:00+00:00", round + 10)),
            state: "FINISHED".to_owned(),
            home_score: Some(score.0),
            away_score: Some(score.1),
        }
    }

    fn score(
        match_id: &str,
        player_id: &str,
        team_id: &str,
        points: i32,
        goals: i32,
        grade: i32,
    ) -> StaticScore {
        StaticScore {
            match_id: match_id.to_owned(),
            player_id: player_id.to_owned(),
            team_id: team_id.to_owned(),
            total_points: points,
            grade: Some(grade),
            goals,
            assists: 0,
            points_clean_sheet: 0,
            points_grade: 0,
            points_goals: 0,
            points_cards: 0,
            points_assists: 0,
            points_starter: 2,
            points_mvp: 0,
            points_joker: 0,
        }
    }

    // Four teams, three rounds. After round 3: Bayern 9, Mainz 4, Schalke 04 3, Köln 1.
    fn season() -> StaticSeason {
        StaticSeason {
            schema_version: crate::SCHEMA_VERSION,
            generated_at: String::new(),
            id: "se-k00012026".to_owned(),
            league_code: "0001".to_owned(),
            league_name: "Bundesliga".to_owned(),
            start_year: 2026,
            display_name: "2026/27".to_owned(),
            round_count: 6,
            latest_round: 3,
            rounds: (1..=3)
                .map(|number| StaticRound {
                    id: format!("r{number}"),
                    number,
                    name: format!("{number}. Spieltag"),
                    start_at: None,
                    end_at: None,
                    phase: "FINISHED".to_owned(),
                })
                .collect(),
            teams: vec![
                team("fcb", "Bayern München", "Bayern"),
                team("m05", "1. FSV Mainz 05", "Mainz"),
                team("s04", "FC Schalke 04", "Schalke"),
                team("koe", "1. FC Köln", "Köln"),
            ],
            players: vec![
                player("olise", "Michael Olise", "fcb"),
                player("becker", "Sheraldo Becker", "m05"),
            ],
            matches: vec![
                fixture("a", 1, "fcb", "koe", (3, 0)),
                fixture("b", 1, "m05", "s04", (1, 1)),
                fixture("c", 2, "s04", "koe", (2, 0)),
                fixture("d", 2, "m05", "fcb", (0, 1)),
                fixture("e", 3, "fcb", "s04", (7, 0)),
                fixture("f", 3, "koe", "m05", (3, 4)),
            ],
            scores: vec![
                score("a", "olise", "fcb", 9, 1, 250),
                score("d", "olise", "fcb", 12, 1, 200),
                score("e", "olise", "fcb", 25, 3, 100),
                score("f", "becker", "m05", 18, 2, 150),
            ],
        }
    }

    fn candidate<'a>(candidates: &'a [Candidate], id: &str) -> &'a Candidate {
        candidates
            .iter()
            .find(|candidate| candidate.id() == id)
            .unwrap_or_else(|| panic!("missing {id}"))
    }

    #[test]
    fn ranks_like_the_frontend_table() {
        let season = season();
        let index = SeasonIndex::new(&season);
        let table = index.table(3);
        let order = table
            .iter()
            .map(|row| row.team_id.as_str())
            .collect::<Vec<_>>();
        assert_eq!(order, ["fcb", "m05", "s04", "koe"]);
        assert_eq!(
            (table[0].points, table[0].goals_for, table[0].goals_against),
            (9, 11, 0)
        );
        // Round 1: Mainz and Schalke both 1 point, 1:1; the name decides.
        let first = index.table(1);
        assert_eq!(first[1].team_id, "m05");
        assert_eq!(first[2].team_id, "s04");
    }

    #[test]
    fn derives_round_candidates_with_templates() {
        let season = season();
        let candidates = SeasonIndex::new(&season).candidates(3);
        let Item::Card(leader) = &candidate(&candidates, "leader").item else {
            panic!("card")
        };
        assert_eq!(leader.answer, "Bayern · 9 Pkt");
        assert_eq!(leader.detail, "100 % · 3 S / 0 U / 0 N");
        let Visual::Results { rows, .. } = &leader.visual else {
            panic!("results")
        };
        let rows = rows
            .iter()
            .map(|row| {
                (
                    row.round,
                    row.outcome.as_str(),
                    row.score.as_str(),
                    row.opponent.as_str(),
                    row.home,
                )
            })
            .collect::<Vec<_>>();
        assert_eq!(
            rows,
            [
                (1, "S", "3:0", "Köln", true),
                (2, "S", "1:0", "Mainz", false),
                (3, "S", "7:0", "Schalke", true)
            ]
        );
        assert_eq!(
            leader
                .subject
                .as_ref()
                .map(|subject| (subject.kind, subject.id.as_str())),
            Some((SubjectKind::Team, "fcb"))
        );
        let Item::Fact(win) = &candidate(&candidates, "biggest-win").item else {
            panic!("fact")
        };
        assert_eq!(
            win.subjects
                .iter()
                .map(|subject| subject.id.as_str())
                .collect::<Vec<_>>(),
            ["fcb", "s04"]
        );
        assert_eq!(
            (win.value.as_str(), win.context.as_str()),
            ("7:0", "Bayern – Schalke")
        );
        assert_eq!(
            win.text,
            "Bayern gewinnt 7:0 gegen Schalke. Schalke steht danach auf Platz 3."
        );
        let Item::Fact(goals) = &candidate(&candidates, "most-goals").item else {
            panic!("fact")
        };
        assert_eq!(
            goals.text,
            "Mainz gewinnt 4:3 bei Köln. 7 Tore in einem Spiel."
        );
        let Item::Fact(multi) = &candidate(&candidates, "multi-goal").item else {
            panic!("fact")
        };
        assert_eq!(multi.text, "Michael Olise trifft 3-mal für Bayern.");
        assert_eq!(
            multi
                .subjects
                .iter()
                .map(|subject| (subject.kind, subject.id.as_str()))
                .collect::<Vec<_>>(),
            [(SubjectKind::Player, "olise")]
        );
        let Item::Card(round) = &candidate(&candidates, "round-top-player").item else {
            panic!("card")
        };
        assert_eq!(round.answer, "Olise · 25");
        let Visual::RoundPoints { rows, .. } = &round.visual else {
            panic!("points")
        };
        assert_eq!(
            rows.iter()
                .map(|row| (row.round, row.points, row.opponent.as_deref()))
                .collect::<Vec<_>>(),
            [
                (1, 9, Some("Köln")),
                (2, 12, Some("Mainz")),
                (3, 25, Some("Schalke"))
            ]
        );
        // Every template text passes the same validation the model text faces.
        let vocabulary = SeasonIndex::new(&season).vocabulary(3);
        for candidate in &candidates {
            let (text, limit) = match &candidate.item {
                Item::Card(card) => (card.question.clone(), MAX_QUESTION_CHARS),
                Item::Fact(fact) => (fact.text.clone(), MAX_TEXT_CHARS),
            };
            assert_eq!(
                validate_text(&text, candidate, &vocabulary, limit),
                Ok(()),
                "{}",
                candidate.id()
            );
        }
    }

    #[test]
    fn validation_rejects_invented_numbers_names_and_words() {
        let season = season();
        let index = SeasonIndex::new(&season);
        let candidates = index.candidates(3);
        let vocabulary = index.vocabulary(3);
        let win = candidate(&candidates, "biggest-win");
        let check = |text: &str| validate_text(text, win, &vocabulary, MAX_TEXT_CHARS);
        assert_eq!(
            check("Bayern fegt Schalke mit 7:0 vom Platz, Schalke ist jetzt Dritter."),
            Ok(())
        );
        assert_eq!(check("FC Schalke 04 verliert 0:7 in München."), Ok(()));
        assert!(
            check("Bayern gewinnt 8:0 gegen Schalke.")
                .unwrap_err()
                .contains("Zahl 8")
        );
        assert!(
            check("Bayern gewinnt 7:0, Köln schaut zu.")
                .unwrap_err()
                .contains("Köln")
        );
        assert!(
            check("Olise trifft beim 7:0 gegen Schalke.")
                .unwrap_err()
                .contains("Olise")
        );
        assert!(
            check("Bayern gewinnt sieben zu null.")
                .unwrap_err()
                .contains("Zahlwort")
        );
        assert!(
            check("Bayern gewinnt 7:0!")
                .unwrap_err()
                .contains("Zeichen")
        );
        assert!(
            check(&"x".repeat(MAX_TEXT_CHARS + 1))
                .unwrap_err()
                .contains("länger")
        );
    }

    #[test]
    fn model_output_is_used_where_valid_and_completed_from_templates() {
        let season = season();
        let index = SeasonIndex::new(&season);
        let candidates = index.candidates(3);
        let previous = template_round(3, facts_hash(&candidates), &candidates);
        let output = ModelOutput {
            cards: vec![
                ModelCard {
                    id: "round-goals".to_owned(),
                    question: "Wie viele Tore fielen am 3. Spieltag?".to_owned(),
                },
                ModelCard {
                    id: "leader".to_owned(),
                    question: "Wer steht nach 9 Punkten ganz oben?".to_owned(),
                },
                ModelCard {
                    id: "leader".to_owned(),
                    question: "Duplikat".to_owned(),
                },
                ModelCard {
                    id: "unknown".to_owned(),
                    question: "Unbekannt".to_owned(),
                },
            ],
            facts: vec![
                ModelFact {
                    id: "biggest-win".to_owned(),
                    text: "Bayern gewinnt 9:0 gegen Schalke.".to_owned(),
                },
                ModelFact {
                    id: "leader".to_owned(),
                    text: "Falscher Typ".to_owned(),
                },
            ],
        };
        let config = InsightsConfig {
            api_key: None,
            model: "claude-opus-5-5".to_owned(),
            effort: "low".to_owned(),
            model_budget: 0,
        };
        let result = apply_model(
            &previous,
            &candidates,
            &output,
            &index.vocabulary(3),
            &config,
        );

        let ids = result
            .cards
            .iter()
            .map(|card| card.id.as_str())
            .collect::<Vec<_>>();
        assert_eq!(&ids[..2], ["round-goals", "leader"]);
        assert_eq!(ids.len(), CARD_COUNT);
        assert_eq!(result.cards[0].source, Source::Model);
        // 3 is the round number, which the round-goals facts contain.
        assert_eq!(
            result.cards[0].question,
            "Wie viele Tore fielen am 3. Spieltag?"
        );
        assert_eq!(result.cards[1].source, Source::Model);
        assert_eq!(result.cards[2].source, Source::Template);

        let win = &result.facts[0];
        assert_eq!(
            (win.id.as_str(), win.source),
            ("biggest-win", Source::Template)
        );
        assert!(
            win.rejected
                .as_deref()
                .unwrap_or_default()
                .contains("Zahl 9")
        );
        assert_eq!(
            result.facts.len(),
            FACT_COUNT.min(
                candidates
                    .iter()
                    .filter(|candidate| as_fact(candidate).is_some())
                    .count()
            )
        );
        assert_eq!(
            (result.model_attempts, result.model.as_deref()),
            (1, Some("claude-opus-5-5"))
        );
        assert!(result.wants_model());
    }

    #[test]
    fn parses_structured_output_and_rejects_unusable_responses() {
        let ok = r#"{"stop_reason":"end_turn","content":[{"type":"thinking","thinking":""},{"type":"text","text":"{\"cards\":[{\"id\":\"leader\",\"question\":\"Wer führt?\"}],\"facts\":[]}"}]}"#;
        assert_eq!(parse_response(ok).unwrap().cards[0].id, "leader");
        let refusal = r#"{"stop_reason":"refusal","content":[]}"#;
        assert!(
            matches!(parse_response(refusal), Err(ModelError::Rejected(reason)) if reason.contains("refusal"))
        );
        let truncated =
            r#"{"stop_reason":"max_tokens","content":[{"type":"text","text":"{\"cards\":["}]}"#;
        assert!(matches!(
            parse_response(truncated),
            Err(ModelError::Rejected(_))
        ));
        let invalid =
            r#"{"stop_reason":"end_turn","content":[{"type":"text","text":"keine JSON"}]}"#;
        assert!(
            matches!(parse_response(invalid), Err(ModelError::Rejected(reason)) if reason.contains("JSON"))
        );
    }

    #[test]
    fn cache_key_changes_with_the_facts_only() {
        let season = season();
        let index = SeasonIndex::new(&season);
        let first = facts_hash(&index.candidates(3));
        assert_eq!(first, facts_hash(&index.candidates(3)));
        let mut changed = season.clone();
        changed.matches[4].home_score = Some(6);
        assert_ne!(first, facts_hash(&SeasonIndex::new(&changed).candidates(3)));
    }

    #[test]
    fn rounds_without_played_matches_have_no_candidates() {
        let mut season = season();
        season
            .matches
            .iter_mut()
            .filter(|fixture| fixture.round == 3)
            .for_each(|fixture| fixture.home_score = None);
        assert!(SeasonIndex::new(&season).candidates(3).is_empty());
    }

    #[test]
    fn writes_and_validates_the_artifact() {
        let season = season();
        let directory =
            std::env::temp_dir().join(format!("punktespiegel-insights-{}", std::process::id()));
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let config = InsightsConfig {
            api_key: None,
            model: "claude-opus-5-5".to_owned(),
            effort: "low".to_owned(),
            model_budget: 6,
        };
        runtime
            .block_on(refresh_insights(
                &Client::new(),
                &directory,
                std::slice::from_ref(&season),
                &config,
            ))
            .unwrap();
        let path = insights_path(&directory, &season.id);
        validate_insights_file(&path, &season).unwrap();
        let file = serde_json::from_slice::<InsightsFile>(&std::fs::read(&path).unwrap()).unwrap();
        assert_eq!(
            file.rounds
                .iter()
                .map(|round| round.round)
                .collect::<Vec<_>>(),
            [1, 2, 3]
        );
        assert!(
            file.rounds
                .iter()
                .all(|round| round.model.is_none() && round.model_attempts == 0)
        );
        // A second run keeps the cached rounds byte for byte.
        let before = std::fs::read(&path).unwrap();
        runtime
            .block_on(refresh_insights(
                &Client::new(),
                &directory,
                std::slice::from_ref(&season),
                &config,
            ))
            .unwrap();
        assert_eq!(before, std::fs::read(&path).unwrap());
        std::fs::remove_dir_all(directory).ok();
    }
}
