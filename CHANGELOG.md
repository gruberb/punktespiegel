# Changelog

Alle wesentlichen Änderungen an Punktespiegel werden in dieser Datei dokumentiert.

## [1.4.0] – 2026-08-12

### Hinzugefügt

- Interactive-v2 mit chronologischem DNP-/Einwechsel-/Startelf-Modell, positions- und rollenabhängigen CatBoost-Punkteprognosen, Quantilen und empirischen Priors für neue Spieler.
- Zweistufiges Mehrspieltags-MILP in HiGHS, das September- und Winterkader mit höchstens drei positionsgleichen Wechseln über die beste zulässige Elf jedes Spieltags statt über eine feste Startelf und einen pauschalen Reservefaktor bewertet.
- Zeitlich getrennter Vorsaison-Holdout mit Rollen-Kalibrierung, Punktefehlern, Intervallabdeckung und realisierten Punkten des optimierten Kaders im Artefakt.
- Champion-/Challenger-Gate je Liga: Ein neuer Punkteforecast wird nur produktiv, wenn er nach vorheriger Gewichtswahl auch den unangetasteten späteren Holdout besteht.
- Classic-v2 mit exakter historischer Aktivierung einer positionsgebundenen Reserve, probabilistischer Reservebewertung und einem zweistufigen September-/Winterkader unter Budget-, Positions- und Drei-pro-Verein-Regeln.
- UI-Ansicht der geplanten Formation und Elf je Spieltag einschließlich Startwahrscheinlichkeit und P10–P90.

### Geändert

- Classic-v1 bleibt als unverändertes Vergleichsmodell und ligaweiser Rückfall erhalten; Classic- und Interactive-Artefakte verwenden Schema- und Modellversion 2.
- Normale Frontend-Builds verwenden vorhandene Empfehlungen. Nur der explizite Generierungsschritt trainiert das Offline-Modell erneut.

## [1.3.0] – 2026-08-11

### Hinzugefügt

- Build-Schritt für sechs statische Kaderempfehlungen: Bundesliga, 2. Bundesliga und 3. Liga jeweils für Classic und Interactive.
- Regressionstests für Budget, Formation, Positionsquoten, Vereinslimit und die veröffentlichten Empfehlungen aller sechs Kombinationen.

### Geändert

- Der Kaderplaner verwendet nun eine exakte dynamische Optimierung über den vollständigen kaufbaren Spielerpool statt einer begrenzten heuristischen Suche.
- Kaderempfehlungen werden nach dem Datenimport einmalig in CI oder lokal berechnet und anschließend als kleine, versionierte JSON-Artefakte geladen.
- Frontend-Tests sind jetzt Teil des regulären CI-Laufs.

## [1.2.2] – 2026-08-11

### Geändert

- Die Fantasy-Team-Startelf wird positionsweise in vier vollbreiten Zeilen statt in einem unausgewogenen 2×2-Raster dargestellt.

## [1.2.1] – 2026-08-11

### Geändert

- „Top Players“ verwendet nun ausschließlich den kaufbaren Spielerpool der neuesten Saison und ordnet ihn mit abgeschlossenen Leistungen vor dem Saisonstart ein.
- Der Spielerpool lässt sich nach Vorsaison, Saisonschnitt, Preis-Leistung, Trend und Marktwert sortieren; Spieler ohne importierte Historie bleiben sichtbar.

## [1.2.0] – 2026-08-11

### Hinzugefügt

- Neuer Bereich „Top Players“ mit den 15 punktstärksten Spielern je Position, Saisonschnitt, Erfahrung, jüngstem Trend und transparenten Hinweisen für Ligawechsler oder fehlende Historie.

### Geändert

- Die eigenständige „Beste Elf“ wurde mit dem bestehenden Spieltagsarchiv in der Historie zusammengeführt.
- Das Fantasy Team verwendet ein deutlich kompakteres Positionsraster und dichtere Spielerkarten.

## [1.1.0] – 2026-08-11

### Hinzugefügt

- Datenbasierte Fantasy-Team-Empfehlungen für Classic und Interactive in allen drei Ligen, einschließlich Vereins-, Positions-, Formations- und Budgetregeln.
- Ligastufen-Korrektur für Aufsteiger, Prognosekonfidenz sowie Gegenüberstellung von projizierten und tatsächlich erzielten Punkten.
- Kompakte Spieltagsauswertung der empfohlenen Startelf mit Positionssummen und aufklappbaren Einzelwerten.
- Automatische Nachrichtenübersicht in Spielerprofilen aus öffentlichen Fußball-RSS-Feeds und optional NewsAPI.
- Saisonübergreifende Mannschafts- und Spielerprofile mit damaligem Verein, Einsätzen, benoteten Spielen und automatischer Liga-Auswahl.
- Vollständige Spielernamen, kontextbezogene kicker-Links, historische Marktwerte und Punkte-pro-Million-Auswertungen.
- Automatische Vorauswahl des neuesten Spieltags, für den tatsächlich Daten vorliegen.
- Datenschutzfreundliche Seitenaufrufmessung mit Plausible Analytics.
- Lokal ausgelieferte Noto-Sans-Variable-Font für Oberfläche, Überschriften und Zahlen.

### Geändert

- Startelf und Ersatzbank werden im Fantasy Team gemeinsam dargestellt; die Spieltagsauswertung folgt darunter.
- Spielerprofile zeigen Nachrichten vor der nun vollbreiten Saisonübersicht.

### Entfernt

- Unbelegte Prognose-, P10–P90- und Verfügbarkeitswerte aus Spielerpool und Datenvertrag.

## [1.0.0] – 2026-08-10

### Hinzugefügt

- Statisches React-Dashboard für Bundesliga, 2. Bundesliga und 3. Liga.
- Saison-, Spieltags-, Spieler-, Mannschafts- und Best-Elf-Auswertungen.
- Verlinkte Spieler- und Mannschaftsprofile mit detaillierter Punkteaufschlüsselung.
- Rust-Datencompiler für öffentliche kicker-Daten und Wertungen der kicker Manager-Liga.
- Statische, nach Liga und Saison getrennte JSON-Snapshots ohne Laufzeitdatenbank.
- Automatische GitHub-Pages-Bereitstellung und tägliche Datenaktualisierung um 12:15 Uhr deutscher Zeit.
- Responsive Gestaltung, Web-App-Manifest sowie App- und Website-Icons.

### Geändert

- Der Überblick verwendet automatisch die neueste Saison mit veröffentlichten Spieltagsdaten.
- Alle öffentlichen Assets verwenden GitHub-Pages-kompatible relative Pfade.

[1.0.0]: https://github.com/gruberb/punktespiegel/releases/tag/v1.0.0
[1.1.0]: https://github.com/gruberb/punktespiegel/releases/tag/v1.1.0
[1.2.0]: https://github.com/gruberb/punktespiegel/releases/tag/v1.2.0
[1.2.1]: https://github.com/gruberb/punktespiegel/releases/tag/v1.2.1
[1.2.2]: https://github.com/gruberb/punktespiegel/releases/tag/v1.2.2
[1.3.0]: https://github.com/gruberb/punktespiegel/releases/tag/v1.3.0
[1.4.0]: https://github.com/gruberb/punktespiegel/releases/tag/v1.4.0
