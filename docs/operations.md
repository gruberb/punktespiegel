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
3. baut React,
4. lädt `frontend/dist` als Pages-Artefakt hoch,
5. ersetzt die Website nur nach einem vollständig erfolgreichen Build.

Es gibt kein `DATABASE_URL`-Secret. Der Workflow schreibt auch nicht zurück in den Branch und bläht deshalb die Git-Historie nicht täglich auf.

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
