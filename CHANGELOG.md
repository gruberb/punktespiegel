# Changelog

Alle wesentlichen Änderungen an Punktespiegel werden in dieser Datei dokumentiert.

## [Unreleased]

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
