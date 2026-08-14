use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::path::Path;
use std::time::Duration as StdDuration;

use anyhow::{Context, bail};
use chrono::{DateTime, Duration, Utc};
use reqwest::Client;
use serde::{Deserialize, Serialize};

use super::StaticSeason;

const NEWS_SCHEMA_VERSION: u32 = 2;
const MAX_ARTICLES: usize = 15;
const NEWS_WINDOW_DAYS: i64 = 14;
const KICKER_OPML_URL: &str = "https://newsfeed.kicker.de/opml";
const NEWS_API_URL: &str = "https://newsapi.org/v2/everything";

const NEWS_DOMAINS: &[(&str, &str)] = &[
    ("kicker.de", "kicker"),
    ("goal.com", "Goal"),
    ("theathletic.com", "The Athletic"),
    ("bundesliga.com", "Bundesliga.com"),
    ("sportschau.de", "Sportschau"),
    ("sport1.de", "Sport1"),
    ("skysports.com", "Sky Sports"),
    ("espn.com", "ESPN"),
    ("transfermarkt.de", "Transfermarkt"),
    ("ligainsider.de", "LigaInsider"),
    ("11freunde.de", "11FREUNDE"),
];

#[derive(Clone, Copy)]
struct FeedDefinition {
    id: &'static str,
    kind: &'static str,
    source: &'static str,
    domain: &'static str,
    url: &'static str,
}

const DEFAULT_RSS_FEEDS: &[FeedDefinition] = &[
    FeedDefinition {
        id: "kicker-bundesliga",
        kind: "league",
        source: "kicker",
        domain: "kicker.de",
        url: "https://newsfeed.kicker.de/news/bundesliga",
    },
    FeedDefinition {
        id: "kicker-2-bundesliga",
        kind: "league",
        source: "kicker",
        domain: "kicker.de",
        url: "https://newsfeed.kicker.de/news/2-bundesliga",
    },
    FeedDefinition {
        id: "kicker-3-liga",
        kind: "league",
        source: "kicker",
        domain: "kicker.de",
        url: "https://newsfeed.kicker.de/news/3-liga",
    },
];

// These endpoints are useful discovery sources, but a public feed endpoint does
// not by itself grant republication rights. Operators must explicitly attest a
// publisher-specific permission before its headlines enter the public artifact.
const PERMISSION_GATED_RSS_FEEDS: &[FeedDefinition] = &[
    FeedDefinition {
        id: "sportschau-bundesliga",
        kind: "league",
        source: "Sportschau",
        domain: "sportschau.de",
        url: "https://www.sportschau.de/fussball/bundesliga/index~rss2.xml",
    },
    FeedDefinition {
        id: "sportschau-2-bundesliga",
        kind: "league",
        source: "Sportschau",
        domain: "sportschau.de",
        url: "https://www.sportschau.de/fussball/bundesliga2/index~rss2.xml",
    },
    FeedDefinition {
        id: "sportschau-3-liga",
        kind: "league",
        source: "Sportschau",
        domain: "sportschau.de",
        url: "https://www.sportschau.de/fussball/bundesliga3/index~rss2.xml",
    },
    FeedDefinition {
        id: "bundesliga-com",
        kind: "general",
        source: "Bundesliga.com",
        domain: "bundesliga.com",
        url: "https://www.bundesliga.com/rss/en/rss-news.rss",
    },
    FeedDefinition {
        id: "sky-sports-football",
        kind: "general",
        source: "Sky Sports",
        domain: "skysports.com",
        url: "https://www.skysports.com/rss/12040",
    },
    FeedDefinition {
        id: "espn-football",
        kind: "general",
        source: "ESPN",
        domain: "espn.com",
        url: "https://www.espn.com/espn/rss/soccer/news",
    },
    FeedDefinition {
        id: "bbc-football",
        kind: "general",
        source: "BBC Sport",
        domain: "bbc.co.uk",
        url: "https://feeds.bbci.co.uk/sport/football/rss.xml",
    },
    FeedDefinition {
        id: "guardian-football",
        kind: "general",
        source: "The Guardian",
        domain: "theguardian.com",
        url: "https://www.theguardian.com/football/rss",
    },
];

struct FeedRequest<'a> {
    id: &'a str,
    kind: &'a str,
    source: &'a str,
    domain: &'a str,
    url: &'a str,
    team_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NewsArtifact {
    schema_version: u32,
    generated_at: String,
    provider: String,
    sources: Vec<String>,
    feeds: Vec<FeedHealth>,
    players: BTreeMap<String, Vec<NewsItem>>,
    teams: BTreeMap<String, Vec<NewsItem>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FeedHealth {
    id: String,
    kind: String,
    source: String,
    domain: String,
    url: String,
    team_id: Option<String>,
    status: String,
    http_status: Option<u16>,
    fetched_at: String,
    item_count: usize,
    accepted_item_count: usize,
    error: Option<String>,
}

impl FeedHealth {
    fn pending(
        id: impl Into<String>,
        kind: impl Into<String>,
        source: impl Into<String>,
        domain: impl Into<String>,
        url: impl Into<String>,
        team_id: Option<String>,
    ) -> Self {
        Self {
            id: id.into(),
            kind: kind.into(),
            source: source.into(),
            domain: domain.into(),
            url: url.into(),
            team_id,
            status: "error".to_owned(),
            http_status: None,
            fetched_at: Utc::now().to_rfc3339(),
            item_count: 0,
            accepted_item_count: 0,
            error: None,
        }
    }

    fn fail(mut self, message: impl Into<String>) -> Self {
        self.status = "error".to_owned();
        self.error = Some(message.into());
        self
    }

    fn unmapped(mut self, message: impl Into<String>) -> Self {
        self.status = "unmapped".to_owned();
        self.error = Some(message.into());
        self
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NewsItem {
    source: String,
    domain: String,
    title: String,
    url: String,
    published_at: String,
    relation: String,
    matched_by: String,
    team_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NewsApiResponse {
    status: String,
    #[serde(default)]
    code: Option<String>,
    #[serde(default)]
    message: Option<String>,
    #[serde(default)]
    articles: Vec<NewsApiArticle>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NewsApiArticle {
    source: NewsApiSource,
    title: String,
    url: String,
    published_at: String,
}

#[derive(Debug, Deserialize)]
struct NewsApiSource {
    name: String,
}

#[derive(Debug, Deserialize)]
struct RssDocument {
    channel: RssChannel,
}

#[derive(Debug, Deserialize)]
struct RssChannel {
    #[serde(rename = "item", default)]
    items: Vec<RssItem>,
}

#[derive(Debug, Deserialize)]
struct RssItem {
    #[serde(default)]
    title: String,
    #[serde(default)]
    link: String,
    #[serde(rename = "pubDate", default)]
    published_at: String,
    #[serde(default)]
    description: String,
    #[serde(rename = "content:encoded", alias = "encoded", default)]
    content: String,
    #[serde(rename = "category", default)]
    categories: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct OpmlDocument {
    body: OpmlBody,
}

#[derive(Debug, Default, Deserialize)]
struct OpmlBody {
    #[serde(rename = "outline", default)]
    outlines: Vec<OpmlOutline>,
}

#[derive(Debug, Clone, Default, Deserialize)]
struct OpmlOutline {
    #[serde(rename = "@text", default)]
    text: String,
    #[serde(rename = "@xmlUrl", default)]
    xml_url: String,
    #[serde(rename = "outline", default)]
    children: Vec<OpmlOutline>,
}

#[derive(Debug, Clone)]
struct ParsedFeedItem {
    title: String,
    url: String,
    published_at: DateTime<Utc>,
    searchable_text: String,
    title_lower: String,
    categories: Vec<String>,
}

#[derive(Debug, Clone)]
struct CurrentTeam {
    id: String,
    name: String,
    code: String,
    aliases: Vec<String>,
}

#[derive(Debug, Clone)]
struct CurrentPlayer {
    id: String,
    name: String,
    team_id: String,
    full_name: String,
    full_name_unique: bool,
    surname: String,
    surname_unique_in_team: bool,
}

fn approved_external_sources() -> HashSet<String> {
    std::env::var("NEWS_APPROVED_RSS_SOURCES")
        .unwrap_or_default()
        .split(',')
        .map(|value| value.trim().to_lowercase())
        .filter(|value| !value.is_empty())
        .collect()
}

fn enabled_rss_feeds(approved: &HashSet<String>) -> Vec<&'static FeedDefinition> {
    DEFAULT_RSS_FEEDS
        .iter()
        .chain(
            PERMISSION_GATED_RSS_FEEDS
                .iter()
                .filter(|feed| source_is_approved(feed, approved)),
        )
        .collect()
}

fn source_is_approved(feed: &FeedDefinition, approved: &HashSet<String>) -> bool {
    approved.contains(&feed.id.to_lowercase())
        || approved.contains(&feed.source.to_lowercase())
        || approved.contains(&feed.domain.to_lowercase())
}

fn news_api_publishing_approved() -> bool {
    std::env::var("NEWS_API_PUBLISHING_APPROVED")
        .ok()
        .is_some_and(|value| matches!(value.trim().to_lowercase().as_str(), "1" | "true" | "yes"))
}

pub async fn refresh_news(
    client: &Client,
    output: &Path,
    seasons: &[StaticSeason],
    current_year: i32,
) -> anyhow::Result<()> {
    let destination = output.join("news.json");
    let generated_at = Utc::now();
    let cutoff = generated_at - Duration::days(NEWS_WINDOW_DAYS);
    let teams = current_teams(seasons, current_year);
    let players = current_players(seasons, current_year);
    let players_by_team = players_by_team(&players);
    let mut player_news = BTreeMap::<String, Vec<NewsItem>>::new();
    let mut team_news = teams
        .iter()
        .map(|team| (team.id.clone(), Vec::new()))
        .collect::<BTreeMap<_, _>>();
    let mut feeds = Vec::new();
    let mut sources = BTreeSet::new();
    let approved_sources = approved_external_sources();

    for definition in enabled_rss_feeds(&approved_sources) {
        let request = FeedRequest {
            id: definition.id,
            kind: definition.kind,
            source: definition.source,
            domain: definition.domain,
            url: definition.url,
            team_id: None,
        };
        let (mut health, items) = fetch_rss_items(client, &request, cutoff).await;
        if health.status == "ok" {
            sources.insert(definition.source.to_owned());
            let mut accepted_urls = HashSet::new();
            for item in &items {
                for player in &players {
                    let Some(matched_by) = match_player(item, player, None, &teams) else {
                        continue;
                    };
                    accepted_urls.insert(canonical_url(&item.url));
                    player_news
                        .entry(player.id.clone())
                        .or_default()
                        .push(player_item(
                            item,
                            definition.source,
                            definition.domain,
                            player,
                            matched_by,
                        ));
                }
            }
            health.accepted_item_count = accepted_urls.len();
        }
        feeds.push(health);
    }

    let (catalog_health, outlines) = fetch_team_catalog(client).await;
    let catalog_ok = catalog_health.status == "ok";
    feeds.push(catalog_health);
    let mut used_outlines = HashSet::new();
    for team in &teams {
        let Some((outline_index, outline)) = map_team_feed(team, &outlines, &used_outlines) else {
            let health = FeedHealth::pending(
                format!("kicker-team-{}", team.id),
                "team",
                "kicker",
                "kicker.de",
                KICKER_OPML_URL,
                Some(team.id.clone()),
            );
            feeds.push(if catalog_ok {
                health.unmapped(format!(
                    "Kein offizieller kicker-Teamfeed für {} im Feedkatalog",
                    team.name
                ))
            } else {
                health.fail("Der kicker-Feedkatalog konnte nicht gelesen werden")
            });
            continue;
        };
        used_outlines.insert(outline_index);
        let feed_id = format!("kicker-team-{}", team.id);
        let request = FeedRequest {
            id: &feed_id,
            kind: "team",
            source: "kicker",
            domain: "kicker.de",
            url: &outline.xml_url,
            team_id: Some(team.id.clone()),
        };
        let (health, items) = fetch_rss_items(client, &request, cutoff).await;
        if health.status == "ok" {
            sources.insert("kicker".to_owned());
            for item in &items {
                team_news
                    .entry(team.id.clone())
                    .or_default()
                    .push(team_item(item, team));
                if let Some(team_players) = players_by_team.get(&team.id) {
                    for player in team_players {
                        let Some(matched_by) = match_player(item, player, Some(&team.id), &teams)
                        else {
                            continue;
                        };
                        player_news
                            .entry(player.id.clone())
                            .or_default()
                            .push(player_item(item, "kicker", "kicker.de", player, matched_by));
                    }
                }
            }
        }
        feeds.push(health);
    }

    let mut used_news_api = false;
    if let Some(api_key) = std::env::var("NEWS_API_KEY")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .filter(|_| news_api_publishing_approved())
    {
        let (health, articles, api_sources) =
            fetch_news_api(client, &players, cutoff, &api_key, &approved_sources).await;
        used_news_api = health.status == "ok";
        if used_news_api {
            sources.extend(api_sources);
            for (player_id, article) in articles {
                player_news.entry(player_id).or_default().push(article);
            }
        }
        feeds.push(health);
    }

    normalize_articles(&mut player_news);
    normalize_articles(&mut team_news);
    let artifact = NewsArtifact {
        schema_version: NEWS_SCHEMA_VERSION,
        generated_at: generated_at.to_rfc3339(),
        provider: if used_news_api {
            "Direkte RSS-Feeds + NewsAPI".to_owned()
        } else {
            "Direkte RSS-Feeds".to_owned()
        },
        sources: sources.into_iter().collect(),
        feeds,
        players: player_news,
        teams: team_news,
    };
    validate_artifact(&artifact, &players, &teams)?;
    write_artifact(&destination, &artifact)?;

    let successful_content_feeds = artifact
        .feeds
        .iter()
        .filter(|feed| feed.kind != "catalog" && feed.status == "ok")
        .count();
    println!(
        "Nachrichten für {} Spieler und {} Vereine aus {} erreichbaren Feeds geprüft",
        players.len(),
        teams.len(),
        successful_content_feeds
    );
    Ok(())
}

async fn fetch_rss_items(
    client: &Client,
    request: &FeedRequest<'_>,
    cutoff: DateTime<Utc>,
) -> (FeedHealth, Vec<ParsedFeedItem>) {
    let mut health = FeedHealth::pending(
        request.id,
        request.kind,
        request.source,
        request.domain,
        request.url,
        request.team_id.clone(),
    );
    let response = match client
        .get(request.url)
        .timeout(StdDuration::from_secs(20))
        .send()
        .await
    {
        Ok(response) => response,
        Err(error) => return (health.fail(short_error(&error)), Vec::new()),
    };
    health.http_status = Some(response.status().as_u16());
    if !response.status().is_success() {
        let status = response.status();
        return (health.fail(format!("HTTP {}", status.as_u16())), Vec::new());
    }
    let bytes = match response.bytes().await {
        Ok(bytes) => bytes,
        Err(error) => return (health.fail(short_error(&error)), Vec::new()),
    };
    let feed: RssDocument = match quick_xml::de::from_reader(bytes.as_ref()) {
        Ok(feed) => feed,
        Err(error) => {
            return (
                health.fail(format!("RSS konnte nicht gelesen werden: {error}")),
                Vec::new(),
            );
        }
    };
    health.item_count = feed.channel.items.len();
    let items = feed
        .channel
        .items
        .into_iter()
        .filter_map(|item| parsed_feed_item(item, cutoff))
        .collect::<Vec<_>>();
    health.status = "ok".to_owned();
    health.accepted_item_count = items.len();
    health.error = None;
    (health, items)
}

async fn fetch_team_catalog(client: &Client) -> (FeedHealth, Vec<OpmlOutline>) {
    let mut health = FeedHealth::pending(
        "kicker-feed-catalog",
        "catalog",
        "kicker",
        "kicker.de",
        KICKER_OPML_URL,
        None,
    );
    let response = match client
        .get(KICKER_OPML_URL)
        .timeout(StdDuration::from_secs(20))
        .send()
        .await
    {
        Ok(response) => response,
        Err(error) => return (health.fail(short_error(&error)), Vec::new()),
    };
    health.http_status = Some(response.status().as_u16());
    if !response.status().is_success() {
        let status = response.status();
        return (health.fail(format!("HTTP {}", status.as_u16())), Vec::new());
    }
    let bytes = match response.bytes().await {
        Ok(bytes) => bytes,
        Err(error) => return (health.fail(short_error(&error)), Vec::new()),
    };
    let document: OpmlDocument = match quick_xml::de::from_reader(bytes.as_ref()) {
        Ok(document) => document,
        Err(error) => {
            return (
                health.fail(format!("OPML konnte nicht gelesen werden: {error}")),
                Vec::new(),
            );
        }
    };
    let mut outlines = Vec::new();
    flatten_outlines(&document.body.outlines, &mut outlines);
    outlines.retain(|outline| outline.xml_url.contains("newsfeed.kicker.de/team/"));
    health.status = "ok".to_owned();
    health.item_count = outlines.len();
    health.accepted_item_count = outlines.len();
    health.error = None;
    (health, outlines)
}

async fn fetch_news_api(
    client: &Client,
    players: &[CurrentPlayer],
    cutoff: DateTime<Utc>,
    api_key: &str,
    approved_sources: &HashSet<String>,
) -> (FeedHealth, Vec<(String, NewsItem)>, BTreeSet<String>) {
    let mut health = FeedHealth::pending(
        "newsapi",
        "api",
        "NewsAPI",
        "newsapi.org",
        NEWS_API_URL,
        None,
    );
    let domains = NEWS_DOMAINS
        .iter()
        .map(|(domain, _)| *domain)
        .collect::<Vec<_>>()
        .join(",");
    let from = cutoff.format("%Y-%m-%d").to_string();
    let mut matches = Vec::new();
    let mut sources = BTreeSet::new();

    for chunk in query_chunks(players, 420) {
        let query = chunk
            .iter()
            .map(|player| format!("\"{}\"", player.name.replace('"', "")))
            .collect::<Vec<_>>()
            .join(" OR ");
        let response = match client
            .get(NEWS_API_URL)
            .timeout(StdDuration::from_secs(20))
            .header("X-Api-Key", api_key)
            .query(&[
                ("q", query.as_str()),
                ("searchIn", "title"),
                ("domains", domains.as_str()),
                ("from", from.as_str()),
                ("sortBy", "publishedAt"),
                ("pageSize", "100"),
            ])
            .send()
            .await
        {
            Ok(response) => response,
            Err(error) => {
                return (
                    health.fail(short_error(&error)),
                    Vec::new(),
                    BTreeSet::new(),
                );
            }
        };
        health.http_status = Some(response.status().as_u16());
        let status = response.status();
        let payload: NewsApiResponse = match response.json().await {
            Ok(payload) => payload,
            Err(error) => {
                return (
                    health.fail(format!(
                        "NewsAPI-Antwort konnte nicht gelesen werden: {error}"
                    )),
                    Vec::new(),
                    BTreeSet::new(),
                );
            }
        };
        if !status.is_success() || payload.status != "ok" {
            let message = payload
                .message
                .unwrap_or_else(|| "unbekannter Fehler".to_owned());
            return (
                health.fail(format!(
                    "NewsAPI {}: {message}",
                    payload.code.unwrap_or_else(|| status.to_string())
                )),
                Vec::new(),
                BTreeSet::new(),
            );
        }
        health.item_count += payload.articles.len();
        for article in payload.articles {
            let title = article.title.trim();
            if title.is_empty() || title == "[Removed]" {
                continue;
            }
            let Some(published_at) = parse_feed_date(&article.published_at) else {
                continue;
            };
            if published_at < cutoff {
                continue;
            }
            let title_lower = fold_text(title);
            let domain = article_domain(&article.url);
            let source = NEWS_DOMAINS
                .iter()
                .find(|(candidate, _)| {
                    domain == *candidate || domain.ends_with(&format!(".{candidate}"))
                })
                .map(|(_, name)| (*name).to_owned())
                .unwrap_or(article.source.name);
            if !approved_sources.contains(&source.to_lowercase())
                && !approved_sources.contains(&domain)
            {
                continue;
            }
            for player in &chunk {
                if !player.full_name_unique
                    || player.full_name.split_whitespace().count() < 2
                    || !contains_alias(&title_lower, &player.full_name)
                {
                    continue;
                }
                sources.insert(source.clone());
                matches.push((
                    player.id.clone(),
                    NewsItem {
                        source: source.clone(),
                        domain: domain.clone(),
                        title: title.to_owned(),
                        url: article.url.clone(),
                        published_at: published_at.to_rfc3339(),
                        relation: "player".to_owned(),
                        matched_by: "fullName".to_owned(),
                        team_id: Some(player.team_id.clone()),
                    },
                ));
            }
        }
    }
    health.status = "ok".to_owned();
    health.accepted_item_count = matches.len();
    health.error = None;
    (health, matches, sources)
}

fn parsed_feed_item(item: RssItem, cutoff: DateTime<Utc>) -> Option<ParsedFeedItem> {
    let title = item.title.trim();
    let url = item.link.trim();
    if title.is_empty() || url.is_empty() || !is_http_url(url) {
        return None;
    }
    let published_at = parse_feed_date(&item.published_at)?;
    if published_at < cutoff {
        return None;
    }
    let description = strip_html(&item.description);
    let content = strip_html(&item.content);
    let searchable_text = fold_text(&format!("{title} {description} {content}"));
    Some(ParsedFeedItem {
        title: title.to_owned(),
        url: url.to_owned(),
        published_at,
        searchable_text,
        title_lower: fold_text(title),
        categories: item
            .categories
            .into_iter()
            .map(|category| fold_text(category.trim()))
            .filter(|category| !category.is_empty())
            .collect(),
    })
}

fn player_item(
    item: &ParsedFeedItem,
    source: &str,
    domain: &str,
    player: &CurrentPlayer,
    matched_by: &str,
) -> NewsItem {
    NewsItem {
        source: source.to_owned(),
        domain: domain.to_owned(),
        title: item.title.clone(),
        url: item.url.clone(),
        published_at: item.published_at.to_rfc3339(),
        relation: "player".to_owned(),
        matched_by: matched_by.to_owned(),
        team_id: Some(player.team_id.clone()),
    }
}

fn team_item(item: &ParsedFeedItem, team: &CurrentTeam) -> NewsItem {
    NewsItem {
        source: "kicker".to_owned(),
        domain: "kicker.de".to_owned(),
        title: item.title.clone(),
        url: item.url.clone(),
        published_at: item.published_at.to_rfc3339(),
        relation: "team".to_owned(),
        matched_by: "officialTeamFeed".to_owned(),
        team_id: Some(team.id.clone()),
    }
}

fn match_player(
    item: &ParsedFeedItem,
    player: &CurrentPlayer,
    feed_team_id: Option<&str>,
    teams: &[CurrentTeam],
) -> Option<&'static str> {
    let team_context = feed_team_id == Some(player.team_id.as_str())
        || teams
            .iter()
            .find(|team| team.id == player.team_id)
            .is_some_and(|team| {
                team.aliases
                    .iter()
                    .any(|alias| contains_alias(&item.searchable_text, alias))
            });
    let one_token_evidence = contains_alias(&item.title_lower, &player.full_name)
        || item
            .categories
            .iter()
            .any(|category| category == &player.full_name);
    let full_name_has_context =
        player.full_name.split_whitespace().count() >= 2 || (team_context && one_token_evidence);
    if contains_alias(&item.searchable_text, &player.full_name)
        && full_name_has_context
        && (player.full_name_unique || team_context)
    {
        return Some("fullName");
    }
    if !safe_surname(player, teams) {
        return None;
    }
    let surname_in_title = contains_alias(&item.title_lower, &player.surname);
    let surname_is_category = item
        .categories
        .iter()
        .any(|category| category == &player.surname);
    if !surname_in_title && !surname_is_category {
        return None;
    }
    team_context.then_some("teamContextSurname")
}

fn safe_surname(player: &CurrentPlayer, teams: &[CurrentTeam]) -> bool {
    if player.surname.chars().count() < 5 || !player.surname_unique_in_team {
        return false;
    }
    const AMBIGUOUS: &[&str] = &[
        "braun", "freund", "glueck", "gross", "jung", "klein", "koch", "lang", "neuer", "reich",
        "rose", "sommer", "stark", "weiss", "winter", "wolf", "young",
    ];
    if AMBIGUOUS.contains(&player.surname.as_str()) {
        return false;
    }
    !teams
        .iter()
        .find(|team| team.id == player.team_id)
        .is_some_and(|team| {
            contains_alias(&fold_text(&team.name), &player.surname)
                || contains_alias(&fold_text(&team.code), &player.surname)
        })
}

fn current_teams(seasons: &[StaticSeason], current_year: i32) -> Vec<CurrentTeam> {
    let mut teams = BTreeMap::new();
    for season in seasons
        .iter()
        .filter(|season| season.start_year == current_year)
    {
        for team in &season.teams {
            teams.entry(team.id.clone()).or_insert_with(|| CurrentTeam {
                id: team.id.clone(),
                name: team.name.clone(),
                code: team.code.clone(),
                aliases: team_aliases(&team.name, &team.code),
            });
        }
    }
    teams.into_values().collect()
}

fn current_players(seasons: &[StaticSeason], current_year: i32) -> Vec<CurrentPlayer> {
    let mut players = BTreeMap::new();
    for season in seasons
        .iter()
        .filter(|season| season.start_year == current_year)
    {
        for player in season.players.iter().filter(|player| player.selectable) {
            let full_name = fold_text(&player.name);
            let surname = player
                .name
                .split_whitespace()
                .last()
                .map(fold_text)
                .unwrap_or_default();
            players
                .entry(player.id.clone())
                .or_insert_with(|| CurrentPlayer {
                    id: player.id.clone(),
                    name: player.name.clone(),
                    team_id: player.team_id.clone(),
                    full_name,
                    full_name_unique: false,
                    surname,
                    surname_unique_in_team: false,
                });
        }
    }
    let mut players = players.into_values().collect::<Vec<_>>();
    let mut full_name_counts = HashMap::new();
    let mut surname_counts = HashMap::new();
    for player in &players {
        *full_name_counts
            .entry(player.full_name.clone())
            .or_insert(0usize) += 1;
        *surname_counts
            .entry((player.team_id.clone(), player.surname.clone()))
            .or_insert(0usize) += 1;
    }
    for player in &mut players {
        player.full_name_unique = full_name_counts.get(&player.full_name) == Some(&1);
        player.surname_unique_in_team =
            surname_counts.get(&(player.team_id.clone(), player.surname.clone())) == Some(&1);
    }
    players
}

fn players_by_team(players: &[CurrentPlayer]) -> HashMap<String, Vec<&CurrentPlayer>> {
    let mut result = HashMap::<String, Vec<&CurrentPlayer>>::new();
    for player in players {
        result
            .entry(player.team_id.clone())
            .or_default()
            .push(player);
    }
    result
}

fn query_chunks(players: &[CurrentPlayer], maximum_query_length: usize) -> Vec<Vec<CurrentPlayer>> {
    let mut chunks = Vec::new();
    let mut current = Vec::new();
    let mut length = 0;
    for player in players {
        let addition = player.name.len() + if current.is_empty() { 2 } else { 6 };
        if !current.is_empty() && length + addition > maximum_query_length {
            chunks.push(current);
            current = Vec::new();
            length = 0;
        }
        length += player.name.len() + if current.is_empty() { 2 } else { 6 };
        current.push(player.clone());
    }
    if !current.is_empty() {
        chunks.push(current);
    }
    chunks
}

fn flatten_outlines(source: &[OpmlOutline], destination: &mut Vec<OpmlOutline>) {
    for outline in source {
        if !outline.xml_url.is_empty() {
            destination.push(outline.clone());
        }
        flatten_outlines(&outline.children, destination);
    }
}

fn map_team_feed<'a>(
    team: &CurrentTeam,
    outlines: &'a [OpmlOutline],
    used: &HashSet<usize>,
) -> Option<(usize, &'a OpmlOutline)> {
    let signature = team_signature(&team.name);
    let mut matches = outlines
        .iter()
        .enumerate()
        .filter(|(index, _)| !used.contains(index))
        .filter(|(_, outline)| {
            let text_signature = team_signature(&outline.text);
            let slug_signature = outline
                .xml_url
                .rsplit('/')
                .next()
                .map(team_signature)
                .unwrap_or_default();
            text_signature == signature || slug_signature == signature
        });
    let first = matches.next()?;
    matches.next().is_none().then_some(first)
}

fn team_signature(value: &str) -> String {
    let generic = [
        "1", "04", "05", "07", "09", "96", "98", "fc", "kicker", "rb", "sc", "sg", "sv",
        "teamnews", "tsg", "tsv", "vfb", "vfl",
    ];
    fold_text(value)
        .split_whitespace()
        .filter_map(|word| {
            if generic.contains(&word) {
                None
            } else if word == "bor" {
                Some("borussia")
            } else {
                Some(word)
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn team_aliases(name: &str, code: &str) -> Vec<String> {
    let generic = [
        "borussia",
        "eintracht",
        "fortuna",
        "fussball",
        "kickers",
        "rot",
        "sport",
        "verein",
    ];
    let mut aliases = BTreeSet::new();
    let full_name = fold_text(name);
    if full_name.chars().count() >= 5 {
        aliases.insert(full_name);
    }
    let signature = team_signature(name);
    if signature.chars().count() >= 5 {
        aliases.insert(signature.clone());
    }
    for word in signature.split_whitespace() {
        if word.chars().count() >= 5 && !generic.contains(&word) {
            aliases.insert(word.to_owned());
        }
    }
    let code = fold_text(code);
    if code.chars().count() >= 5 && !generic.contains(&code.as_str()) {
        aliases.insert(code);
    }
    aliases.into_iter().collect()
}

fn contains_alias(text: &str, alias: &str) -> bool {
    if alias.is_empty() {
        return false;
    }
    text.match_indices(alias).any(|(start, _)| {
        let before = text[..start].chars().next_back();
        let after = text[start + alias.len()..].chars().next();
        before.is_none_or(|character| !character.is_alphanumeric())
            && after.is_none_or(|character| !character.is_alphanumeric())
    })
}

fn parse_feed_date(value: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc2822(value)
        .or_else(|_| DateTime::parse_from_rfc3339(value))
        .ok()
        .map(|date| date.with_timezone(&Utc))
}

fn normalize_articles(news: &mut BTreeMap<String, Vec<NewsItem>>) {
    for articles in news.values_mut() {
        articles.sort_by(|left, right| right.published_at.cmp(&left.published_at));
        let mut urls = HashSet::new();
        articles.retain(|article| urls.insert(canonical_url(&article.url)));
        articles.truncate(MAX_ARTICLES);
    }
}

fn canonical_url(value: &str) -> String {
    value.split('#').next().unwrap_or(value).trim().to_owned()
}

fn is_http_url(value: &str) -> bool {
    value.starts_with("https://") || value.starts_with("http://")
}

fn article_domain(url: &str) -> String {
    url.split_once("://")
        .map(|(_, rest)| rest)
        .unwrap_or(url)
        .split('/')
        .next()
        .unwrap_or_default()
        .trim_start_matches("www.")
        .to_lowercase()
}

fn fold_text(value: &str) -> String {
    let folded = value
        .to_lowercase()
        .replace('ä', "ae")
        .replace('ö', "oe")
        .replace('ü', "ue")
        .replace('ß', "ss");
    let mut result = String::with_capacity(folded.len());
    let mut previous_space = true;
    for character in folded.chars() {
        if character.is_alphanumeric() {
            result.push(character);
            previous_space = false;
        } else if !previous_space {
            result.push(' ');
            previous_space = true;
        }
    }
    result.trim().to_owned()
}

fn strip_html(value: &str) -> String {
    let mut result = String::with_capacity(value.len());
    let mut inside_tag = false;
    for character in value.chars() {
        match character {
            '<' => inside_tag = true,
            '>' => {
                inside_tag = false;
                result.push(' ');
            }
            _ if !inside_tag => result.push(character),
            _ => {}
        }
    }
    result.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn short_error(error: &reqwest::Error) -> String {
    if error.is_timeout() {
        "Zeitüberschreitung beim Abruf".to_owned()
    } else if error.is_connect() {
        "Verbindung zur Quelle fehlgeschlagen".to_owned()
    } else {
        "Quelle konnte nicht gelesen werden".to_owned()
    }
}

pub fn validate_news_file(
    path: &Path,
    seasons: &[StaticSeason],
    current_year: i32,
) -> anyhow::Result<()> {
    let bytes = std::fs::read(path)
        .with_context(|| format!("Nachrichtenartefakt lesen: {}", path.display()))?;
    let artifact = serde_json::from_slice::<NewsArtifact>(&bytes)
        .with_context(|| format!("Nachrichtenartefakt prüfen: {}", path.display()))?;
    validate_artifact(
        &artifact,
        &current_players(seasons, current_year),
        &current_teams(seasons, current_year),
    )
}

fn validate_artifact_shape(artifact: &NewsArtifact) -> anyhow::Result<()> {
    if artifact.schema_version != NEWS_SCHEMA_VERSION {
        bail!("Nachrichtenartefakt verwendet einen unbekannten Datenvertrag");
    }
    if DateTime::parse_from_rfc3339(&artifact.generated_at).is_err() {
        bail!("Nachrichtenartefakt enthält keinen gültigen Erzeugungszeitpunkt");
    }
    if artifact.feeds.iter().any(|feed| {
        !matches!(
            feed.kind.as_str(),
            "catalog" | "league" | "general" | "team" | "api"
        ) || !matches!(feed.status.as_str(), "ok" | "error" | "unmapped")
            || !is_http_url(&feed.url)
            || DateTime::parse_from_rfc3339(&feed.fetched_at).is_err()
    }) {
        bail!("Nachrichtenartefakt enthält einen ungültigen Feedstatus");
    }
    if artifact
        .players
        .values()
        .chain(artifact.teams.values())
        .any(|articles| articles.len() > MAX_ARTICLES)
    {
        bail!("Nachrichtenartefakt enthält zu viele Einträge");
    }
    if artifact
        .players
        .values()
        .flatten()
        .chain(artifact.teams.values().flatten())
        .any(|article| {
            let declared_domain = article.domain.trim_start_matches("www.").to_lowercase();
            let kicker_domain =
                declared_domain == "kicker.de" || declared_domain.ends_with(".kicker.de");
            let kicker_source = article.source.trim().eq_ignore_ascii_case("kicker");
            article.title.trim().is_empty()
                || article.source.trim().is_empty()
                || article.domain.trim().is_empty()
                || !is_http_url(&article.url)
                || !domain_matches_url(&article.url, &declared_domain)
                || kicker_domain != kicker_source
                || DateTime::parse_from_rfc3339(&article.published_at).is_err()
        })
    {
        bail!("Nachrichtenartefakt enthält einen ungültigen Artikel");
    }
    Ok(())
}

fn validate_artifact(
    artifact: &NewsArtifact,
    players: &[CurrentPlayer],
    teams: &[CurrentTeam],
) -> anyhow::Result<()> {
    validate_artifact_shape(artifact)?;
    let player_teams = players
        .iter()
        .map(|player| (player.id.as_str(), player.team_id.as_str()))
        .collect::<HashMap<_, _>>();
    let team_ids = teams
        .iter()
        .map(|team| team.id.as_str())
        .collect::<HashSet<_>>();
    if artifact.players.iter().any(|(id, articles)| {
        !player_teams.contains_key(id.as_str()) || articles.len() > MAX_ARTICLES
    }) || artifact
        .teams
        .iter()
        .any(|(id, articles)| !team_ids.contains(id.as_str()) || articles.len() > MAX_ARTICLES)
    {
        bail!("Nachrichtenartefakt enthält ungültige IDs oder zu viele Einträge");
    }
    for (team_id, articles) in &artifact.teams {
        if articles.iter().any(|article| {
            article.relation != "team"
                || article.matched_by != "officialTeamFeed"
                || article.team_id.as_deref() != Some(team_id)
                || !is_http_url(&article.url)
        }) {
            bail!("Vereinsnachrichten sind nicht konsistent zugeordnet");
        }
    }
    for (player_id, articles) in &artifact.players {
        let expected_team_id = player_teams.get(player_id.as_str()).copied();
        if articles.iter().any(|article| {
            article.relation != "player"
                || !matches!(
                    article.matched_by.as_str(),
                    "fullName" | "teamContextSurname"
                )
                || article.team_id.as_deref() != expected_team_id
                || !is_http_url(&article.url)
        }) {
            bail!("Spielernachrichten sind nicht konsistent zugeordnet");
        }
    }
    if artifact.feeds.iter().any(|feed| {
        if feed.kind == "team" {
            !feed
                .team_id
                .as_deref()
                .is_some_and(|team_id| team_ids.contains(team_id))
        } else {
            feed.team_id.is_some()
        }
    }) {
        bail!("Feedstatus enthält eine ungültige Vereinszuordnung");
    }
    Ok(())
}

fn domain_matches_url(url: &str, declared_domain: &str) -> bool {
    let actual = article_domain(url);
    actual == declared_domain || actual.ends_with(&format!(".{declared_domain}"))
}

fn write_artifact(path: &Path, artifact: &NewsArtifact) -> anyhow::Result<()> {
    let bytes = serde_json::to_vec(artifact)?;
    let temporary = path.with_extension("json.tmp");
    std::fs::write(&temporary, bytes)
        .with_context(|| format!("{} temporär schreiben", temporary.display()))?;
    std::fs::rename(&temporary, path).with_context(|| format!("{} atomar ersetzen", path.display()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn team(id: &str, name: &str, code: &str) -> CurrentTeam {
        CurrentTeam {
            id: id.to_owned(),
            name: name.to_owned(),
            code: code.to_owned(),
            aliases: team_aliases(name, code),
        }
    }

    fn player(id: &str, name: &str, team_id: &str) -> CurrentPlayer {
        CurrentPlayer {
            id: id.to_owned(),
            name: name.to_owned(),
            team_id: team_id.to_owned(),
            full_name: fold_text(name),
            full_name_unique: true,
            surname: name
                .split_whitespace()
                .last()
                .map(fold_text)
                .unwrap_or_default(),
            surname_unique_in_team: true,
        }
    }

    fn item(title: &str, searchable_text: &str, categories: &[&str]) -> ParsedFeedItem {
        ParsedFeedItem {
            title: title.to_owned(),
            url: "https://www.kicker.de/test/artikel".to_owned(),
            published_at: Utc::now(),
            searchable_text: fold_text(searchable_text),
            title_lower: fold_text(title),
            categories: categories.iter().map(|value| fold_text(value)).collect(),
        }
    }

    fn news_item(url: &str) -> NewsItem {
        NewsItem {
            source: "kicker".to_owned(),
            domain: "kicker.de".to_owned(),
            title: "Testmeldung".to_owned(),
            url: url.to_owned(),
            published_at: "2026-08-14T12:00:00Z".to_owned(),
            relation: "player".to_owned(),
            matched_by: "fullName".to_owned(),
            team_id: Some("team".to_owned()),
        }
    }

    #[test]
    fn splits_queries_before_the_news_api_limit() {
        let players = (0..20)
            .map(|index| {
                player(
                    &index.to_string(),
                    &format!("Player with a fairly long name {index}"),
                    "team",
                )
            })
            .collect::<Vec<_>>();
        let chunks = query_chunks(&players, 120);
        assert!(chunks.len() > 1);
        assert_eq!(chunks.iter().map(Vec::len).sum::<usize>(), players.len());
    }

    #[test]
    fn matches_full_names_and_contextual_surnames_only() {
        let teams = vec![team("fci", "FC Ingolstadt 04", "Ingolstadt")];
        let kuegel = player("kuegel", "Julian Kügel", "fci");
        assert_eq!(
            match_player(
                &item("Julian Kügel verlängert", "julian kügel verlängert", &[]),
                &kuegel,
                None,
                &teams,
            ),
            Some("fullName")
        );
        assert_eq!(
            match_player(
                &item("Kügel bleibt", "kügel bleibt beim fc ingolstadt 04", &[]),
                &kuegel,
                None,
                &teams,
            ),
            Some("teamContextSurname")
        );
        assert_eq!(
            match_player(
                &item("Kügel bleibt", "kügel bleibt", &[]),
                &kuegel,
                None,
                &teams,
            ),
            None
        );

        let mut duplicate = player("duplicate", "Jonas Hofmann", "fci");
        duplicate.full_name_unique = false;
        assert_eq!(
            match_player(
                &item("Jonas Hofmann im Fokus", "jonas hofmann im fokus", &[]),
                &duplicate,
                None,
                &teams,
            ),
            None
        );
        assert_eq!(
            match_player(
                &item(
                    "Jonas Hofmann im Fokus",
                    "jonas hofmann beim fc ingolstadt 04",
                    &[],
                ),
                &duplicate,
                None,
                &teams,
            ),
            Some("fullName")
        );
    }

    #[test]
    fn rejects_ambiguous_and_club_name_surnames() {
        let teams = vec![
            team("aac", "Alemannia Aachen", "Aachen"),
            team("stp", "FC St. Pauli", "St. Pauli"),
            team("koeln", "1. FC Köln", "Köln"),
        ];
        assert_eq!(
            match_player(
                &item(
                    "Young überzeugt",
                    "young überzeugt bei alemannia aachen",
                    &[]
                ),
                &player("young", "Isaiah Young", "aac"),
                None,
                &teams,
            ),
            None
        );
        assert_eq!(
            match_player(
                &item(
                    "Kartellamt hält 50+1 für zulässig",
                    "der 1 fc koeln ist betroffen",
                    &["FC St. Pauli"],
                ),
                &player("pauli", "Julian Pauli", "koeln"),
                Some("koeln"),
                &teams,
            ),
            None
        );

        let leverkusen = team("b04", "Bayer 04 Leverkusen", "Leverkusen");
        let arthur = player("arthur", "Arthur", "b04");
        assert_eq!(
            match_player(
                &item(
                    "Which footballer has played for the most clubs?",
                    "arthur has played for many clubs",
                    &[],
                ),
                &arthur,
                None,
                std::slice::from_ref(&leverkusen),
            ),
            None
        );
        assert_eq!(
            match_player(
                &item(
                    "Arthur bleibt",
                    "arthur bleibt bei bayer 04 leverkusen",
                    &[],
                ),
                &arthur,
                None,
                &[leverkusen],
            ),
            Some("fullName")
        );

        let mut becker = player("becker", "Timo Becker", "aac");
        becker.surname_unique_in_team = false;
        assert_eq!(
            match_player(
                &item(
                    "Becker bleibt",
                    "becker bleibt bei alemannia aachen",
                    &["Becker"]
                ),
                &becker,
                Some("aac"),
                &teams,
            ),
            None
        );
    }

    #[test]
    fn maps_exact_current_team_signatures_from_opml() {
        let outlines = vec![OpmlOutline {
            text: "kicker Teamnews Borussia Mönchengladbach".to_owned(),
            xml_url: "https://newsfeed.kicker.de/team/borussia-moenchengladbach".to_owned(),
            children: Vec::new(),
        }];
        let mapped = map_team_feed(
            &team("bmg", "Bor. Mönchengladbach", "M’gladbach"),
            &outlines,
            &HashSet::new(),
        );
        assert_eq!(
            mapped.map(|(_, feed)| feed.xml_url.as_str()),
            Some(outlines[0].xml_url.as_str())
        );
    }

    #[test]
    fn reads_opml_attributes_and_nested_team_outlines() {
        let xml = br#"<opml><body><outline text="Team-Feed"><outline type="rss" text="kicker Teamnews FC Ingolstadt 04" xmlUrl="https://newsfeed.kicker.de/team/fc-ingolstadt-04"/></outline></body></opml>"#;
        let document: OpmlDocument = quick_xml::de::from_reader(xml.as_slice()).unwrap();
        let mut outlines = Vec::new();
        flatten_outlines(&document.body.outlines, &mut outlines);
        assert_eq!(outlines.len(), 1);
        assert_eq!(outlines[0].text, "kicker Teamnews FC Ingolstadt 04");
    }

    #[test]
    fn reads_rss_descriptions_categories_and_dates() {
        let xml = r#"<rss xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><item><title>Kügel bleibt</title><link>https://example.com/kuegel</link><description>Der Stürmer bleibt in Ingolstadt.</description><content:encoded><![CDATA[<p>Julian Kügel</p>]]></content:encoded><category>Kügel</category><pubDate>Tue, 11 Aug 2026 07:22:20 GMT</pubDate></item></channel></rss>"#;
        let feed: RssDocument = quick_xml::de::from_reader(xml.as_bytes()).unwrap();
        assert_eq!(feed.channel.items.len(), 1);
        assert_eq!(feed.channel.items[0].categories, vec!["Kügel"]);
        assert!(parse_feed_date(&feed.channel.items[0].published_at).is_some());
    }

    #[test]
    fn sorts_deduplicates_and_caps_articles() {
        let mut articles = (1..=20)
            .map(|index| NewsItem {
                source: "kicker".to_owned(),
                domain: "kicker.de".to_owned(),
                title: format!("Artikel {index}"),
                url: format!("https://www.kicker.de/{index}/artikel#omrss"),
                published_at: format!("2026-08-{index:02}T12:00:00+00:00"),
                relation: "player".to_owned(),
                matched_by: "fullName".to_owned(),
                team_id: Some("team".to_owned()),
            })
            .collect::<Vec<_>>();
        let mut duplicate = articles[19].clone();
        duplicate.url = canonical_url(&duplicate.url);
        articles.push(duplicate);
        let mut news = BTreeMap::from([("player".to_owned(), articles)]);
        normalize_articles(&mut news);
        assert_eq!(news["player"].len(), MAX_ARTICLES);
        assert_eq!(news["player"][0].title, "Artikel 20");
        assert!(news["player"][0].url.ends_with("#omrss"));
    }

    #[test]
    fn serializes_the_v2_contract() {
        let artifact = NewsArtifact {
            schema_version: NEWS_SCHEMA_VERSION,
            generated_at: "2026-08-14T12:00:00Z".to_owned(),
            provider: "Direkte RSS-Feeds".to_owned(),
            sources: vec!["kicker".to_owned()],
            feeds: vec![],
            players: BTreeMap::new(),
            teams: BTreeMap::new(),
        };
        let value = serde_json::to_value(artifact).unwrap();
        assert_eq!(value["schemaVersion"], 2);
        assert!(value.get("feeds").is_some());
        assert!(value.get("teams").is_some());
    }

    #[test]
    fn rejects_spoofed_source_domains_and_orphan_player_assignments() {
        let players = vec![player("player", "Ada Beispiel", "team")];
        let teams = vec![team("team", "Testverein", "Test")];
        let artifact = |player_id: &str, article: NewsItem| NewsArtifact {
            schema_version: NEWS_SCHEMA_VERSION,
            generated_at: "2026-08-14T12:00:00Z".to_owned(),
            provider: "Direkte RSS-Feeds".to_owned(),
            sources: vec!["kicker".to_owned()],
            feeds: vec![],
            players: BTreeMap::from([(player_id.to_owned(), vec![article])]),
            teams: BTreeMap::new(),
        };

        assert!(
            validate_artifact(
                &artifact(
                    "player",
                    news_item("https://www.kicker.de/test/artikel#omrss")
                ),
                &players,
                &teams,
            )
            .is_ok()
        );
        assert!(
            validate_artifact(
                &artifact("player", news_item("https://example.test/not-kicker")),
                &players,
                &teams,
            )
            .is_err()
        );
        assert!(
            validate_artifact(
                &artifact("orphan", news_item("https://www.kicker.de/test/artikel")),
                &players,
                &teams,
            )
            .is_err()
        );
    }

    #[test]
    fn rejects_invalid_relations_and_team_assignments() {
        let players = vec![player("player", "Ada Beispiel", "team")];
        let teams = vec![team("team", "Testverein", "Test")];
        let mut article = news_item("https://www.kicker.de/test/artikel");
        article.relation = "team".to_owned();
        article.matched_by = "officialTeamFeed".to_owned();
        let artifact = NewsArtifact {
            schema_version: NEWS_SCHEMA_VERSION,
            generated_at: "2026-08-14T12:00:00Z".to_owned(),
            provider: "Direkte RSS-Feeds".to_owned(),
            sources: vec!["kicker".to_owned()],
            feeds: vec![],
            players: BTreeMap::from([("player".to_owned(), vec![article])]),
            teams: BTreeMap::new(),
        };
        assert!(validate_artifact(&artifact, &players, &teams).is_err());
    }

    #[test]
    fn extracts_a_normalized_article_domain() {
        assert_eq!(article_domain("https://www.kicker.de/article"), "kicker.de");
    }

    #[test]
    fn permission_gate_accepts_feed_id_source_name_or_domain() {
        let feed = PERMISSION_GATED_RSS_FEEDS
            .iter()
            .find(|feed| feed.id == "sportschau-bundesliga")
            .unwrap();
        assert!(source_is_approved(
            feed,
            &HashSet::from([feed.id.to_owned()])
        ));
        assert!(source_is_approved(
            feed,
            &HashSet::from([feed.source.to_lowercase()])
        ));
        assert!(source_is_approved(
            feed,
            &HashSet::from([feed.domain.to_owned()])
        ));
        assert!(!source_is_approved(feed, &HashSet::new()));
    }

    #[test]
    fn matches_names_at_word_boundaries() {
        assert!(contains_alias(
            "neuer vertrag fuer harry kane",
            "harry kane"
        ));
        assert!(contains_alias("kane bleibt in muenchen", "kane"));
        assert!(!contains_alias("orkanentscheidung", "kane"));
    }
}
