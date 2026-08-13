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

## Zeitliche Trennung und verbleibende Snapshot-Lücke

Eine Trainingszeile wird unmittelbar vor dem zugehörigen Spiel erzeugt. Rollierende Features sehen nur frühere Spiele. Für die Vorsaison-Prüfung werden alle Modelle ausschließlich mit noch älteren Saisons trainiert; reale Punkte fließen erst in die Auswertung ein. `previousSeasonLeague` bleibt für eine ganze Saison stabil, während `currentLeagueAppearances` den Erfahrungszuwachs innerhalb der Saison abbildet.

Die vorhandenen historischen Saisondateien sind jedoch keine archivierten Vorsaison-Marktsnapshots. Preise, Vereinszuordnung, `active` und `selectable` können daher einen späteren Wissensstand enthalten. Bis echte Entscheidungszeit-Snapshots vorliegen, ist die Validierung experimentell und nicht als vollständig leakage-sicher zu bezeichnen.

Die Featurefamilien umfassen:

- Start-, Einwechsel- und Einsatzquoten der letzten 3, 5 und 10 Mannschaftsspiele;
- bedingte historische Punkte als Starter beziehungsweise Einwechselspieler;
- Erfahrung, letzte Teilnahme, Ligawechsel, Position und Preisperzentil;
- Verein, Gegner, Heim/Auswärts sowie rollierende Vereins- und Gegnerform.

CatBoost verarbeitet die kategorialen Felder direkt. Für Spieler mit wenig verwertbarer Historie werden Rollenwahrscheinlichkeiten und bedingte Punkte in Richtung eines aus Liga, Position und Preisstufe gelernten Priors geschrumpft. In der Bundesliga verankert ein datierter LigaInsider-Topelf-Snapshot die finalen Produktionswahrscheinlichkeiten an der aktuellen Kaderhierarchie. Ein separater medizinischer Snapshot hat Vorrang: aktuelle Verletzung, Aufbautraining oder Nichtberücksichtigung sperrt einen Kandidaten für den erzeugten Kader; Sperren wirken spieltagsspezifisch. LigaInsider deckt die Bundesliga ab, Transfermarkt die 2. Bundesliga und 3. Liga. Quelle, Zeitpunkt und Ausschlüsse werden im veröffentlichten Artefakt auditiert.

Sobald aktuelle Saisonspiele abgeschlossen sind, werden sie für alle drei Ligen bis `latestRound` chronologisch wiedergegeben. Tatsächliche Starts, Einwechslungen und Nicht-Einsätze aktualisieren die kurzfristige Rollenwahrscheinlichkeit; fehlt ein Spieler in der kicker-Punktetabelle, obwohl sein Verein gespielt hat, gilt dies als DNP mit null Punkten. Punkte, Einsätze und Mannschaftsform aktualisieren die vorhandenen Modellfeatures. Bereits erzielte Punkte werden zwar als Ist-Werte veröffentlicht, aber für die neue Kaderauswahl auf null gesetzt. Die Zielfunktion beginnt damit beim nächsten noch nicht gespielten Spieltag und kann keine Spieler wegen rückwirkend bekannter Ergebnisse auswählen.

Der LigaInsider-Leistungsindex 2025/26 wird zusätzlich gegen die kicker-Saisonhistorie gematcht. Er bleibt ein unabhängiger Rangbenchmark im statischen Artefakt und wird nicht als zweites Punktesystem in die Prognose addiert.

Der CatBoost-Anteil an der Punkteprognose wird auf einer früheren Vorsaison aus der festen Menge 0/25/50/75/100 Prozent gewählt. Gemischt wird die bedingte Punktestärke bei einem Einsatz, nicht ein von der aktuellen Rolle losgelöster Saisonwert. Danach werden Start-, Einwechsel- und DNP-Wahrscheinlichkeiten angewendet. Eine zeitlich spätere, nicht zur Gewichtswahl verwendete Vorsaison dient als Champion-/Challenger-Gate. Wegen der oben beschriebenen Snapshot-Lücke ist „zeitlich getrennt“ hier bewusst nicht gleichbedeutend mit „vollständig leakage-sicher“. Auch bei Baselinegewicht 100 Prozent bleiben aktuelle Verfügbarkeit und der Mehrspieltags- und Winteroptimierer bindend.

## Optimierung

Das gemischt-ganzzahlige Modell enthält:

- `x[i]`: Spieler gehört zum 22er-Kader;
- `y[i,t]`: Spieler gehört an Spieltag `t` zur Elf;
- `z[f,t]`: Formation `f` wird an Spieltag `t` verwendet.

Es erzwingt Budget, 3/7/7/5-Kaderquoten, genau elf aufgestellte Kaderspieler und eine der sieben zulässigen Formationen je Spieltag. Die drei Torhüter müssen im Eröffnungs- und Winterkader jeweils demselben Verein angehören. So bleibt der Torwartplatz auch dann abgedeckt, wenn die Nummer eins verletzt oder gesperrt ausfällt; ein Vereinswechsel im Winter ist nur als vollständiger Tausch des Dreierpakets möglich. Aktuell medizinisch nicht verfügbare Spieler sind nicht wählbar; für die übrigen steckt das verbleibende Ausfallrisiko in den erwarteten Punkten. Für Feldspieler existiert in Interactive kein Vereinslimit. Die Transferzahl kommt aus der Regeln-Konfiguration; für 2026/27 sind es vier, für ältere Saisons drei. Optimiert wird die Summe der erwarteten Spieltagspunkte aller geplanten Elfen ab dem nächsten ungespielten Spieltag in beiden Saisonhälften. Ein numerisch winziger, datenabhängiger Tie-Break bevorzugt bei exakt gleicher Hauptzielfunktion die stärkere Bank; er kann keine schlechtere Hauptlösung auswählen.

HiGHS-Ergebnisse werden nur geschrieben, wenn ein zulässiger Incumbent existiert, alle Kaderinvarianten erfüllt sind und die MIP-Lücke höchstens 0,5 Prozent beträgt. Status und Lücke stehen im Artefakt.

## Validierung

Das Artefakt enthält für die letzte abgeschlossene Saison:

- Multiclass Log Loss und Brier Score für DNP/Einwechselung/Startelf;
- MAE und RMSE der erwarteten Punkte;
- empirische Abdeckung des P10–P90-Intervalls;
- projizierte und realisierte Punkte des vom Modell gewählten Interactive-Kaders.
- realisierte Punkte des festen v1-Champions, die Differenz und eine mögliche Rückfallentscheidung.

Diese Prüfung ist zeitlich getrennt, besitzt wegen der fehlenden historischen Marktsnapshots aber noch keine vollständig belegte Leakage-Sicherheit. Sie ist außerdem noch kein vollständiger Kickoff-Block-Simulator. Alle Spieltagsentscheidungen werden derzeit auf Rundenebene getroffen.

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
