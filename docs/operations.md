# Betrieb und Datenpflege

## Lokale Entwicklung

Für UI-Arbeit reichen die mitgelieferten Snapshots:

```bash
npm ci
npm run dev
```

Für einen produktionsnahen statischen Server:

```bash
docker compose up --build
```

Es werden keine Umgebungsvariablen, Secrets oder Datenbankcontainer benötigt.

## Datencompiler

Laufende Saison aktualisieren und abgeschlossene Artefakte wiederverwenden:

```bash
cargo run --locked -p punktespiegel-data
```

Alle Ligen und Jahre neu von der Quelle laden:

```bash
cargo run --locked -p punktespiegel-data -- --refresh-all
```

Nützliche Optionen:

```text
--start-year 2022
--end-year 2026
--leagues 0001,0002,0003
--output frontend/public/data
--concurrency 8
```

Ein vollständiger Lauf ist für Erstaufbau oder historische Korrekturen gedacht. Der tägliche Lauf ruft nur die aktuelle und gegebenenfalls eine noch unvollständige Vorsaison ab.

Anschließend werden die sechs aktuellen Kaderempfehlungen aus genau diesem Datenstand erzeugt:

```bash
uv sync --frozen
npm run generate:recommendations
```

Der Befehl aktualisiert zuerst den statischen Bundesliga-Rollensnapshot, den medizinischen Snapshot aller drei Ligen von LigaInsider/Transfermarkt und `external-performance-benchmark.json` aus dem LigaInsider-Leistungsindex. Danach schreibt er je Liga und Modus ein versioniertes v2-JSON nach `frontend/public/data/recommendations`. Die Pipeline trainiert CatBoost offline, spielt abgeschlossene aktuelle Saisonspiele in den Produktionszustand ein, führt zeitlich getrennte Interactive- sowie Rolling-Origin-Classic-Prüfungen aus und löst die Kader mit HiGHS ab dem nächsten ungespielten Spieltag; dieser Schritt kann mehrere Minuten dauern. Die erzeugten JSON-Dateien werden geprüft und eingecheckt. CI, `npm run dev`, `npm run build` und das Pages-Deployment verwenden ausschließlich diese vorhandenen Artefakte und trainieren nicht erneut.

Der reale Classic-Winterlauf ist ein eigener Befehl. Er benötigt den tatsächlich gekauften Kader und schreibt standardmäßig nicht in das Produktionsverzeichnis; ein vollständiges Beispiel steht in [Classic-v2](classic-v2.md).

## CI

`.github/workflows/ci.yml` prüft bei Push, Pull Request und manuellem Start:

- Rust-Formatierung, Clippy und Tests,
- TypeScript-Typen und den Vite-Produktionsbuild,
- Compose-Konfiguration und den statischen Nginx-Build.

Lokal entsprechen dem:

```bash
cargo fmt --all --check
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo test --workspace --all-targets --locked
cargo run --locked -p punktespiegel-data -- --validate-only
npm ci
npm run typecheck
npm run build
docker compose config --quiet
docker compose build web
```

## Täglicher Pages-Build

`.github/workflows/pages.yml` läuft täglich um **12:15 Uhr in `Europe/Berlin`**. Der Lauf deckt damit sowohl die üblichen Montagswertungen als auch Donnerstagswertungen nach englischen Wochen ab. Er lässt sich unter **Actions → Daten aktualisieren und Pages bauen → Run workflow** wiederholen.

Der Workflow:

1. checkt das Repository aus,
2. aktualisiert die laufenden Saisondateien,
3. validiert die eingecheckten Classic- und Interactive-Empfehlungen,
4. baut React mit genau diesen statischen Empfehlungen,
5. lädt `frontend/dist` als Pages-Artefakt hoch,
6. ersetzt die Website nur nach einem vollständig erfolgreichen Build.

Es gibt kein `DATABASE_URL`-Secret. Der Workflow schreibt auch nicht zurück in den Branch und bläht deshalb die Git-Historie nicht täglich auf.

### Nachrichtenabgleich

Der gleiche tägliche Lauf aktualisiert `data/news.json`. Ohne weitere Einrichtung liest er ausschließlich die offiziellen Liga- und Team-RSS-Feeds von kicker und ordnet den kicker-Feedkatalog den Vereinen der aktuellen drei Ligen zu. Sportschau, Bundesliga.com, Sky Sports, ESPN, BBC Sport und The Guardian bleiben als mögliche Quellen konfiguriert, werden aber nicht öffentlich ausgegeben, solange keine anbieterspezifische Wiederverwendungsfreigabe dokumentiert ist. Der eingecheckte Rollensnapshot liefert unabhängig davon direkte LigaInsider-Links und aktuelle Mannschaftsthemen; er wird bewusst zusammen mit einer lokalen Neuberechnung der Empfehlungen aktualisiert.

Freigegebene zusätzliche RSS-Anbieter werden kommasepariert über `NEWS_APPROVED_RSS_SOURCES` aktiviert; akzeptiert werden die dokumentierten Feed-IDs, Quellnamen oder Domains. `NEWS_API_KEY` allein aktiviert keine öffentliche Ausgabe. Dafür muss zusätzlich `NEWS_API_PUBLISHING_APPROVED=true` gesetzt und jeder zugelassene Publisher in `NEWS_APPROVED_RSS_SOURCES` aufgeführt sein. Diese Schalter sind keine Rechteerteilung, sondern setzen eine zuvor dokumentierte Freigabe und einen produktionsgeeigneten NewsAPI-Tarif voraus.

Der Generator durchsucht Überschrift und Kurzbeschreibung der letzten 14 Tage. Spieler werden nur über ihren vollständigen Namen oder einen zusätzlich durch den aktuellen Verein abgesicherten Nachnamen zugeordnet; Teamfeed-Artikel bleiben als Vereinskontext gekennzeichnet. Gespeichert und angezeigt werden höchstens 15 eindeutige Links je Spieler oder Verein mit Datum, Quelle, Überschrift und Ziel-URL. Artikeltexte und Bilder werden nicht kopiert.

Jeder Abruf erhält in `feeds` einen Status (`ok`, `error` oder `unmapped`) samt Abrufzeit und Zahl der gelesenen beziehungsweise akzeptierten Einträge. Ein einzelner ausgefallener Feed stoppt den Lauf nicht. Jeder Lauf ersetzt den vorherigen RSS-Stand vollständig. Sind alle Quellen nicht erreichbar, schreibt der Generator ein frisches, leeres Nachrichtenartefakt mit Fehlerstatus, damit alte kicker-Inhalte nicht archiviert oder als aktuell ausgeliefert werden. Für einen separaten lokalen Abgleich genügt `cargo run --locked -p punktespiegel-data -- --news-only`.

Die kicker-Spielerarchive und internen APIs werden nicht gescrapt. Der Browser verlinkt bekannte stabile Archiv-Slugs direkt; bei nicht verifizierten Slugs bietet er eine klar bezeichnete, auf kicker beschränkte Suche an. Für kicker-RSS-Treffer müssen die sichtbare Quellenangabe und der direkte, ungeframte Link erhalten bleiben; Bilder werden nicht übernommen. Vor einer kommerziellen oder weitergehenden systematischen Nutzung ist eine Syndizierungsfreigabe einzuholen.

## GitHub Pages aktivieren

1. Repository **Settings → Pages** öffnen.
2. Unter **Build and deployment** die Quelle **GitHub Actions** wählen.
3. Den Workflow einmal manuell starten.
4. Die in der `github-pages`-Umgebung angezeigte URL prüfen.

Vite erzeugt relative Asset- und Datenpfade. Derselbe Build funktioniert deshalb auf einer Projekt-URL wie `/punktespiegel/`, auf einer eigenen Domain und im lokalen Nginx-Container.

## Saisonwechsel

Der tägliche Generator erkennt eine noch nicht vollständige Vorsaison anhand `latestRound < roundCount` und schließt sie weiter ab. Sobald sie vollständig ist, sollte einmal manuell mit `--refresh-all` gebaut und der aktualisierte Snapshot in den Branch übernommen werden. Danach wird diese Saison in allen täglichen Läufen unverändert wiederverwendet.

## Fehlerdiagnose

Typische Fehler stehen direkt im Actions-Schritt **Statische Daten aktualisieren**:

- HTTP-Fehler: Quelle vorübergehend nicht erreichbar; Workflow später erneut starten.
- Vertragsfehler: Quellformat hat sich geändert; Rust-Struktur und `schemaVersion` anpassen.
- unvollständige beste Elf: Für den ausgewählten Spieltag gibt es noch nicht genug gewertete Spieler; kein Pipelinefehler.
- fehlende Bilder: externer Mediendienst oder einzelne Bild-ID; Wertungsdaten bleiben intakt.

Ein fehlgeschlagener Lauf verändert die veröffentlichte Website nicht. Für ein Rollback genügt es, einen früheren Commit erneut über den Pages-Workflow zu bauen.
