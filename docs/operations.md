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

Der Befehl schreibt je Liga und Modus ein versioniertes v2-JSON nach `frontend/public/data/recommendations`. Die Pipeline trainiert CatBoost offline, führt zeitlich getrennte Interactive- sowie Rolling-Origin-Classic-Prüfungen aus und löst die Kader mit HiGHS; dieser Schritt kann mehrere Minuten dauern. Die erzeugten JSON-Dateien werden geprüft und eingecheckt. CI, `npm run dev`, `npm run build` und das Pages-Deployment verwenden ausschließlich diese vorhandenen Artefakte und trainieren nicht erneut.

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

Der gleiche tägliche Lauf aktualisiert `data/news.json`. Ohne weitere Einrichtung liest er die öffentlichen RSS-Feeds von kicker, Sportschau, Bundesliga.com, Sky Sports, ESPN, BBC Sport und The Guardian. Optional kann weiterhin ein `NEWS_API_KEY` als Actions-Secret hinterlegt werden; der Schlüssel wird nur im Generator verwendet und gelangt weder in den Browser noch in das veröffentlichte Artefakt.

Der Generator sucht Überschriften der letzten 14 Tage und speichert nur Datum, Quelle, Überschrift und Ziel-URL; Artikeltexte und Bilder werden nicht kopiert. Ein einzelner ausgefallener Feed stoppt den Lauf nicht. Sind alle Quellen nicht erreichbar, bleibt der letzte erfolgreich erzeugte Nachrichtenstand erhalten. Für einen separaten lokalen Abgleich genügt `cargo run --locked -p punktespiegel-data -- --news-only`.

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
