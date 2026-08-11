# Punktespiegel

Punktespiegel ist ein statisches React-Dashboard für öffentliche Fußball- und Fantasy-Wertungen. Die Auswertungen basieren auf kicker-Daten und den Regeln der kicker Manager-Liga. Spieler, Mannschaften, historische Ranglisten, saisonübergreifende Top-Player-Signale, Spieltagsdetails und die beste Elf werden vollständig im Browser berechnet.

Es gibt keinen Laufzeitserver, keine Datenbank und keine Anmeldung. Rust wird ausschließlich als Build-Werkzeug eingesetzt: Der Generator prüft die öffentlichen Quelldaten und schreibt eine kompakte JSON-Datei je Liga und Saison. Dadurch kann die fertige Website direkt auf GitHub Pages laufen.

## Schnellstart

Die bereits erzeugten Daten liegen unter `frontend/public/data`.

```bash
npm ci
npm run dev
```

Die lokale Entwicklungsseite ist unter <http://localhost:5173> erreichbar.

Alternativ läuft die statische Website mit Docker:

```bash
docker compose up --build
```

Danach ist Punktespiegel unter <http://localhost:3000> erreichbar. `docker compose up` verwendet wegen `pull_policy: build` ebenfalls immer den lokalen Web-Build; `--build` macht diese Absicht nur ausdrücklich.

## Daten aktualisieren

Der normale Lauf lädt nur die laufende Saison neu und übernimmt vollständig abgeschlossene Saisons unverändert:

```bash
cargo run --locked -p punktespiegel-data
```

Ein vollständiger Neuaufbau aller unterstützten Saisons ist bewusst manuell:

```bash
cargo run --locked -p punktespiegel-data -- --refresh-all
```

Der Datenbestand ist nach Liga und Saison getrennt. Der Browser lädt nicht alle Jahre auf einmal. Die 15 enthaltenen Saisons benötigen zusammen ungefähr 54 MB im Repository; eine vollständige Saison wird mit üblicher HTTP-Kompression auf ungefähr 180–250 KB übertragen.

## GitHub Pages

`.github/workflows/pages.yml` erzeugt täglich um 12:15 Uhr deutscher Zeit die aktuelle Saison, baut React und stellt ausschließlich das fertige Pages-Artefakt unter <https://gruberb.github.io/punktespiegel/> bereit. Der Workflow benötigt weder PostgreSQL noch Repository-Secrets. Ein manueller Lauf kann bei Bedarf auch alle abgeschlossenen Saisons neu erzeugen.

Für die erstmalige Aktivierung muss in GitHub unter **Settings → Pages → Build and deployment** die Quelle **GitHub Actions** ausgewählt sein. Danach veröffentlichen Pushes auf `main` und der tägliche Datenlauf automatisch einen neuen konsistenten Stand.

## Prüfungen

```bash
cargo fmt --all --check
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo test --workspace --all-targets --locked
cargo run --locked -p punktespiegel-data -- --validate-only
npm run typecheck
npm run build
docker compose config --quiet
docker compose build web
```

## Aufbau

- `generator/`: Rust-Datencompiler und Quellverträge.
- `frontend/`: React-Anwendung und statischer Datenadapter.
- `frontend/public/data/catalog.json`: unterstützte Ligen und Saisons.
- `frontend/public/data/seasons/`: ein normalisierter Snapshot je Liga-Saison.
- `.github/workflows/`: CI sowie täglicher Pages-Datenbuild.
- `docs/`: Architektur, Betrieb und Architekturentscheidung.

Weitere Details:

- [Architektur](docs/architecture.md)
- [Betrieb und Datenpflege](docs/operations.md)
- [ADR: statische Saisonartefakte](docs/adr/0001-static-season-artifacts.md)
