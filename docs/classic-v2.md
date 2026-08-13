# Classic-v2

Classic-v2 optimiert die eine verbindliche Septemberentscheidung und bewertet dabei, dass im Winter auf neue Informationen reagiert werden kann. Das Ergebnis ist ein 15er-Kader mit fester 4-4-2-Startelf, genau einer Reserve je Position und höchstens drei Spielern desselben Vereins.

## Wertung und Winterfenster

Eine Reserve punktet nur, wenn mindestens ein Starter ihrer Position nicht eingesetzt wird. Auch bei mehreren Ausfällen derselben Position wird nur diese eine Reserve aktiviert; eine Einwechslung des Starters zählt als Einsatz und blockiert die Reserve. Historische Wertungen wenden diese Regel exakt an. Kandidaten werden in einer Best-Response-Schleife mit `1 - product(1 - pDNP)` neu bewertet; bei einem Zyklus gewinnt der exakt nachbewertete Kandidat mit den meisten Erwartungspunkten und der Solverstatus weist den Zyklus aus. Die DNP-Ereignisse werden dabei vorläufig als bedingt unabhängig angenommen. Negative erwartete Reservepunkte werden nicht abgeschnitten. Eine gemeinsame Rollen- und Punktesimulation bleibt die nächste Genauigkeitsstufe.

Im Vorsaisonmodus werden mehrere reproduzierbare, latente Winterzustände für Rollen, Verfügbarkeit und Leistungsniveau erzeugt. Alle Zustände teilen denselben Septemberkader, dürfen aber jeweils eine eigene regelkonforme Winterantwort wählen:

- höchstens drei positionsgleiche Verkäufe und Käufe;
- jeder Zugang übernimmt den Starter- oder Reserveslot des verkauften Spielers;
- unveränderte Spieler dürfen ihren Slot nicht kostenlos tauschen;
- Budget, Positionsquoten und Vereinslimit gelten auch im Winter.

Veröffentlicht wird deshalb keine verbindliche Transferliste. Das Artefakt enthält nur Verkaufskandidaten, Zielspieler und ihre Häufigkeit über die Szenarien. Die auf der Website gezeigte Empfehlung bleibt der Septemberkader.

## Echter Winterlauf

Der Wintermodus nimmt den tatsächlich gekauften Kader samt festen Slots entgegen, spielt alle Ergebnisse bis zum Cutoff in die rollierenden Zustände ein und prognostiziert nur die verbleibenden Spieltage:

```bash
uv run --frozen python scripts/generate-interactive-v2.py \
  --mode classic-winter \
  --league 0001 \
  --season-year 2026 \
  --through-round 14 \
  --opening-roster mein-kader.json \
  --output classic-winter-0001.json
```

Der Standard-Ausgabepfad liegt absichtlich nicht im Produktionsverzeichnis. Das Ergebnis muss geprüft werden, bevor es als statische Datei veröffentlicht wird.

## Champion-/Challenger-Schutz

Die Classic-Prüfung verwendet Rolling-Origin-Folds. In jedem Fold wird der Septemberkader ausschließlich aus älteren Saisons erzeugt. Am echten Wintercutoff werden die bis dahin bekannten Zustände wiederhergestellt und die drei Wechsel neu optimiert. Der v1-Vergleich erhält dasselbe Winterfenster und dieselbe exakte Reservewertung. Der Challenger wird nur eingesetzt, wenn er aggregiert gewinnt und mindestens die Hälfte der Folds gewinnt.

Historische Preis-, Aktiv- und Auswahlfelder liegen derzeit nicht als echte Entscheidungszeit-Snapshots vor. Die Rolling-Ergebnisse sind deshalb ausdrücklich `experimental` und dürfen noch nicht als leakage-sicher bezeichnet werden. Der Generator vermerkt diese Einschränkung im Artefakt. Für eine belastbare Freigabe müssen Vorsaison- und Wintersnapshots archiviert werden.

Die Entscheidung ist im Artefakt unter `model.deploymentModel` sichtbar. `scenario-recourse-v2` bezeichnet den neuen Optimierer; `fixed-v1-champion` den konservativen Rückfall.

## Erzeugung

```bash
npm run generate:recommendations
```

Der Befehl schreibt Classic und Interactive für alle drei Ligen nach `frontend/public/data/recommendations/`.
