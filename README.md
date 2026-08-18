# Punktespiegel

Punktespiegel ist ein statischer Statistik-Hub für Bundesliga, 2. Bundesliga und 3. Liga. Öffentliche kicker-Daten liefern Noten, Punkte und Spieltage; datierte Transfermarkt-Snapshots ergänzen Mannschaftsprofile, Kader, Transfers und Spielerbiografien. Tabellen, Profile und historische Vergleiche werden aus statischen JSON-Artefakten im Browser berechnet.

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

Der lokale Empfehlungsgenerator bleibt als separates Werkzeug erhalten, seine Ergebnisse werden jedoch nicht mehr von der Website ausgeliefert. Dafür werden [uv](https://docs.astral.sh/uv/) und Python 3.13 benötigt; `uv` installiert die exakt gesperrten CatBoost- und HiGHS-Abhängigkeiten selbst:

```bash
uv sync --frozen
npm run generate:recommendations
```

Vor der Berechnung werden aktuelle Rollen- und Ausfallsignale von LigaInsider beziehungsweise Transfermarkt sowie ein unabhängiger LigaInsider-Vorsaisonbenchmark aktualisiert. Die v2-Pipeline schreibt Classic- und Interactive-Ergebnisse nach `recommendations/`; das verschobene v1-Modell unter `scripts/` bleibt nur als Ensemble-Baseline erhalten. `npm run dev`, CI und `npm run build` laden diese lokalen Empfehlungsergebnisse nicht.

Aktuelle Vereins- und Spielerprofile werden bewusst als langsamer, zwischengespeicherter Snapshot erzeugt:

```bash
npm run generate:club-profiles
```

Der Import fragt Transfermarkt mit eindeutigem User-Agent, lokalem HTTP-Cache und höchstens ungefähr einer Anfrage pro Sekunde ab. Er schreibt `club-profiles/` und `player-careers/` für die aktuelle Saison. Nicht eindeutig zuordenbare Namen werden im Lauf ausgegeben und können in `config/transfermarkt-overrides.json` fest verdrahtet werden.

## GitHub Pages

`.github/workflows/pages.yml` erzeugt täglich um 12:15 Uhr deutscher Zeit die aktuelle Saison, baut React und stellt ausschließlich das fertige Pages-Artefakt unter <https://punktespiegel.org/> bereit. Der Workflow benötigt weder PostgreSQL noch Repository-Secrets. Ein manueller Lauf kann bei Bedarf auch alle abgeschlossenen Saisons neu erzeugen.

Für die erstmalige Aktivierung muss in GitHub unter **Settings → Pages → Build and deployment** die Quelle **GitHub Actions** ausgewählt sein. Danach veröffentlichen Pushes auf `main` und der tägliche Datenlauf automatisch einen neuen konsistenten Stand.

## Prüfungen

```bash
cargo fmt --all --check
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo test --workspace --all-targets --locked
cargo run --locked -p punktespiegel-data -- --validate-only
npm run typecheck
npm run test:club-profiles
npm run test:recommender-baseline
npm run build
docker compose config --quiet
docker compose build web
```

## Aufbau

- `generator/`: Rust-Datencompiler und Quellverträge.
- `frontend/`: React-Anwendung und statischer Datenadapter.
- `frontend/public/data/catalog.json`: unterstützte Ligen und Saisons.
- `frontend/public/data/seasons/`: ein normalisierter Snapshot je Liga-Saison.
- `frontend/public/data/club-profiles/`: aktuelle Kader-, Trainer-, Kapitäns- und Transferdaten je Liga.
- `frontend/public/data/player-careers/`: aktuelle Karriereeinsätze, Tore und Vorlagen je Spieler und Verein.
- `frontend/public/data/current-role-signals.json`: statischer Bundesliga-Snapshot für aktuelle Topelf-, Spieler- und Vereinsquellen.
- `frontend/public/data/current-availability-signals.json`: datierter Ausfallsnapshot für Bundesliga, 2. Bundesliga und 3. Liga.
- `frontend/public/data/external-performance-benchmark.json`: unabhängiger Vergleich der LigaInsider-Leistungsrangfolge 2025/26 mit den historischen kicker-Punkten.
- `recommendations/`: lokale Classic- und Interactive-Ergebnisse; nicht Teil des Website-Artefakts.
- `recommender/`: der lokale Empfehlungsgenerator als Python-Paket mit rollenabhängiger Prognose, szenariobasierter Classic-Rekursentscheidung, echtem Winterlauf und Mehrspieltags-MILPs; das deterministische v1-Vergleichsmodell (`scripts/manager-model.ts` über `scripts/backtest-manager-baseline.ts`) bleibt als Ensemble-Baseline eingebunden.
- `config/recommender/`: Liga-Konfigurationen (Bundesliga, 2. Bundesliga, 3. Liga) und Modell-Voreinstellungen, dort dokumentiert.
- `scripts/fetch-current-role-signals.py`: lokal ausgeführter, fail-closed Import der LigaInsider-Topelf, Vereinsthemen und medizinischen Verfügbarkeit aus LigaInsider/Transfermarkt.
- `scripts/fetch-club-profiles.py`: rate-limitierter Transfermarkt-Import für Vereinsprofile und Karrierewerte mit lokalem HTTP-Cache.
- `pyproject.toml` und `uv.lock`: reproduzierbare Offline-Modellumgebung.
- `.github/workflows/`: CI sowie täglicher Pages-Datenbuild.
- `docs/`: Architektur, Betrieb und Architekturentscheidung.

Weitere Details:

- [Architektur](docs/architecture.md)
- [Classic-v2](docs/classic-v2.md)
- [Interactive-v2](docs/interactive-v2.md)
- [Betrieb und Datenpflege](docs/operations.md)
- [ADR: statische Saisonartefakte](docs/adr/0001-static-season-artifacts.md)
