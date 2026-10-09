import { Notice } from "@gruberb/fun-ui";
import { newsAttribution, newsSourceLabel } from "../../lib/data/news";
import type { NewsArticle, PlayerDetail } from "../../types/models";
import { formatNewsDate } from "../../utils/format";

export function PlayerNewsSection({ news, kickerNewsUrl, kickerNewsDirect }: {
  news: PlayerDetail["news"];
  kickerNewsUrl: string;
  kickerNewsDirect: boolean;
}) {
  const visibleArticles = [...news.articles, ...news.clubArticles]
    .sort((left, right) => Date.parse(right.publishedAt) - Date.parse(left.publishedAt));
  const emptyMessage = news.status === "failed"
    ? `Der automatische Nachrichtenimport konnte nicht geladen werden. ${kickerNewsDirect ? "Das kicker-Spielerarchiv ist über den Link oben weiterhin direkt erreichbar." : "Über den Link oben kann gezielt nach der kicker-Spielerseite gesucht werden."}`
    : news.status === "stale"
      ? `Im letzten verfügbaren, derzeit veralteten Datenstand gibt es keine passende Meldung. ${kickerNewsDirect ? "Das kicker-Spielerarchiv ist über den Link oben erreichbar." : "Über den Link oben kann gezielt bei kicker gesucht werden."}`
      : `Der Nachrichtenfeed wurde erfolgreich geprüft, enthält aber aktuell keinen sicheren Spielerbezug. ${kickerNewsDirect ? "Das kicker-Spielerarchiv ist über den Link oben erreichbar." : "Über den Link oben kann gezielt bei kicker gesucht werden."}`;
  return (
    <section className="player-news" aria-labelledby="player-news-title">
      <div className="section-copy news-heading">
        <div><p className="fui-kicker">Medienbeobachtung</p><h3 id="player-news-title">In den Nachrichten</h3></div>
        <div className="news-actions">
          {news.generatedAt && <span>Stand {formatNewsDate(news.generatedAt)}</span>}
          <a href={kickerNewsUrl} target="_blank" rel="noreferrer">{kickerNewsDirect ? "Alle kicker-Spieler-News" : "Spieler-News bei kicker suchen"} ↗</a>
        </div>
      </div>
      <NewsHealthNotice status={news.status} feedSummary={news.feedSummary} />
      <ClubFeedStatusNotice status={news.clubFeedStatus} />
      {visibleArticles.length
        ? <NewsList articles={visibleArticles} />
        : <p className={`news-empty news-empty--${news.status}`}>{emptyMessage}</p>}
    </section>
  );
}

function NewsHealthNotice({ status, feedSummary, includeUnmapped = false }: Pick<PlayerDetail["news"], "status" | "feedSummary"> & { includeUnmapped?: boolean }) {
  if (status === "healthy" && feedSummary.error === 0 && (!includeUnmapped || feedSummary.unmapped === 0)) return null;
  const issues = [
    feedSummary.error > 0 ? `${feedSummary.error} Quelle${feedSummary.error === 1 ? "" : "n"} nicht erreichbar` : "",
    includeUnmapped && feedSummary.unmapped > 0 ? `${feedSummary.unmapped} Feed${feedSummary.unmapped === 1 ? "" : "s"} keinem Verein zugeordnet` : "",
  ].filter(Boolean).join("; ");
  const message = status === "failed"
    ? `Beim letzten Lauf war keine nutzbare Nachrichtenquelle verfügbar${issues ? `: ${issues}` : ""}.`
    : status === "stale"
      ? `Der Nachrichtenstand ist älter als 36 Stunden${issues ? `; zusätzlich: ${issues}` : ""}.`
      : `Der Datenstand ist aktuell, jedoch sind einzelne Quellen eingeschränkt: ${issues}.`;
  return <Notice tone={status === "failed" ? "error" : status === "stale" ? "warn" : "neutral"}>{message}</Notice>;
}

function ClubFeedStatusNotice({ status }: { status: PlayerDetail["news"]["clubFeedStatus"] }) {
  if (status === "ok" || status === "unknown") return null;
  const label = status === "error" ? "Abruffehler" : "Nicht verfügbar";
  const message = status === "error"
    ? "Der Vereinsfeed konnte beim letzten Lauf nicht gelesen werden; es wird kein neuer Vereinskontext ergänzt."
    : "Für diesen Verein ist derzeit kein Vereinsfeed im kicker-Feedkatalog vorhanden.";
  return <Notice tone={status === "error" ? "error" : "neutral"} title={`Vereinsfeed: ${label}.`}>{message}</Notice>;
}

function NewsList<Article extends NewsArticle>({ articles, context }: {
  articles: Article[];
  context?: (article: Article) => string;
}) {
  return (
    <ol className="news-list news-list--scroll">
      {articles.map((article) => {
        const articleRelation = article.relation ?? "automatic";
        const relationLabel = articleRelation === "team" ? "Vereinsumfeld" : articleRelation === "player" ? "Spielerbezug" : "Automatisch zugeordnet";
        const sourceLabel = newsSourceLabel(article);
        return (
          <li key={article.url}>
            <a href={article.url} target="_blank" rel="noreferrer">
              <span className="news-meta">
                <time dateTime={article.publishedAt}>{formatNewsDate(article.publishedAt)}</time>
                {sourceLabel && <b>{sourceLabel}</b>}
                <em className={`news-relation ${articleRelation}`} title={article.matchedAlias ? `Erkannter Name: ${article.matchedAlias}` : undefined}>{relationLabel}</em>
              </span>
              <span className="news-article-copy"><strong>{article.title}</strong>{context && <small>{context(article)}</small>}</span>
              <small className="news-attribution">{newsAttribution(article)} ↗</small>
            </a>
          </li>
        );
      })}
    </ol>
  );
}
