import type { ReactNode } from "react";
import type { NavView } from "../lib/navigation/scope";

export const nav = [
  { id: "overview", label: "Überblick" },
  { id: "matchday", label: "Spieltag" },
  { id: "table", label: "Tabellen" },
  { id: "players", label: "Spieler" },
  { id: "teams", label: "Mannschaften" },
] satisfies { id: NavView; label: string }[];

export const navMobile: Record<(typeof nav)[number]["id"], { label: string; icon: ReactNode }> = {
  overview: {
    label: "Überblick",
    icon: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3.7 10.9 8.3-7 8.3 7" /><path d="M6 9.7V20h12V9.7" /></svg>,
  },
  matchday: {
    label: "Spieltag",
    icon: <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15" rx="1" /><path d="M3.5 9.5h17M8 3v4M16 3v4M8 13.5h2M14 13.5h2M8 16.5h2" /></svg>,
  },
  table: {
    label: "Tabellen",
    icon: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 20V9.5h6V20" /><path d="M3.5 20v-6.7H9" /><path d="M20.5 20v-5.2H15" /><path d="M2.5 20h19" /></svg>,
  },
  players: {
    label: "Spieler",
    icon: <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="7.7" r="3.5" /><path d="M5.3 20c.9-3.7 3.6-5.7 6.7-5.7s5.8 2 6.7 5.7" /></svg>,
  },
  teams: {
    label: "Teams",
    icon: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.3 5.4 5.7v5.6c0 4.2 2.7 7.3 6.6 8.8 3.9-1.5 6.6-4.6 6.6-8.8V5.7Z" /></svg>,
  },
};
