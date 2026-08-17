# Changelog

Alle wesentlichen Änderungen an Punktespiegel werden in dieser Datei dokumentiert.

## [1.16.0] – 2026-08-17

### Geändert

- Der Empfehlungsgenerator ist vom 3768-zeiligen Einzelskript in das Python-Paket `recommender/` mit klar getrennten Modulen umgebaut (Daten, Features, Prognose, Baseline-Ensemble, Optimierung, Artefakte, Validierung, Winterlauf, CLI). Die erzeugten Artefakte sind byte-identisch zur vorherigen Version; der Umbau wurde über den deterministischen Lauf (feste Seeds) gegen die eingecheckten Artefakte verifiziert.
- Liga-Regeln liegen jetzt als Konfiguration unter `config/recommender/` mit je einer Datei für Bundesliga, 2. Bundesliga und 3. Liga (Budgets, Ligastufe, Winterrunde, Transferlimits inklusive der ab 2026 geltenden vier Interactive-Transfers) sowie `defaults.json` für spielweite Kaderregeln und Modell-Voreinstellungen. Alle Felder sind dort dokumentiert.
- Der Generator läuft eigenständig: `uv run --frozen python -m recommender` mit `--data-dir`, `--config-dir`, `--recommendation-output-dir` und wiederholbarem `--league`-Filter; das Training nutzt weiterhin die Historie aller Saisons, sodass gefilterte Läufe dieselben Artefakte erzeugen wie vollständige.

### Entfernt

- `scripts/generate-interactive-v2.py` (ersetzt durch das Paket) und `scripts/generate-manager-recommendations.ts`: Der v1-Artefaktschreiber überschrieb im Sammelbefehl kurzzeitig die ausgelieferten Empfehlungen mit für die App unlesbaren modelVersion-1-Dateien, bevor der v2-Lauf sie erneut ersetzte. Das v1-Modell selbst bleibt als Ensemble-Baseline über `scripts/backtest-manager-baseline.ts` eingebunden.

## [1.15.0] – 2026-08-17

### Behoben

- Fantasy Team: „Punkte je Spieltag", die aktuellen Punkte der Kaderspieler und die Summe der erreichten Startelfpunkte werden jetzt im Browser aus den täglich importierten Saisondaten berechnet. Bisher stammten sie aus dem Empfehlungs-Artefakt, das der tägliche Datenlauf nicht neu erzeugt, wodurch neue Spieltage dort erst mit einer manuellen Neuberechnung der Kader auftauchten. Die Aufstellungen je Spieltag kommen weiterhin aus der Empfehlung; nur die erzielten Punkte werden live ergänzt.

## [1.14.0] – 2026-08-16

### Geändert

- Spiele des Spieltags: Torschützen und Vorlagengeber erscheinen als Portraitkarten mit Nachname und einer Mengen-Markierung bei Mehrfachtreffern (etwa „2ד). Spieler aus den Fantasy-Kadern (Classic oder Interactive) der laufenden Saison tragen einen violetten Rahmen samt Hinweis im Tooltip. Ein Spielverlauf mit Zwischenständen je Treffer ist mit der Quelldatenlage nicht möglich, da kicker nur Summen je Spieler liefert, keine Torreihenfolge.

## [1.13.0] – 2026-08-16

### Hinzugefügt

- Tabelle: Das neue Modul „Spiele des Spieltags" eröffnet die Seite mit allen Partien des gewählten Spieltags, gruppiert nach Anstoßzeit. Beendete Partien lassen sich aufklappen und zeigen Torschützen und Vorlagengeber je Team; Spieler- und Vereinsnamen führen direkt zu den Profilen.

### Geändert

- Die Tabelle ist neu geordnet: Spiele des Spieltags, Formtabelle, Platzierung je Spieltag, Kreuztabelle.

## [1.12.0] – 2026-08-16

### Hinzugefügt

- Topspieler: Die neue Spalte „Diese Saison" zeigt die bereits erzielten Punkte der laufenden Saison bis zum letzten importierten Spieltag, inklusive der neuen Sortierung „Punkte diese Saison". Einordnung, Schnitt und Trend basieren weiterhin auf abgeschlossenen Saisons.
- Überblick: Ein Umschalter „Gesamt / Nur Spieltag" samt Spieltag-Stepper blättert durch alle bereits gespielten Spieltage. Mannschaftswertung, Ranglisten, Positions- und Wertungstabellen sowie die Beste Elf folgen der Auswahl.

### Geändert

- Die Kreuztabelle zeigt alle Teams ohne innere Bildlaufleiste; Termin-Hinweise offener Paarungen nennen jetzt das Jahr, damit Rückrundenspiele nicht wie Vorsaison-Daten wirken.
- Fantasy-Team-Spieltage: Beendete Partien, deren kicker-Benotung noch aussteht, zeigen keine irreführenden 0-Punkte-Abzeichen mehr; die Punkte erscheinen, sobald der nächste Datenlauf die Benotung importiert.
- Die Betriebsdokumentation nennt die tatsächliche Laufzeit des täglichen Datenlaufs (12:15 UTC; der Zeitzonen-Schlüssel im GitHub-Cron wird ignoriert) und den zusätzlichen Lauf bei jedem Push.

## [1.11.0] – 2026-08-16

### Hinzugefügt

- Neue Seite „Tabelle" unter `/tabelle` für Bundesliga, 2. Bundesliga und 3. Liga: die echte Ligatabelle zu jedem Spieltag, berechnet aus den bereits ausgelieferten Saisondaten. Der Platzierungsverlauf zeichnet den Weg jedes Teams durch die Tabelle mit ligaspezifischen Auf- und Abstiegszonen; bis zu drei Teams lassen sich per Antippen hervorheben, Tabellenführer und stärkster Kletterer sind vorausgewählt. Die Formtabelle ergänzt Trendpfeile gegenüber dem Stand vor fünf Spieltagen, die letzten fünf Ergebnisse als beschriftete Chips samt Punktausbeute und eine Saison-Sparkline je Team. Die Kreuztabelle zeigt alle bisher gespielten Paarungen mit Ergebnis und die offenen mit Termin. Saison- und Spieltagswahl decken auch alle archivierten Saisons ab.
- Untere Tab-Navigation auf Mobilgeräten: Auf schmalen Bildschirmen ersetzt eine App-artige Leiste mit Symbolen die horizontal scrollende Pillen-Navigation, der Kopfbereich schrumpft auf eine Zeile.
- Spieler-Ansicht mit Zeitraum-Umschalter: „Bis Spieltag N" zeigt wie bisher kumulierte Werte, „Nur Spieltag N" zeigt Punkte, Note, Tore und Vorlagen des einzelnen Spieltags; alle Spalten bleiben sortierbar.
- Der Überblick enthält die „Beste Elf" als eigene Karte mit Umschalter zwischen Saisonelf und Spieltagself.

### Geändert

- Spielertabellen zeigen auf Telefonen nur noch den Nachnamen in leicht verkleinerter Schrift; zusammen mit schmaleren Namensspalten und reduzierten Mindestbreiten sind Punkte- und Wertspalten ohne langes horizontales Scrollen sichtbar.
- Die Seite „Historie" wurde aufgelöst: Tabellenstände und Spieltagsdaten liegen jetzt in der Tabelle beziehungsweise der Spieler-Ansicht, die Beste Elf im Überblick. Der Pfad `/historie` leitet dauerhaft auf `/tabelle` weiter; Navigation, Fußzeile, Sitemap und kanonische URLs verwenden die neue Seite.

## [1.10.0] – 2026-08-15

### Hinzugefügt

- Die Hauptnavigation verwendet feste, direkt teilbare Pfade wie `/spieler`, `/mannschaften`, `/historie`, `/topspieler` und `/fantasy-team`.
- Der Produktionsbuild erzeugt statische Einstiegspunkte und eine 404-Fallbackseite, damit diese Pfade auch auf GitHub Pages direkt geladen werden können.

### Geändert

- Das Fantasy Team speichert die gewählte Ansicht und den ausgewählten Spieltag in der URL und stellt beide Werte nach dem Öffnen eines Spielerprofils wieder her.
- Frühere Links mit `?view=...` werden automatisch auf die entsprechenden festen Pfade normalisiert; Sitemap und kanonische URLs verwenden die neue Struktur.

## [1.9.0] – 2026-08-14

### Hinzugefügt

- Das Fantasy Team besitzt jetzt getrennte Ansichten für Kaderübersicht und Spieltage. Die Spieltagsansicht lässt sich über alle Runden durchblättern, gruppiert Partien nach Anstoßzeit und ordnet sämtliche Classic- beziehungsweise Interactive-Kaderspieler ihrem tatsächlichen Vereinsspiel zu.
- Bereits verfügbare Spieltagspunkte erscheinen direkt an den Spielerporträts; standardmäßig öffnet sich der nächste anstehende Spieltag.

### Geändert

- Spieler- und Mannschaftstabellen verwenden auf Mobilgeräten kürzere Spaltenüberschriften, kleinere Zeilen, kompaktere Bilder sowie dichtere Such- und Filterelemente.

### Behoben

- Die Spieler- und Mannschaftsranglisten übernehmen auf schmalen Bildschirmen nicht mehr die übergroßen Desktop-Abmessungen und verursachen keinen seitenweiten horizontalen Überlauf mehr.

## [1.8.1] – 2026-08-14

### Geändert

- Die Medienbeobachtung zeigt ungefähr vier Meldungen und hält weitere Einträge in einer kompakten, intern scrollbaren Liste bereit.
- Redundante kicker-Quellennamen sowie Hinweise auf erfolgreich verfügbare Vereinsfeeds und den ergänzenden Vereinskontext wurden entfernt; relevante Fehler- und Verfügbarkeitshinweise bleiben sichtbar.

## [1.8.0] – 2026-08-14

### Hinzugefügt

- Bis zu 15 aktuelle, direkt verlinkte Meldungen je Spieler mit Datum, Quelle, Überschrift und einer klaren Kennzeichnung als Spielerbezug oder Vereinsumfeld.
- Kaderweite Nachrichtenübersicht im Fantasy Team, die direkte Spielernennungen und Vereinsmeldungen URL-genau zusammenführt.
- Offizielle kicker-Vereinsfeeds aus dem OPML-Katalog, Feedstatus je Quelle und Verein sowie sichtbare Hinweise für veraltete, fehlgeschlagene oder nicht verfügbare Feeds.
- Ausführlicher Recherchebericht zu kicker-Schutzmaßnahmen, RSS-Nutzungsbedingungen, vorhandenen Nachrichtenquellen und empfohlenem Ausbaupfad.

### Geändert

- Der Nachrichtencompiler verwendet einen versionierten v2-Datenvertrag, kontextbezogene Namens- und Vereinszuordnung, eine rollierende 14-Tage-Sicht und maximal 15 eindeutige Links.
- Nicht-kicker-Quellen und NewsAPI sind standardmäßig deaktiviert und erfordern eine explizite anbieterspezifische Veröffentlichungsfreigabe.
- Verifizierte kicker-Spielerarchive werden über stabile Spieler-IDs verlinkt; unbekannte Slugs verwenden eine klar bezeichnete, auf kicker beschränkte Suche.
- Kanonische URLs, Social-Media-Metadaten, Sitemap und Dokumentation verwenden `punktespiegel.org`.
- Interaktive Elemente zeigen konsistente Zeiger-Cursor; das Suchfeld verwendet ein CSS-gezeichnetes Suchsymbol.

### Behoben

- Globale Nachnamensuche ordnet allgemeine Wörter und gleichnamige Spieler nicht mehr fälschlich zu; bekannte Fälle wie Young, Sommer, Glück, Pauli und Fernandes sind regressionsgetestet.
- Ein fehlgeschlagener Nachrichtenlauf behält keine veralteten kicker-Inhalte mehr als vermeintlich aktuellen Stand.
- Build-Validierung prüft Nachrichten-IDs, Beziehungen, Vereinszuordnung sowie die Übereinstimmung von Ziel-URL, Domain und sichtbarer Quellenangabe.

### Sicherheit

- Geschützte kicker-Spielerseiten und interne APIs werden nicht automatisiert ausgelesen; dargestellt werden nur freigegebene RSS-Metadaten und direkte externe Links ohne Bilder oder Artikeltexte.

## [1.7.0] – 2026-08-14

### Hinzugefügt

- Eigene, direkt verlinkbare Seiten für „Über Punktespiegel“, Daten und Methodik, Quellen sowie häufige Fragen.
- Kompakte, websiteweite Fußzeile mit sieben internen Navigationslinks, Datenhinweis, GitHub- und Sitemap-Verweis.
- Separate Sitemap-Einträge und individuelle Metadaten für alle neuen Informationsseiten.

### Geändert

- Der große SEO-Daten-Hub wurde aus dem Überblick entfernt, damit die Startseite wieder auf Ranglisten und Wertungen fokussiert bleibt.
- Strukturierte FAQ-Daten werden nur noch auf der sichtbaren FAQ-Seite ausgegeben und entsprechen dort allen dargestellten Fragen.
- Der kompakte Mannschaftsfilter verwendet für Sturm jetzt analog zu GES, TW, ABW und MIT die Abkürzung ST.

### Behoben

- Die Mannschaftswertung nutzt die volle Höhe der benachbarten aktuellen Rangliste und zeigt elf vollständig ausgerichtete Einträge vor dem internen Scrollen.

## [1.6.0] – 2026-08-14

### Hinzugefügt

- Suchmaschinenoptimierte Seitentitel und Beschreibungen, kanonische URLs, Social-Media-Vorschauen, strukturierte WebSite-, WebApplication- und FAQ-Daten sowie Sitemap und robots.txt.
- Sichtbarer Daten-Hub mit internen Links, FAQ und weiterführenden Quellen zu kicker Manager Interactive und Classic, LigaInsider, Transfermarkt und Sportschau.
- Neues violettes Punktespiegel-Favicon, aktualisierte App-Icons und eine eigene Social-Media-Vorschaugrafik im Acorn-Stil.

### Geändert

- Die Startseite positioniert Punktespiegel klarer als aktuelle und historische Noten- und Punktedatenbank für Bundesliga, 2. Bundesliga und 3. Liga.

## [1.5.1] – 2026-08-14

### Geändert

- Helles Design ist für neue Besucher jetzt die Voreinstellung; eine bereits gespeicherte Auswahl bleibt erhalten.

### Behoben

- Auswahlmenüs verwenden in beiden Designs explizite Vorder- und Hintergrundfarben, damit Optionen auch im nativen Browser-Menü lesbar bleiben.

## [1.5.0] – 2026-08-14

### Hinzugefügt

- Persistentes helles und dunkles Farbschema mit direktem Umschalter in der Navigation.
- Wiederverwendbare Tabellen-, Seitenkopf- und Pfeilauswahl-Komponenten für einheitliche Größen, Abstände, Filter und responsive Darstellung.

### Geändert

- Vollständige Acorn-Neugestaltung für Desktop und Mobilgeräte mit größeren Spielerfotos, Vereinslogos, Punktwerten, Überschriften und Bedienelementen.
- Überblick und Historie verwenden konsolidierte, filterbare Tabellen mit begrenzten Ansichten und internem Scrollen; die Mannschaftswertung zeigt elf vollständige Vereine auf gleicher Höhe wie die aktuelle Rangliste.
- Mannschaftsprofile zeigen den Kader als einspaltige Tabelle, das Fantasy Team nutzt eine lesbarere Formation, Ersatzbank und Spieltagsauswertung, und „Top Players“ heißt nun „Topspieler“.
- Liga-, Saison-, Spieltags-, Positions- und Sortierauswahlen in den Seitenköpfen lassen sich einheitlich über Pfeile oder das Auswahlfeld bedienen.

### Behoben

- Abgeschnittene Mannschaftsansichten, kollidierende mobile Tabellenspalten, unlesbare Hover-Zustände und uneinheitliche Punktewerte im Saisonverlauf.

## [1.4.3] – 2026-08-12

### Hinzugefügt

- Echter Classic-Winterlauf, der den gekauften Septemberkader samt Starter-/Reserveslots sperrt, den aktuellen Saisonstand bis zum Cutoff einspielt und nur die drei legalen Wechsel für die verbleibenden Spieltage optimiert.
- Szenariobasierte Classic-Rekursentscheidung: Ein gemeinsamer Septemberkader wird gegen mehrere mögliche Winterzustände bewertet, ohne heute eine feste Transferliste vorzugeben.
- Rolling-Origin-Classic-Prüfung mit identischem Winterfenster für Challenger und v1-Vergleich sowie Solverstatus, MIP-Lücke und expliziten Kaderinvarianten in den Artefakten.

### Geändert

- Automatische Reserven verwenden `1 - product(1 - pDNP)`, behalten negative erwartete Punkte und verhindern kostenlose Starter-/Reserve-Umsortierungen im Winter.
- Classic-Punkte kombinieren den stabilen Saisonprior mit spieltagsspezifischen CatBoost-Residuen; Ligawechselmerkmale bleiben innerhalb einer Saison semantisch stabil.
- Interactive verwendet die saisonabhängigen Transferregeln mit vier Wechseln für 2026/27 und keinen harten 50-Prozent-Einsatzfilter.
- Alle sechs Kaderempfehlungen wurden lokal neu berechnet und als statische Dateien eingecheckt. CI und Pages trainieren oder optimieren weiterhin kein Modell.

### Sicherheit

- Historische Validierung wird ausdrücklich als experimentell gekennzeichnet, solange keine archivierten Entscheidungszeit-Snapshots für Preise, Vereinszuordnung und Marktwählbarkeit vorliegen.

## [1.4.2] – 2026-08-12

### Entfernt

- Winterwechsel-Plan und spieltagsspezifische Prognose-Aufstellungen aus der Fantasy-Team-Oberfläche; die zugrunde liegenden statischen Modelldaten bleiben unverändert erhalten.

## [1.4.1] – 2026-08-12

### Behoben

- CI und GitHub Pages validieren und veröffentlichen nun ausschließlich die eingecheckten statischen Kaderempfehlungen, statt das Offline-Modell während Build oder Deployment erneut zu trainieren.

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
[1.4.1]: https://github.com/gruberb/punktespiegel/releases/tag/v1.4.1
[1.4.2]: https://github.com/gruberb/punktespiegel/releases/tag/v1.4.2
[1.4.3]: https://github.com/gruberb/punktespiegel/releases/tag/v1.4.3
[1.5.0]: https://github.com/gruberb/punktespiegel/releases/tag/v1.5.0
[1.5.1]: https://github.com/gruberb/punktespiegel/releases/tag/v1.5.1
[1.6.0]: https://github.com/gruberb/punktespiegel/releases/tag/v1.6.0
[1.7.0]: https://github.com/gruberb/punktespiegel/releases/tag/v1.7.0
[1.8.0]: https://github.com/gruberb/punktespiegel/releases/tag/v1.8.0
[1.8.1]: https://github.com/gruberb/punktespiegel/releases/tag/v1.8.1
