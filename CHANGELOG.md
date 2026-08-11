# Changelog

Alle wesentlichen Änderungen an Punktespiegel werden in dieser Datei dokumentiert.

## [Unreleased]

### Entfernt

- Unbelegte Prognose-, P10–P90- und Verfügbarkeitswerte aus Spielerpool und Datenvertrag.

### Hinzugefügt

- Vollständige Spielernamen, kontextbezogene kicker-Links und eine saisonübergreifende Punkteübersicht im Spielerprofil.
- Datenschutzfreundliche Seitenaufrufmessung mit Plausible Analytics.
- Saisonübergreifende Mannschafts- und Spielerprofile mit automatischer Auswahl der damaligen Liga.
- Saisonpunkte, historischer Marktwert und Punkte-pro-Million-Wert im Spielerprofil sowie eine Wert-Spalte im Spielerpool.
- Lokal ausgelieferte Noto-Sans-Variable-Font für Oberfläche, Überschriften und Zahlen.

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
