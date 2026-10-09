import { useEffect } from "react";
import { faqItems, siteBaseUrl } from "../config/site";
import { pathForView } from "../lib/navigation/routes";
import type { Filters, View } from "../lib/navigation/scope";
import { isInfoView } from "../lib/navigation/scope";
import type { Catalog } from "../types/models";

export function usePageMetadata({ catalog, filters, matchId, playerId, teamId, view, seasonName: selectedSeasonName }: { catalog: Catalog | null; filters: Filters; matchId: string | null; playerId: string | null; teamId: string | null; view: View; seasonName: string | undefined }) {
  useEffect(() => {
    const leagueName = catalog?.leagues.find((league) => league.code === filters.league)?.name ?? "Bundesliga";
    const seasonName = selectedSeasonName ?? filters.season;
    const seo = ({
      matchday: {
        title: `Spieltag ${filters.round} ${leagueName} ${seasonName}: Ergebnisse & Noten`,
        description: `Alle Ergebnisse von Spieltag ${filters.round} der ${leagueName} ${seasonName} mit Spieler des Tages, Elf des Tages, Torschützen, Scorern und Notenbesten.`,
      },
      overview: {
        title: `Tabelle & Formkurve ${leagueName} ${seasonName}`,
        description: `Tabelle der ${leagueName} ${seasonName} nach Spieltag: Platzierungsverlauf, Form der letzten fünf Spiele und Kreuztabelle aller Paarungen.`,
      },
      players: {
        title: `kicker Noten & Managerpunkte ${leagueName}`,
        description: `Spieler, kicker-Noten, Managerpunkte, Tore, Vorlagen und Marktwerte der ${leagueName} ${seasonName} für die gesamte Saison durchsuchen.`,
      },
      player: {
        title: `Spielerprofil: Daten, Noten & Punkte ${leagueName}`,
        description: `Alter, Nationalität, Größe, Marktwert, Vereinskarriere, Einsätze, Tore, kicker-Noten und Punkte für Spieler der ${leagueName}.`,
      },
      teams: {
        title: `Mannschaftswertung ${leagueName}: kicker Punkte`,
        description: `Kicker Managerpunkte aller Mannschaften der ${leagueName} ${seasonName} vergleichen und Kader, Positionen sowie Spiele öffnen.`,
      },
      team: {
        title: `Mannschaftsprofil: Kader & Transfers ${leagueName}`,
        description: `Trainer, Kapitän, Kader nach Position, mögliche Startelf, Transfers, Spielerpunkte und Saisonverlauf für Mannschaften der ${leagueName}.`,
      },
      match: {
        title: `Spielbericht ${leagueName}: Noten, Tore & Aufstellung`,
        description: `kicker-Noten, Torschützen, Vorlagen, Aufstellung und Managerpunkte eines Spiels der ${leagueName} ${seasonName}.`,
      },
      table: {
        title: `kicker Manager Tabellen ${leagueName} ${seasonName}`,
        description: `Aktuelle kicker-Noten und Managerpunkte der ${leagueName} ${seasonName}: Ranglisten nach Spielern, Positionen und Mannschaften.`,
      },
      about: {
        title: "Über Punktespiegel",
        description: "Was Punktespiegel bietet: aktuelle und historische kicker-Noten, Punkte und Statistikprofile für drei deutsche Profiligen.",
      },
      methodology: {
        title: "Daten & Methodik",
        description: "So importiert, prüft und veröffentlicht Punktespiegel kicker-Wertungen und historische Saisondaten.",
      },
      sources: {
        title: "Quellen für Punkte, Profile & Fußball-News",
        description: "Transparente Übersicht der Daten-, Profil-, Verfügbarkeits- und Nachrichtenquellen hinter Punktespiegel.",
      },
      faq: {
        title: "Häufige Fragen zu Punktespiegel",
        description: "Antworten zu Datenumfang, Ligen, Aktualisierung und zur Unabhängigkeit von Punktespiegel.",
      },
    } satisfies Record<View, { title: string; description: string }>)[view];

    const canonical = new URL(pathForView(view), siteBaseUrl);
    if (!isInfoView(view)) {
      canonical.searchParams.set("league", filters.league);
      canonical.searchParams.set("season", filters.season);
      if (view === "table") canonical.searchParams.set("round", filters.round);
      if (view === "player" && playerId) canonical.searchParams.set("player", playerId);
      if (view === "team" && teamId) canonical.searchParams.set("team", teamId);
      if (view === "match" && matchId) canonical.searchParams.set("match", matchId);
    }

    document.title = `${seo.title} | Punktespiegel`;
    document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.setAttribute("href", canonical.href);
    const metadata: ["name" | "property", string, string][] = [
      ["name", "description", seo.description],
      ["property", "og:title", `${seo.title} | Punktespiegel`],
      ["property", "og:description", seo.description],
      ["property", "og:url", canonical.href],
      ["name", "twitter:title", `${seo.title} | Punktespiegel`],
      ["name", "twitter:description", seo.description],
    ];
    metadata.forEach(([attribute, key, content]) => {
      document.head.querySelector<HTMLMetaElement>(`meta[${attribute}="${key}"]`)?.setAttribute("content", content);
    });

    document.getElementById("punktespiegel-faq-structured-data")?.remove();
    if (view === "faq") {
      const structuredData = document.createElement("script");
      structuredData.id = "punktespiegel-faq-structured-data";
      structuredData.type = "application/ld+json";
      structuredData.textContent = JSON.stringify({
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: faqItems.map((item) => ({
          "@type": "Question",
          name: item.question,
          acceptedAnswer: { "@type": "Answer", text: item.answer },
        })),
      });
      document.head.append(structuredData);
    }
  }, [catalog, filters.league, filters.round, filters.season, matchId, playerId, selectedSeasonName, teamId, view]);
}
