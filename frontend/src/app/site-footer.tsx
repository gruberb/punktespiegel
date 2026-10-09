import { Footer } from "@gruberb/fun-ui";
import type { MouseEvent as ReactMouseEvent } from "react";
import type { Filters, NavView, View } from "../lib/navigation/scope";
import { viewHref } from "../lib/navigation/scope";

export function SiteFooter({ currentView, filters, onView }: { currentView: View; filters: Filters; onView: (view: NavView) => void }) {
  const links: { view: NavView; label: string }[] = [
    { view: "about", label: "Über Punktespiegel" },
    { view: "methodology", label: "Daten & Methodik" },
    { view: "sources", label: "Quellen" },
    { view: "faq", label: "FAQ" },
    { view: "table", label: "Tabellen" },
    { view: "players", label: "Spieler" },
    { view: "teams", label: "Mannschaften" },
  ];
  const openView = (event: ReactMouseEvent<HTMLAnchorElement>, target: NavView) => {
    event.preventDefault();
    onView(target);
  };
  return <Footer className="site-footer">
    <div className="site-footer-main">
      <a className="site-footer-brand" href={viewHref("overview", filters)} onClick={(event) => openView(event, "overview")}>
        <img src={`${import.meta.env.BASE_URL}brand/punktespiegel-mark.svg`} alt="" aria-hidden="true" />
        <span><strong>Punktespiegel</strong><small>Noten, Punkte und Historie</small></span>
      </a>
      <nav className="site-footer-links" aria-label="Weitere Seiten">
        {links.map((item) => <a key={item.view} href={viewHref(item.view, filters)} aria-current={currentView === item.view ? "page" : undefined} onClick={(event) => openView(event, item.view)}>{item.label}</a>)}
      </nav>
    </div>
    <div className="site-footer-meta">
      <nav aria-label="Technische Links"><a href="https://github.com/gruberb/punktespiegel" target="_blank" rel="noreferrer external">GitHub ↗</a><a href={`${import.meta.env.BASE_URL}sitemap.xml`}>Sitemap</a></nav>
    </div>
  </Footer>;
}
