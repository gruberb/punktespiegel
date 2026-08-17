# Recommender-Konfiguration

Der Empfehlungsgenerator (`recommender/`, Aufruf über `uv run --frozen python -m recommender`)
liest beim Start alle `*.json`-Dateien in diesem Verzeichnis. Jede Datei außer
`defaults.json` beschreibt genau eine Liga; `defaults.json` enthält spielweite
Kaderregeln und Modell-Voreinstellungen. Neue Ligen brauchen nur eine weitere
Datei, Code-Änderungen sind nicht nötig.

## Liga-Datei (`bundesliga.json`, `2-bundesliga.json`, `3-liga.json`)

| Feld | Bedeutung |
| --- | --- |
| `league.code` | Vierstelliger kicker-Liga-Code (`0001`, `0002`, `0003`). |
| `league.name` | Offizieller Anzeigename, z. B. `2. Bundesliga`. |
| `league.level` | Ligastufe für die Auf-/Abstiegskorrektur von Vorsaisonpunkten. |
| `winterStartRound` | Erster Spieltag der Winterphase (Transferfenster im Modell). |
| `classic.budgetM` | Classic-Budget in Mio. €. |
| `classic.maxFromTeam` | Maximale Spieler desselben Vereins im Classic-Kader. |
| `classic.transferLimit` | Erlaubte Classic-Wintertransfers. |
| `interactive.budgetM` | Interactive-Budget in Mio. €. |
| `interactive.transferLimit` | Erlaubte Interactive-Wintertransfers (Basiswert). |
| `interactive.transferLimitOverrides` | Liste `{fromSeason, limit}`; ab dem genannten Saison-Startjahr gilt das neue Limit. |

## `defaults.json`

| Feld | Bedeutung |
| --- | --- |
| `model.iterations` | CatBoost-Iterationen der finalen Modelle. |
| `model.validationIterations` | CatBoost-Iterationen der Holdout-Modelle. |
| `model.timeLimitSeconds` | HiGHS-Zeitlimit je Kaderoptimierung. |
| `model.classicResidualWeight` | Gewicht des CatBoost-Residuums über dem stabilen Classic-Prior (0 bis 1). |
| `model.classicScenarios` | Latente Winterszenarien für die Classic-Rekursbewertung (mindestens 2). |
| `baseline.command` | Kommando für das deterministische v1-Baseline-Modell (Node). |
| `baseline.cwdRelativeToRepoRoot` | Arbeitsverzeichnis des Baseline-Kommandos relativ zur Repo-Wurzel. |
| `squadRules.classic.rosterCounts` | Kadergrößen je Position (kicker-Regel, ligaweit gleich). |
| `squadRules.classic.starterCounts` | Startelfgrößen je Position (feste 4-4-2-Slots). |
| `squadRules.interactive.rosterCounts` | Interactive-Kadergrößen je Position. |

Alle `model.*`-Werte lassen sich pro Lauf per CLI-Flag übersteuern
(`--iterations`, `--validation-iterations`, `--time-limit`,
`--classic-residual-weight`, `--classic-scenarios`).

## Eigenständiger Betrieb

```
uv run --frozen python -m recommender \
  --data-dir /pfad/zu/daten \
  --config-dir /pfad/zu/configs \
  --recommendation-output-dir /pfad/fuer/artefakte \
  --league 0002
```

`--data-dir` erwartet die Struktur des statischen Datenverzeichnisses
(`catalog.json`, `seasons/`, Signal-Artefakte). `--league` ist wiederholbar und
begrenzt die Artefakterzeugung auf einzelne Ligen; das Modelltraining nutzt
weiterhin die Historie aller Saisons im Datenverzeichnis. Einzige externe
Abhängigkeit neben Python/uv ist Node (≥ 22) für das v1-Baseline-Ensemble.
