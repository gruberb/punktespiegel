use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::Path;

use anyhow::{Context, bail};
use chrono::{DateTime, Duration, Utc};
use reqwest::Client;
use serde::{Deserialize, Serialize};

use super::StaticSeason;

const NEWS_SCHEMA_VERSION: u32 = 1;
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
const RSS_FEEDS: &[(&str, &str, &str)] = &[
    (
        "kicker",
        "kicker.de",
        "https://newsfeed.kicker.de/news/bundesliga",
    ),
    (
        "kicker",
        "kicker.de",
        "https://newsfeed.kicker.de/news/2-bundesliga",
    ),
    (
        "kicker",
        "kicker.de",
        "https://newsfeed.kicker.de/news/3-liga",
    ),
    (
        "Sportschau",
        "sportschau.de",
        "https://www.sportschau.de/fussball/bundesliga/index~rss2.xml",
    ),
    (
        "Sportschau",
        "sportschau.de",
        "https://www.sportschau.de/fussball/bundesliga2/index~rss2.xml",
    ),
    (
        "Sportschau",
        "sportschau.de",
        "https://www.sportschau.de/fussball/bundesliga3/index~rss2.xml",
    ),
    (
        "Bundesliga.com",
        "bundesliga.com",
        "https://www.bundesliga.com/rss/en/rss-news.rss",
    ),
    (
        "Sky Sports",
        "skysports.com",
        "https://www.skysports.com/rss/12040",
    ),
    (
        "ESPN",
        "espn.com",
        "https://www.espn.com/espn/rss/soccer/news",
    ),
    (
        "BBC Sport",
        "bbc.co.uk",
        "https://feeds.bbci.co.uk/sport/football/rss.xml",
    ),
    (
        "The Guardian",
        "theguardian.com",
        "https://www.theguardian.com/football/rss",
    ),
];

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct NewsArtifact {
    schema_version: u32,
    generated_at: String,
    provider: String,
    sources: Vec<String>,
    players: BTreeMap<String, Vec<NewsItem>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct NewsItem {
    source: String,
    domain: String,
    title: String,
    url: String,
    published_at: String,
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
}

#[derive(Debug, Clone)]
struct CurrentPlayer {
    id: String,
    name: String,
}

pub async fn refresh_news(
    client: &Client,
    output: &Path,
    seasons: &[StaticSeason],
    current_year: i32,
) -> anyhow::Result<()> {
    let destination = output.join("news.json");
    if let Some(api_key) = std::env::var("NEWS_API_KEY")
        .ok()
        .filter(|value| !value.trim().is_empty())
    {
        match refresh_news_api(client, &destination, seasons, current_year, &api_key).await {
            Ok(()) => return Ok(()),
            Err(error) => {
                eprintln!(
                    "NewsAPI fehlgeschlagen, öffentliche RSS-Feeds werden verwendet: {error:#}"
                )
            }
        }
    }
    refresh_rss_news(client, &destination, seasons, current_year).await
}

async fn refresh_news_api(
    client: &Client,
    destination: &Path,
    seasons: &[StaticSeason],
    current_year: i32,
    api_key: &str,
) -> anyhow::Result<()> {
    let players = current_players(seasons, current_year);
    let aliases = players
        .iter()
        .map(|player| (player.id.clone(), player.name.to_lowercase()))
        .collect::<HashMap<_, _>>();
    let mut player_news: BTreeMap<String, Vec<NewsItem>> = BTreeMap::new();
    let from = (Utc::now() - Duration::days(14))
        .format("%Y-%m-%d")
        .to_string();
    let domains = NEWS_DOMAINS
        .iter()
        .map(|(domain, _)| *domain)
        .collect::<Vec<_>>()
        .join(",");

    for chunk in query_chunks(&players, 420) {
        let query = chunk
            .iter()
            .map(|player| format!("\"{}\"", player.name.replace('"', "")))
            .collect::<Vec<_>>()
            .join(" OR ");
        let response = client
            .get("https://newsapi.org/v2/everything")
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
            .context("Nachrichten bei NewsAPI anfragen")?;
        let status = response.status();
        let payload: NewsApiResponse = response.json().await.context("NewsAPI-Antwort lesen")?;
        if !status.is_success() || payload.status != "ok" {
            bail!(
                "NewsAPI meldete {}: {}",
                payload.code.unwrap_or_else(|| status.to_string()),
                payload
                    .message
                    .unwrap_or_else(|| "unbekannter Fehler".to_owned())
            );
        }
        for article in payload.articles {
            let title = article.title.trim();
            if title.is_empty() || title == "[Removed]" {
                continue;
            }
            let title_lower = title.to_lowercase();
            let domain = article_domain(&article.url);
            let source = NEWS_DOMAINS
                .iter()
                .find(|(candidate, _)| {
                    domain == *candidate || domain.ends_with(&format!(".{candidate}"))
                })
                .map(|(_, name)| (*name).to_owned())
                .unwrap_or(article.source.name);
            for player in &chunk {
                if !title_lower.contains(
                    aliases
                        .get(&player.id)
                        .map(String::as_str)
                        .unwrap_or_default(),
                ) {
                    continue;
                }
                player_news
                    .entry(player.id.clone())
                    .or_default()
                    .push(NewsItem {
                        source: source.clone(),
                        domain: domain.clone(),
                        title: title.to_owned(),
                        url: article.url.clone(),
                        published_at: article.published_at.clone(),
                    });
            }
        }
    }

    normalize_articles(&mut player_news);
    write_artifact(
        destination,
        &NewsArtifact {
            schema_version: NEWS_SCHEMA_VERSION,
            generated_at: Utc::now().to_rfc3339(),
            provider: "NewsAPI".to_owned(),
            sources: NEWS_DOMAINS
                .iter()
                .map(|(_, name)| (*name).to_owned())
                .collect(),
            players: player_news,
        },
    )?;
    println!("Nachrichten für {} aktuelle Spieler geprüft", players.len());
    Ok(())
}

async fn refresh_rss_news(
    client: &Client,
    destination: &Path,
    seasons: &[StaticSeason],
    current_year: i32,
) -> anyhow::Result<()> {
    let players = current_players(seasons, current_year);
    let aliases = player_aliases(&players);
    let cutoff = Utc::now() - Duration::days(14);
    let mut player_news: BTreeMap<String, Vec<NewsItem>> = BTreeMap::new();
    let mut successful_feeds = 0;

    for (source, domain, url) in RSS_FEEDS {
        let response = match client.get(*url).send().await {
            Ok(response) if response.status().is_success() => response,
            Ok(response) => {
                eprintln!("RSS-Feed {source} antwortet mit {}", response.status());
                continue;
            }
            Err(error) => {
                eprintln!("RSS-Feed {source} nicht erreichbar: {error}");
                continue;
            }
        };
        let bytes = match response.bytes().await {
            Ok(bytes) => bytes,
            Err(error) => {
                eprintln!("RSS-Feed {source} nicht lesbar: {error}");
                continue;
            }
        };
        let feed: RssDocument = match quick_xml::de::from_reader(bytes.as_ref()) {
            Ok(feed) => feed,
            Err(error) => {
                eprintln!("RSS-Feed {source} ist kein unterstütztes RSS-Format: {error}");
                continue;
            }
        };
        successful_feeds += 1;
        for item in feed.channel.items {
            let title = item.title.trim();
            let link = item.link.trim();
            if title.is_empty() || link.is_empty() {
                continue;
            }
            let Some(published_at) = parse_feed_date(&item.published_at) else {
                continue;
            };
            if published_at < cutoff {
                continue;
            }
            let title_lower = title.to_lowercase();
            for player in &players {
                let matched = aliases.get(&player.id).is_some_and(|names| {
                    names.iter().any(|name| contains_alias(&title_lower, name))
                });
                if !matched {
                    continue;
                }
                player_news
                    .entry(player.id.clone())
                    .or_default()
                    .push(NewsItem {
                        source: (*source).to_owned(),
                        domain: (*domain).to_owned(),
                        title: title.to_owned(),
                        url: link.to_owned(),
                        published_at: published_at.to_rfc3339(),
                    });
            }
        }
    }

    if successful_feeds == 0 {
        bail!("keine öffentliche RSS-Quelle war erreichbar");
    }
    normalize_articles(&mut player_news);
    write_artifact(
        destination,
        &NewsArtifact {
            schema_version: NEWS_SCHEMA_VERSION,
            generated_at: Utc::now().to_rfc3339(),
            provider: "Direkte RSS-Feeds".to_owned(),
            sources: rss_source_names(),
            players: player_news,
        },
    )?;
    println!(
        "Nachrichten für {} aktuelle Spieler aus {} RSS-Feeds geprüft",
        players.len(),
        successful_feeds
    );
    Ok(())
}

fn current_players(seasons: &[StaticSeason], current_year: i32) -> Vec<CurrentPlayer> {
    let mut players = BTreeMap::new();
    for season in seasons
        .iter()
        .filter(|season| season.start_year == current_year)
    {
        for player in season.players.iter().filter(|player| player.selectable) {
            players
                .entry(player.id.clone())
                .or_insert_with(|| CurrentPlayer {
                    id: player.id.clone(),
                    name: player.name.clone(),
                });
        }
    }
    players.into_values().collect()
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

fn player_aliases(players: &[CurrentPlayer]) -> HashMap<String, Vec<String>> {
    let mut last_names = HashMap::new();
    for player in players {
        if let Some(last_name) = player.name.split_whitespace().last() {
            *last_names.entry(last_name.to_lowercase()).or_insert(0usize) += 1;
        }
    }
    players
        .iter()
        .map(|player| {
            let mut names = vec![player.name.to_lowercase()];
            if let Some(last_name) = player.name.split_whitespace().last().map(str::to_lowercase)
                && last_name.chars().count() >= 5
                && last_names.get(&last_name) == Some(&1)
            {
                names.push(last_name);
            }
            (player.id.clone(), names)
        })
        .collect()
}

fn contains_alias(title: &str, alias: &str) -> bool {
    title.match_indices(alias).any(|(start, _)| {
        let before = title[..start].chars().next_back();
        let after = title[start + alias.len()..].chars().next();
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

fn rss_source_names() -> Vec<String> {
    let mut sources = RSS_FEEDS
        .iter()
        .map(|(name, _, _)| (*name).to_owned())
        .collect::<Vec<_>>();
    sources.sort();
    sources.dedup();
    sources
}

fn normalize_articles(player_news: &mut BTreeMap<String, Vec<NewsItem>>) {
    for articles in player_news.values_mut() {
        let mut urls = HashSet::new();
        articles.retain(|article| urls.insert(article.url.clone()));
        articles.sort_by(|left, right| right.published_at.cmp(&left.published_at));
        articles.truncate(10);
    }
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

fn write_artifact(path: &Path, artifact: &NewsArtifact) -> anyhow::Result<()> {
    let bytes = serde_json::to_vec(artifact)?;
    std::fs::write(path, bytes).with_context(|| format!("{} schreiben", path.display()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_queries_before_the_news_api_limit() {
        let players = (0..20)
            .map(|index| CurrentPlayer {
                id: index.to_string(),
                name: format!("Player with a fairly long name {index}"),
            })
            .collect::<Vec<_>>();
        let chunks = query_chunks(&players, 120);
        assert!(chunks.len() > 1);
        assert_eq!(chunks.iter().map(Vec::len).sum::<usize>(), players.len());
    }

    #[test]
    fn extracts_a_normalized_article_domain() {
        assert_eq!(article_domain("https://www.kicker.de/article"), "kicker.de");
    }

    #[test]
    fn matches_names_at_word_boundaries() {
        assert!(contains_alias("neuer vertrag für harry kane", "harry kane"));
        assert!(contains_alias("kane bleibt in münchen", "kane"));
        assert!(!contains_alias("orkanentscheidung", "kane"));
    }

    #[test]
    fn reads_rss_dates() {
        assert!(parse_feed_date("Tue, 11 Aug 2026 07:22:20 GMT").is_some());
        assert!(parse_feed_date("2026-08-11T07:22:20Z").is_some());
    }

    #[test]
    fn reads_a_basic_rss_document() {
        let xml = br#"<rss><channel><item><title>Harry Kane bleibt</title><link>https://example.com/kane</link><pubDate>Tue, 11 Aug 2026 07:22:20 GMT</pubDate></item></channel></rss>"#;
        let feed: RssDocument = quick_xml::de::from_reader(xml.as_slice()).unwrap();
        assert_eq!(feed.channel.items.len(), 1);
        assert_eq!(feed.channel.items[0].title, "Harry Kane bleibt");
    }
}
