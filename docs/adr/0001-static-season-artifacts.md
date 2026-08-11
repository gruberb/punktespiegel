# ADR 0001: Statische Saisonartefakte statt PostgreSQL und Laufzeit-API

- Status: Angenommen
- Datum: 2026-08-10

## Kontext

Punktespiegel stellt ausschließlich öffentliche, nach Abschluss eines Spieltags weitgehend unveränderliche Wertungen dar. Alle UI-Abfragen sind deterministische Aggregationen nach Liga, Saison und Spieltag. Es gibt keine Konten, nutzerspezifischen Mannschaften, Schreibzugriffe oder Manageridentitäten.

Die frühere Axum/PostgreSQL-Architektur normalisierte rund 193.000 Spieler-Spiel-Wertungen zur Laufzeit und stellte ansichtsspezifische JSON-Endpunkte bereit. Sie erforderte jedoch einen dauerhaft betriebenen Rust-Prozess, eine Datenbank, Migrationen, Backups und einen Netzwerkpfad für den Scheduler. Diese Betriebskosten standen für den öffentlichen Leseanwendungsfall nicht im Verhältnis zum Nutzen.

Ein einzelnes JSON für alle Jahre wäre ebenfalls ungeeignet: Es würde bei jeder Auswahl unnötige Historie übertragen und jede Änderung der laufenden Saison den gesamten Cache entwerten.

## Entscheidung

Punktespiegel verwendet stattdessen:

- einen Rust-Datencompiler zur Build-Zeit,
- einen kleinen globalen Katalog,
- genau ein normalisiertes, komprimierbares JSON-Artefakt je Liga-Saison,
- React-Aggregationen im Browser,
- GitHub Pages oder einen statischen Nginx-Container als einzige Laufzeit.

Abgeschlossene Saisons werden unverändert wiederverwendet. Die laufenden Saisons werden täglich um 12:15 Uhr in `Europe/Berlin` neu erzeugt. Historische Korrekturen sind ein bewusster manueller Vollaufbau.

## Folgen

### Positiv

- Kein PostgreSQL, keine Schemas, Migrationen, Backups oder Datenbank-Secrets.
- Kein Axum-Server, Reverse Proxy oder dauerhaft laufender Importprozess.
- GitHub Pages kann die vollständige Anwendung hosten.
- Ein Pipelinefehler lässt das vorige konsistente Website-Artefakt aktiv.
- Saisonshards vermeiden einen großen Alljahres-Download; eine vollständige Saison komprimiert auf wenige hundert Kilobyte.
- Historische Snapshots sind einfach zu prüfen, zu versionieren und zu reproduzieren.

### Negativ

- Der Browser führt Aggregationen selbst aus und lädt beim ersten Saisonwechsel die vollständige Saisondatei.
- Änderungen am Datenvertrag erfordern einen vollständigen Neuaufbau der Artefakte.
- Sehr dynamische oder nutzerspezifische Schreibfunktionen würden später wieder einen Backend-Dienst benötigen.
- Aktuelle Daten werden erst mit dem nächsten erfolgreichen täglichen oder manuellen Build sichtbar.

## Verworfen

- **Eine globale JSON-Datei:** schlechtere Cache-Grenzen und unnötige Übertragung.
- **Ein vorberechnetes JSON je Ansicht und Spieltag:** starke Datenduplizierung und viele schwer konsistent zu haltende Dateien.
- **PostgreSQL plus statischer Export:** behält den größten Teil der Betriebs- und Migrationskosten ohne Laufzeitnutzen.
- **SQLite im Browser:** zusätzliche Datenbanklaufzeit und WASM-Gewicht für Aggregationen, die TypeScript direkt abbilden kann.
