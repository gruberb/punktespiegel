# Player news research

Research date: 2026-08-14

## Executive answer

The empty “In den Nachrichten” state for Lars Lokotsch is not primarily a
kicker outage and not a frontend rendering bug.

Punktespiegel does not read kicker's player-news archive. It builds a small
static `news.json` from competition-wide RSS feeds, considers only the last 14
days, and assigns an item to a player only when the player's full name or a
globally unique surname occurs in the headline. Kicker's own player page uses
editorial/entity associations that are not present in the headline. Its most
recent Lokotsch-associated stories therefore appear on kicker while remaining
invisible to Punktespiegel.

Kicker does block the obvious way of closing that gap: ordinary backend
requests to the player-news HTML receive a DataDome `403` challenge. Kicker's
robots notice also prohibits automated collection without express permission.
There is no advertised player-level RSS feed or public player-news API.

Kicker does, however, publish official competition and team RSS feeds. For a
strictly non-commercial site, kicker's terms explicitly allow the current
headline and teaser with a direct link and visible linked attribution, subject
to several restrictions. This makes a useful, compliant news surface possible,
but not an exact copy of kicker's player archive.

Recommended product decision:

1. Show up to 15 current links, never copied article bodies or images.
2. Separate high-confidence **player mentions** from clearly labelled **club
   context** taken from the player's current team feed.
3. Retain a verified direct kicker archive link where available; otherwise use
   a clearly labelled kicker-restricted search rather than guessing a slug.
4. Ask kicker for a syndication/API agreement if exact player-level archive
   parity, permanent storage, systematic commercial use, or monetisation is a
   requirement.

## Implementation status

The first two phases described below were implemented after the baseline audit:

- `news.json` schema v2 imports the official kicker RSS/OPML catalog and stores
  player and club-context links separately. Other configured publishers are
  permission-gated and disabled by default.
- Player matching now uses full names, provider categories, and club context;
  ambiguous single names, duplicate names, same-club duplicate surnames, and
  known common-word surnames are rejected unless additional context resolves
  them.
- Player profiles combine direct mentions with clearly labelled club context up
  to 15 links.
- Every source records `ok`, `error`, or `unmapped` health. Player pages report
  their own club-feed availability, and a failed refresh writes a fresh empty
  artifact rather than retaining vanished kicker items.
- Verified stable kicker archive slugs remain direct outbound links. Other
  players receive a clearly labelled, kicker-restricted search link rather than
  a guessed URL that could resolve to the wrong person. No player-page HTML,
  hidden API, article body, or image is copied.

A live validation run on 14 August mapped 52 of the 56 current club feeds. The
four clubs absent from kicker's OPML were surfaced as unavailable rather than
silently treated as empty. Lars still had no defensible direct feed match, but
his profile received twelve current Ingolstadt club-context links. All six
known false-positive fixtures listed below received zero assignments.

## What happens for Lars Lokotsch

Lars Lokotsch is `pl-k00101435` in the current 3. Liga season artifact. The
deployed `news.json` has no entry for that ID.

The public browser page
[kicker: Lars Lokotsch news](https://www.kicker.de/lars-lokotsch/spieler-news)
currently works for a normal logged-out visitor and contains twelve associated
items. Its newest three headlines are dated 8 August, 29 July, and 25 July 2026.
None contains “Lokotsch” in the headline. The first recent headline that does
contain his surname is from 22 June and is outside Punktespiegel's 14-day
window.

The corresponding official feeds are:

- [FC Ingolstadt 04 team RSS](https://newsfeed.kicker.de/team/fc-ingolstadt-04)
- [3. Liga RSS](https://newsfeed.kicker.de/news/3-liga)
- [kicker OPML catalog](https://newsfeed.kicker.de/opml)

The live Ingolstadt feed has 19 rolling items and the 3. Liga feed has 20.
Neither currently contains Lokotsch. The player page can therefore have news
while every supported feed-based matcher correctly has no direct item.

## Previous Punktespiegel pipeline (baseline root cause)

Before the implementation above, the pipeline behaved as follows:

1. The daily Rust build called `refresh_news` after the season artifacts were
   generated.
2. If `NEWS_API_KEY` exists and NewsAPI succeeds, NewsAPI replaces the RSS
   path. It is not merged with RSS.
3. Otherwise eleven configured RSS endpoints from seven brands were read.
4. Only selectable players in the three current seasons were considered.
5. RSS items older than 14 days are discarded. Only their titles are matched;
   description, feed category, club, league, and article entity metadata were
   ignored.
6. A full name always becomes an alias. A surname of at least five characters
   also became an alias when it was unique across all current players.
7. Results were URL-deduplicated and truncated to ten per player.
8. The browser performs no source request. It simply looks up
   `news.players[player.id]`, or rendered the empty state.

The direct kicker player-news URL was already generated and displayed. It is an
outbound link only; it is never used for ingestion
([`api.ts`](../frontend/src/api.ts)).

### Live coverage on 14 August 2026

The [deployed news artifact](https://punktespiegel.org/data/news.json)
was generated at 17:51 UTC from direct RSS feeds:

| Measure | Live result |
| --- | ---: |
| Current eligible player IDs | 1,637 |
| Player IDs with at least one assigned item | 37 (2.26%) |
| Assigned article/player pairs | 49 |
| kicker | 23 |
| Sportschau | 13 |
| Bundesliga.com | 8 |
| The Guardian | 3 |
| BBC Sport | 2 |
| Sky Sports / ESPN | 0 |

This was the pre-change production baseline. An absent NewsAPI key selected RSS,
an API error fell back to RSS, and complete news failure was deliberately
non-fatal. The new implementation records every source outcome and does not
retain prior RSS content after a failed source run.

### Precision is worse than the raw coverage suggests

The surname-only rule creates obvious false positives. In today's 49
assignments:

- Daniel Heuer Fernandes receives a BBC story about Bruno Fernandes.
- Marco Schuster receives a story about coach Julian Schuster.
- Isaiah Young receives Guardian headlines containing the adjective “young”.
- Leon Sommer receives a headline containing “Sommer-Neuzugänge”.
- Julian Pauli receives FC St. Pauli stories.
- Michael Glück receives headlines using the ordinary noun “Glück”.

Those six player IDs account for 14 of 49 assignments. Removing only these
obvious errors leaves at most 35 assignments for 31 players, or 1.89% apparent
coverage. That is still an upper bound because subtler homonyms remain.

Full-name collisions are also possible. The current roster contains two Jonas
Hofmann IDs and two Marvin Schulz IDs. Since the former matcher had no club or
league context, a matching full-name headline could be assigned to both. The
former outbound kicker archive URL was also based on the name slug alone. The
implementation now keeps verified slug overrides by stable player ID and falls
back to an explicitly labelled site-restricted search when no verified slug is
available.

Increasing `truncate(10)` to 15 without changing classification would therefore
increase noise, not solve discovery.

## Is kicker blocking it?

There are two distinct surfaces:

### Official RSS: available

The official OPML catalog and team/competition feeds return public XML. The
catalog currently advertises 33 competition/topic feeds, 56 team feeds (all 18
Bundesliga, 18 2. Bundesliga, and 20 3. Liga clubs), and media feeds. It
advertises no player feed. The feeds return permissive CORS headers and a short
five-minute cache lifetime.

Kicker's [RSS explainer](https://www.kicker.de/mit_rss_immer_informiert-371919/artikel)
documents only news/competition feeds, club feeds, and media feeds.

### Player archive HTML: protected

A direct server request to `/lars-lokotsch/spieler-news` returns `HTTP 403`
from CloudFront with `x-datadome: protected`; a real JavaScript browser succeeds.
This is anti-bot protection, not a subscription paywall. CORS is not the cause
of the server-side failure, and the protected page cannot be relied on as an
iframe or client-side data source.

Kicker's [robots notice](https://www.kicker.de/robots.txt) explicitly prohibits
robots or other automated collection without permission and reserves text and
data mining rights. Its `/kickerapi*` paths are disallowed, and no public
developer documentation for a player-news API was found. Bypassing DataDome or
reverse-engineering the hidden API is not an acceptable implementation path.

## What kicker permits

Section 17 of kicker's
[general terms](https://www.kicker.de/nutzungsbedingungen-350282/artikel)
allows RSS use on **non-commercial** internet offerings in this form:

- headline and teaser from the feed;
- the provided URL and a direct, no-frame link to kicker;
- a prominent, directly linked attribution such as “Quelle www.kicker.de”;
- no images;
- no onward redistribution;
- no archive;
- no availability guarantee, and permission can be withdrawn.

Punktespiegel only needs headline, publication date, source, and the direct
link, so the requested card is narrower than the permitted headline-and-teaser
presentation. It should nevertheless use the exact visible source attribution
and rebuild a rolling snapshot from items still present in the current feed,
rather than preserve a historical news database.

If Punktespiegel is or becomes commercial, sponsored, ad-supported, or part of
a paid offering, obtain written permission first. Kicker's current
[content-syndication terms](https://www.kicker.de/allgemeine-geschaeftsbedingungen-content-syndication-1209934/artikel)
also warn against scraping, archive/database creation, and systematic link
collections outside the agreed use. The listed syndication contact is
`syndication@kicker.de`.

This is a product-risk reading of published terms, not legal advice.

## Sources found in the baseline audit

"Present" does not mean "licensed for public republication." It means an
endpoint, domain, link, or extracted field was configured or stored when the
audit began. The UI column below describes the pre-change state; the shipped
implementation now permission-gates every non-kicker headline source.

| Source | What was on file | Pre-change UI use | Recommendation |
| --- | --- | --- | --- |
| kicker | Three league RSS feeds; 23 live assignments; generated player profile and player-news links | Article cards when title matcher hits; archive link always | Use current official team + league RSS on a non-commercial site under §17. Use verified archive links or the labelled search fallback. Do not scrape player HTML/API. |
| Sportschau / ARD | Three league RSS endpoints; 13 live assignments | Article cards | ARD's terms say storage/republication of text needs prior written consent. Keep direct links, but obtain permission before treating the feed as a public syndication licence. |
| Bundesliga.com | One English RSS endpoint; 8 live assignments | Article cards | Its legal notice reserves content reuse and automated access. Keep outbound links; clarify permission or remove automated display. Low value for lower leagues. |
| BBC Sport | Football RSS; 2 live assignments | Article cards | BBC terms allow a non-business website RSS presentation with prominent attribution; business use needs a metadata licence. Follow the feed without modification. |
| The Guardian | Football RSS; 3 live assignments | Article cards | Feed use is described for personal, non-commercial purposes. Keep only under that model and with link/attribution; otherwise license or remove. |
| ESPN | Soccer RSS; zero live matches | Configured only | ESPN explicitly allows displaying feed-provided content with direct links and attribution, but forbids modifying it or placing advertising in the RSS content. It contributes little German-squad coverage. |
| Sky Sports | Football RSS; zero live matches | Configured only | No sufficiently clear feed-republication grant was verified in this review. Link-only until clarified; low expected German lower-league value. |
| NewsAPI | Optional secret; allowlist for kicker, Goal, The Athletic, Bundesliga.com, Sportschau, Sport1, Sky Sports, ESPN, Transfermarkt, LigaInsider, and 11FREUNDE | Not active in today's deployment (`provider` is direct RSS) | The free Developer plan is forbidden in production. A paid plan is required, and NewsAPI does not grant missing publisher rights. Use as discovery only after plan and publisher-rights review. |
| LigaInsider | 534 Bundesliga player profile links, 18 club links, 90 stored team headlines; 13 injury-specific latest headlines in the availability snapshot | Player profile links; team headlines; injury source link | Valuable Bundesliga entity curation, but published terms limit website use to private purposes. Keep link-outs; request permission before expanding public headline extraction. |
| Transfermarkt | Search link for every player; club and 125 affected-player/profile links in availability data | Search/profile and availability links | Its terms explicitly prohibit bots, spiders, and screenscraping. Keep generated outbound links; do not expand automated headline/data extraction without permission. |

Relevant repository locations:

- RSS, OPML, matching, and NewsAPI configuration: [`generator/src/news.rs`](../generator/src/news.rs)
- NewsAPI secret injection: [`.github/workflows/pages.yml`](../.github/workflows/pages.yml#L48-L56)
- LigaInsider and Transfermarkt source config:
  [`config/external-sources.json`](../config/external-sources.json)
- Stored LigaInsider player/team links and team headlines:
  [`frontend/public/data/current-role-signals.json`](../frontend/public/data/current-role-signals.json)
- Stored availability source URLs and `latestNewsTitle` fields:
  [`frontend/public/data/current-availability-signals.json`](../frontend/public/data/current-availability-signals.json)

The frontend's availability type currently drops `latestNewsTitle`, even though
the local importer stores it. That field covers only a small subset of injured
Bundesliga players and should not be mistaken for a general player-news feed.

### Published terms consulted for the non-kicker sources

- [ARD Online terms](https://www.ard.de/die-ard/footer/nutzungsbedingungen-ard-online-100.html)
- [Bundesliga.com legal notice](https://www.bundesliga.com/en/bundesliga/info/legal-notices)
- [BBC terms, metadata and RSS section](https://downloads.bbc.co.uk/usingthebbc/bbc_terms_of_use_19September2022english.pdf)
- [Guardian RSS guidance](https://www.theguardian.com/help/feeds) and
  [terms](https://www.theguardian.com/help/terms-of-service)
- [ESPN RSS FAQ and terms](https://www.espn.com/espn/news/story?page=rssinfo)
- [NewsAPI terms](https://newsapi.org/terms)
- [LigaInsider terms](https://www.ligainsider.de/agb/)
- [Transfermarkt terms](https://www.transfermarkt.de/intern/anb)

## Recommended product: a squad research feed

Trying to manufacture ten direct player stories for every player will either
create false positives or require a licensed entity feed. A more honest and
useful design is a two-level research surface.

### Per-player page

Render up to 15 rows, newest first:

1. **Player mention** — a high-confidence match from a permitted feed.
2. **Club context** — current items from that player's official kicker club
   feed, clearly labelled as club news rather than a claim that the article is
   about the player.

Each row contains exactly:

- date;
- source;
- headline;
- direct external link;
- a small “player mention” or “club context” relation label.

If there are no direct matches, do not show an error-like empty state. Show the
current club context and the link to the complete kicker player archive.

### Squad page

Build one deduplicated “Latest squad developments” feed from the selected
squad's player mentions and club feeds. This is more likely to become the first
page a manager reads:

- newest 15–30 links across the whole squad;
- filters for player, club, injuries/availability, transfers, and source;
- direct-mention items ranked above club-context items;
- one URL shown once even when it relates to several squad players;
- explicit “last checked”, source health, and stale-state indicators.

## Matching and data-quality requirements

Replace the current boolean surname test with a contextual classification:

| Relation | Minimum evidence | Display |
| --- | --- | --- |
| Direct, high confidence | Exact full name in headline or teaser | Player mention |
| Direct, contextual | Unique surname plus current club/team-feed context; no common-word collision | Player mention |
| Provider entity relation | Stable documented provider player ID or licensed player feed | Player mention |
| Club only | Item came from current club feed without player evidence | Club context |
| Ambiguous | Surname only, duplicate full name, common word, or unrelated club | Do not attach to player |

Store the reason alongside each assignment, for example:

```json
{
  "relation": "player_exact_name",
  "matchedAlias": "Lars Lokotsch",
  "teamId": "tm-k00007659",
  "sourcePolicy": "kicker_rss_noncommercial"
}
```

Required regression fixtures include Fernandes, Schuster, Young, Sommer,
Pauli, Glück, duplicate Jonas Hofmann, and duplicate Marvin Schulz. Coverage
must be reported together with sampled precision; a high raw match count alone
is not a success metric.

## Implementation sequence and remaining governance work

### Phase 0 — trust repair (implemented)

- Remove surname-only assignments without club/entity context.
- Add the false-positive and duplicate-name regression cases.
- Distinguish “no match” from “news artifact failed or is stale”.
- Record only sources that actually succeeded, not every configured source.
- Validate the news schema, timestamps, permitted domains, and URLs in the
  build.

### Phase 1 — useful non-commercial link feed (implemented)

- Import the official kicker OPML, map every matching current club, and expose
  missing mappings. On 14 August the absent current feeds were Fortuna Köln,
  SV Meppen, SG Sonnenhof Großaspach, and Würzburger Kickers.
- Read current team and league feeds; do not retain vanished items as an archive.
- Match headline and permitted teaser text contextually.
- Output up to 15 direct/player-context rows plus a labelled club-context
  fallback.
- Render visible linked “Quelle www.kicker.de” attribution and no images.
- Add the squad-wide deduplicated research feed.

### Phase 2 — source governance (permission gate implemented; review ongoing)

- Add a source-policy registry: allowed fields, attribution text, commercial
  status, archive limit, and permission-review date.
- Publishers whose terms do not cover public use are disabled until explicit
  permission is recorded through the deployment gate.
- NewsAPI requires a separate production/publishing approval flag and an
  allowlist of approved publishers. A production plan, pagination, and retained
  proof of publisher rights remain operational prerequisites before enabling it.

### Phase 3 — exact player archive, only with agreement

Ask kicker for either:

- a licensed per-player entity feed/API;
- stable player identifiers and article relations; or
- written permission for the exact metadata-only presentation and retention
  window.

The request should state the narrow scope: up to 15 current items, title, date,
source, direct link, no article body, no image, daily refresh, no paywall
bypass, and clear kicker attribution.

## Acceptance criteria

The research feature is ready when:

- Lars Lokotsch shows current Ingolstadt context plus the direct kicker archive
  link even when he has no direct feed match;
- no known false-positive regression is assigned;
- duplicate names are resolved by ID/team context or left unassigned;
- every row has source, date, title, direct URL, and relation label;
- every source has an explicit policy decision and attribution rule;
- the feed is useful when a player has zero direct mentions;
- the UI distinguishes a healthy zero-result state from stale or failed
  ingestion;
- exact player-archive parity is not claimed without a kicker agreement.
