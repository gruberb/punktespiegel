# Interactive-v2

Interactive-v2 trennt die Prognose einer Teilnahme von der Leistung bei einer Teilnahme und bewertet den 22er-Kader über alle 34 Spieltage. Die gesamte Pipeline läuft offline; veröffentlicht werden nur statische JSON-Artefakte.

## Datenfluss

```text
Saisonartefakte
  → chronologische Spieler-, Vereins- und Gegnerfeatures
  → DNP-/Einwechsel-/Startelf-Klassifikator
  → Positions- und Rollenregressoren für Mittelwert, P10, Median und P90
  → empirische Priors für dünne Historien
  → Spieler-Spieltag-Prognosen
  → Mehrspieltags-MILP
  → Interactive-v2-Artefakt
```

## Leakage-Schutz

Eine Trainingszeile wird unmittelbar vor dem zugehörigen Spiel erzeugt. Rollierende Features sehen nur frühere Spiele. Für die Vorsaison-Prüfung werden alle Modelle ausschließlich mit noch älteren Saisons trainiert; der vollständige Holdout-Spielplan wird aus dem Informationsstand vor Saisonbeginn prognostiziert. Reale Punkte fließen erst in die Auswertung ein.

Die Featurefamilien umfassen:

- Start-, Einwechsel- und Einsatzquoten der letzten 3, 5 und 10 Mannschaftsspiele;
- bedingte historische Punkte als Starter beziehungsweise Einwechselspieler;
- Erfahrung, letzte Teilnahme, Ligawechsel, Position und Preisperzentil;
- Verein, Gegner, Heim/Auswärts sowie rollierende Vereins- und Gegnerform.

CatBoost verarbeitet die kategorialen Felder direkt. Für Spieler mit wenig verwertbarer Historie werden Rollenwahrscheinlichkeiten und bedingte Punkte in Richtung eines aus Liga, Position und Preisstufe gelernten Priors geschrumpft.

Der CatBoost-Anteil an der Punkteprognose wird auf einer früheren Vorsaison aus der festen Menge 0/25/50/75/100 Prozent gewählt. Danach folgt eine unangetastete spätere Vorsaison als Champion-/Challenger-Gate: schlägt die gewählte Mischung dort das feste v1-Team nicht, bleibt für diese Liga der v1-Punkteforecast Champion. Auch in diesem Fall nutzt Interactive-v2 weiterhin den korrekten Mehrspieltags- und Winteroptimierer. Das verhindert, dass ein komplizierteres Modell allein wegen seiner Neuheit die eine reale Septemberentscheidung steuert.

## Optimierung

Das gemischt-ganzzahlige Modell enthält:

- `x[i]`: Spieler gehört zum 22er-Kader;
- `y[i,t]`: Spieler gehört an Spieltag `t` zur Elf;
- `z[f,t]`: Formation `f` wird an Spieltag `t` verwendet.

Es erzwingt Budget, 3/7/7/5-Kaderquoten, genau elf aufgestellte Kaderspieler und eine der sieben zulässigen Formationen je Spieltag. Ein Spieler mit weniger als 50 Prozent prognostizierter Einsatzwahrscheinlichkeit darf nicht in die geplante Elf gelangen; dieser strengere Wert wurde auf der Vorsaison vor dem finalen Holdout gewählt. In Interactive existiert kein Vereinslimit. Es gibt einen September- und einen Winterkader; beide sind regelkonform und unterscheiden sich um höchstens drei positionsgleiche Kauf-/Verkaufspaare. Optimiert wird die Summe der erwarteten Spieltagspunkte aller geplanten Elfen beider Saisonhälften. Ein numerisch winziger, datenabhängiger Tie-Break bevorzugt bei exakt gleicher Hauptzielfunktion die stärkere Bank; er kann keine schlechtere Hauptlösung auswählen.

## Validierung

Das Artefakt enthält für die letzte abgeschlossene Saison:

- Multiclass Log Loss und Brier Score für DNP/Einwechselung/Startelf;
- MAE und RMSE der erwarteten Punkte;
- empirische Abdeckung des P10–P90-Intervalls;
- projizierte und realisierte Punkte des vom Modell gewählten Interactive-Kaders.
- realisierte Punkte des festen v1-Champions, die Differenz und eine mögliche Rückfallentscheidung.

Diese Prüfung ist ein sauberer Vorsaison-Holdout. Sie ist noch kein vollständiger Kickoff-Block-Simulator. Die drei Winterwechsel werden bereits im Vorsaisonplan als zweite Optimierungsstufe berücksichtigt; im echten Winter muss die Stufe mit den dann bekannten Preisen, Verletzungen und Rollen erneut gerechnet werden. Alle Spieltagsentscheidungen werden derzeit auf Rundenebene getroffen.

## Reproduzieren

```bash
uv sync --frozen
npm run generate:recommendations
```

Für einen schnellen Pipeline-Test ohne erneuten Holdout:

```bash
npm run generate:recommendations:baseline
uv run --frozen python scripts/generate-interactive-v2.py \
  --skip-validation --iterations 10 --time-limit 30
```
