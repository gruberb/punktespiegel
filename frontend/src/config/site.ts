export const siteBaseUrl = "https://punktespiegel.org/";

export const faqItems = [
  {
    question: "Welche Daten zeigt Punktespiegel?",
    answer: "Punktespiegel zeigt kicker-Noten, Managerpunkte, Tore, Vorlagen und weitere Wertungen nach Spieler, Verein, Position, Saison und Spieltag.",
  },
  {
    question: "Welche Ligen sind enthalten?",
    answer: "Punktespiegel deckt die Bundesliga, die 2. Bundesliga und die 3. Liga ab.",
  },
  {
    question: "Wie aktuell sind die Daten?",
    answer: "Die laufende Saison wird täglich neu importiert und veröffentlicht. Abgeschlossene Saisons bleiben unverändert, sofern kein vollständiger manueller Neuaufbau angestoßen wird.",
  },
  {
    question: "Wie entstehen die Spieltagskarten im Überblick?",
    answer: "Der tägliche Build berechnet alle Zahlen eines Spieltags aus den kicker-Daten. Ein Sprachmodell (Claude von Anthropic) wählt daraus die auffälligsten Kennzahlen aus und formuliert Frage und Satz. Jede Zahl und jeder Vereins- oder Spielername im Text wird gegen die berechneten Werte geprüft; besteht ein Text die Prüfung nicht, erscheint ein fester Vorlagentext.",
  },
  {
    question: "Was zeigen die Mannschafts- und Spielerprofile?",
    answer: "Mannschaftsprofile bündeln Trainer, Kapitän, Kader nach Position, mögliche Startelf, Transfers und den Saisonverlauf. Spielerprofile zeigen Biografie, Marktwert, Vereinskarriere, Einsätze, Tore, Vorlagen, Noten und Punkteaktionen.",
  },
  {
    question: "Brauche ich ein Konto?",
    answer: "Nein. Punktespiegel läuft als statische Website ohne Anmeldung, Benutzerkonto oder Laufzeitdatenbank.",
  },
  {
    question: "Ist Punktespiegel ein offizielles kicker-Angebot?",
    answer: "Nein. Punktespiegel ist ein unabhängiges Analyseprojekt und nicht mit kicker verbunden. Die Datenbasis und externe Quellen werden transparent ausgewiesen.",
  },
];
