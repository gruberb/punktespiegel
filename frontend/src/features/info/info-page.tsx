import { faqItems } from "../../config/site";
import type { Filters, InfoView, NavView } from "../../lib/navigation/scope";
import { viewHref } from "../../lib/navigation/scope";

export function InfoPage({ view, filters, onView }: { view: InfoView; filters: Filters; onView: (view: NavView) => void }) {
  const link = (target: NavView, label: string) => <a href={viewHref(target, filters)} onClick={(event) => { event.preventDefault(); onView(target); }}>{label}</a>;
  const copy: Record<InfoView, { eyebrow: string; title: string; intro: string }> = {
    about: {
      eyebrow: "Unabhängiges Datenprojekt",
      title: "Über Punktespiegel",
      intro: "Punktespiegel macht aktuelle und historische kicker-Noten und Punkte für Bundesliga, 2. Bundesliga und 3. Liga vergleichbar – ohne Anmeldung und ohne Paywall.",
    },
    methodology: {
      eyebrow: "Nachvollziehbar statt Blackbox",
      title: "Daten & Methodik",
      intro: "Vom öffentlichen Quellwert bis zur Tabelle im Browser: Hier ist dokumentiert, wie Punktespiegel Daten importiert, prüft und verdichtet.",
    },
    sources: {
      eyebrow: "Transparente Datenbasis",
      title: "Quellen",
      intro: "Punktespiegel trennt Wertungsdaten, Profil- und Verfügbarkeitssignale sowie Fußball-News. Externe Profile und Meldungen bleiben mit ihrer Originalquelle verlinkt.",
    },
    faq: {
      eyebrow: "Kurz erklärt",
      title: "Häufige Fragen",
      intro: "Antworten zum Datenumfang, zur Aktualisierung und zur Unabhängigkeit von Punktespiegel.",
    },
  };
  const page = copy[view];

  return <article className="info-page">
    <a className="info-back" href={viewHref("overview", filters)} onClick={(event) => { event.preventDefault(); onView("overview"); }}>← Zurück zum Überblick</a>
    <header className="info-hero fui-grid-paper">
      <p className="fui-kicker">{page.eyebrow}</p>
      <h1>{page.title}</h1>
      <p>{page.intro}</p>
    </header>

    {view === "about" && <>
      <div className="info-grid">
        <section className="info-card info-card-wide"><h2>Ein Überblick, der Details nicht versteckt</h2><p>Ranglisten führen direkt zu Spieler- und Mannschaftsprofilen. Saison- und Spieltagsfilter machen Entwicklungen sichtbar; die Tabelle zeigt Platzierungsverlauf, Formkurve und Kreuztabelle jeder Liga, auch für vergangene Saisons.</p></section>
        <section className="info-card"><h2>Drei Ligen, mehrere Saisons</h2><p>Bundesliga, 2. Bundesliga und 3. Liga verwenden dieselben Tabellen und Metriken. So lassen sich Positionen, Vereine und Spieltage konsistent vergleichen.</p></section>
        <section className="info-card"><h2>Unabhängig und transparent</h2><p>Punktespiegel ist ein unabhängiges Analyseprojekt und nicht mit kicker verbunden. Quellen, Datengrenzen und Aktualisierungswege werden offen beschrieben.</p></section>
      </div>
      <nav className="info-actions" aria-label="Punktespiegel entdecken">{link("players", "Spielerdaten durchsuchen →")}{link("table", "Tabellen öffnen →")}{link("teams", "Mannschaften ansehen →")}</nav>
    </>}

    {view === "methodology" && <>
      <ol className="method-steps">
        <li><span>01</span><div><h2>Öffentliche Daten importieren</h2><p>Der Build-Generator lädt die laufende Saison aus öffentlichen kicker-Quelldaten. Abgeschlossene Saisons bleiben unverändert, bis ein vollständiger Neuaufbau ausdrücklich gestartet wird.</p></div></li>
        <li><span>02</span><div><h2>Datenvertrag prüfen</h2><p>Ligen, Saisons, Spieltage, Spieler, Vereine und Wertungen werden normalisiert und vor jeder Veröffentlichung auf Vollständigkeit und Konsistenz geprüft.</p></div></li>
        <li><span>03</span><div><h2>Statische Saisonartefakte bauen</h2><p>Je Liga und Saison entsteht ein kompaktes JSON-Artefakt. Der Browser lädt nur die ausgewählte Saison; es gibt keinen Laufzeitserver, keine Datenbank und kein Benutzerkonto.</p></div></li>
        <li><span>04</span><div><h2>Profil- und Verfügbarkeitssignale ergänzen</h2><p>Externe Snapshots von LigaInsider und Transfermarkt ergänzen die Wertungen um Rollen-, Verfügbarkeits- und Vereinskontext. Jedes Signal bleibt mit Quelle und Stand ausgewiesen.</p></div></li>
        <li><span>05</span><div><h2>Spieltagskarten erzeugen und prüfen</h2><p>Für jeden Spieltag berechnet der Generator Kandidaten wie Tabellenführer, höchsten Sieg, torreichstes Spiel, größten Sprung oder punktbesten Spieler. Claude von Anthropic wählt daraus sechs Karten und vier Kennzahlen und formuliert Frage und Satz. Jede Zahl und jeder Vereins- oder Spielername wird anschließend gegen die berechneten Werte geprüft; besteht ein Text die Prüfung nicht oder ist das Modell nicht erreichbar, erscheint ein fester Vorlagentext.</p></div></li>
      </ol>
      <div className="info-grid">
        <section className="info-card"><h2>Aktualisierung</h2><p>Die laufende Saison wird täglich um 12:15 Uhr deutscher Zeit neu gebaut. Ein manueller Lauf kann zusätzlich alle abgeschlossenen Saisons aktualisieren.</p></section>
        <section className="info-card"><h2>Datengrenzen</h2><p>Externe Signale sind datierte Snapshots und können der Realität hinterherlaufen. Jede Angabe bleibt mit ihrer Originalquelle verlinkt.</p></section>
      </div>
    </>}

    {view === "sources" && <>
      <div className="info-grid">
        <section className="info-card"><h2>Noten, Punkte und Medien</h2><p>Spiel- und Wertungsdaten sowie Spielerfotos und Vereinslogos stammen aus öffentlichen kicker-Quellen. Spielerprofile verlinken zusätzlich auf die jeweiligen kicker-Seiten.</p></section>
        <section className="info-card"><h2>Profile und Verfügbarkeit</h2><p>Transfermarkt-Snapshots liefern Trainer, Kapitän, Transfers, Kaderbiografien und Karrierewerte. LigaInsider ergänzt Bundesliga-Rollen- und Topelf-Signale; medizinische Verfügbarkeit kommt je Liga aus LigaInsider oder Transfermarkt.</p></section>
        <section className="info-card"><h2>Spieltagskarten</h2><p>Die Texte der Spieltagskarten formuliert Claude von Anthropic ausschließlich auf Basis der von Punktespiegel berechneten Zahlen. Das Modell erhält keine externen Inhalte, nur Kennzahlen sowie Vereins- und Spielernamen.</p></section>
        <section className="info-card"><h2>Fußball-News</h2><p>Spielerbezogene Überschriften werden über NewsAPI oder öffentliche RSS-Feeds gesammelt. Jede Meldung öffnet die Originalquelle; Punktespiegel übernimmt keine redaktionelle Verantwortung für externe Inhalte.</p></section>
      </div>
      <nav className="source-directory" aria-label="Externe Quellen">
        <a href="https://www.kicker.de/games/startseite" target="_blank" rel="noreferrer external"><strong>kicker Games</strong><span>Punkteregeln der kicker Manager-Liga ↗</span></a>
        <a href="https://www.ligainsider.de/" target="_blank" rel="noreferrer external"><strong>LigaInsider</strong><span>Rollen, Topelf und Verfügbarkeit ↗</span></a>
        <a href="https://www.transfermarkt.de/" target="_blank" rel="noreferrer external"><strong>Transfermarkt</strong><span>Kader, Transfers, Marktwerte, Karriere und Ausfalllisten ↗</span></a>
        <a href="https://www.sportschau.de/fussball/" target="_blank" rel="noreferrer external"><strong>Sportschau</strong><span>Fußball-News und RSS ↗</span></a>
        <a href="https://www.bundesliga.com/de/bundesliga" target="_blank" rel="noreferrer external"><strong>Bundesliga.com</strong><span>Offizielle Liga-News ↗</span></a>
        <a href="https://www.skysports.com/football" target="_blank" rel="noreferrer external"><strong>Sky Sports</strong><span>Internationaler Fußball-Newsfeed ↗</span></a>
        <a href="https://www.espn.com/soccer/" target="_blank" rel="noreferrer external"><strong>ESPN Soccer</strong><span>Internationaler Fußball-Newsfeed ↗</span></a>
        <a href="https://www.bbc.com/sport/football" target="_blank" rel="noreferrer external"><strong>BBC Football</strong><span>Internationaler Fußball-Newsfeed ↗</span></a>
      </nav>
    </>}

    {view === "faq" && <section className="info-faq" aria-label="Häufige Fragen zu Punktespiegel">
      {faqItems.map((item) => <details key={item.question}><summary>{item.question}</summary><p>{item.answer}</p></details>)}
    </section>}
  </article>;
}
