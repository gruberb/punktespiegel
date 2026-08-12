# Classic-v2

Classic-v2 optimiert die eine verbindliche Septemberentscheidung zusammen mit der einmaligen Winteroption. Das Ergebnis ist ein 15er-Kader mit fester 4-4-2-Startelf, genau einer Reserve je Position und höchstens drei Spielern desselben Vereins.

## Wertung und Winterfenster

Eine Reserve punktet nur, wenn mindestens ein Starter ihrer Position nicht eingesetzt wird. Auch bei mehreren Ausfällen derselben Position wird nur diese eine Reserve aktiviert; eine Einwechslung des Starters zählt als Einsatz und blockiert die Reserve. Historische Holdout-Wertungen wenden diese Regel exakt an. In der Vorsaisonoptimierung wird ihre erwartete Aktivierung aus den DNP-Wahrscheinlichkeiten der Starter geschätzt.

Das gemischt-ganzzahlige Modell kennt zwei Kaderzustände:

- September: der endgültig zu kaufende 15er-Kader;
- Winter: ein regelkonformer Folgekader ab Spieltag 15, 17 beziehungsweise 19;
- zwischen beiden Zuständen: höchstens drei positionsgleiche Verkäufe und Käufe.

Der veröffentlichte Winterplan ist eine heutige Handlungsabsicht, keine Verpflichtung. Im Winter soll die Pipeline mit den dann aktuellen Preisen, Verletzungen, Rollen und Ergebnissen erneut laufen.

## Champion-/Challenger-Schutz

Der neue zweistufige Optimierer wird je Liga auf einer zeitlich späteren, unangetasteten Vorsaison gegen das feste v1-Team geprüft. Nur wenn der Challenger mindestens gleich viele realisierte Punkte erzielt, wird er für die nächste Saison veröffentlicht. Andernfalls bleibt der v1-Kader als Champion aktiv. Dadurch ersetzt Modellkomplexität nicht automatisch die einzige echte Septemberentscheidung.

Die Entscheidung ist im Artefakt unter `model.deploymentModel` sichtbar. `two-stage-v2` bezeichnet den neuen Optimierer; `fixed-v1-champion` den validierten Rückfall ohne vorab festgelegten Winterwechsel.

## Erzeugung

```bash
npm run generate:recommendations
```

Der Befehl schreibt Classic und Interactive für alle drei Ligen nach `frontend/public/data/recommendations/`.
