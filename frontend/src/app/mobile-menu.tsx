import { useRef } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { useMediaQuery } from "../hooks/use-media-query";
import type { Filters, NavView } from "../lib/navigation/scope";
import { viewHref } from "../lib/navigation/scope";
import { infoLinks, nav, navMobile } from "./navigation-items";

/** Matches the sidebar-to-app-bar breakpoint of the shell. */
const MENU_QUERY = "(max-width: 860px)";

/** App-bar menu button plus a drawer with every section. Unmounted above the breakpoint so no modal can stay open there. */
export function MobileMenu({ activeId, filters, onNavigate }: { activeId: string | null; filters: Filters; onNavigate: (view: NavView) => void }) {
  const active = useMediaQuery(MENU_QUERY);
  const drawer = useRef<HTMLDialogElement>(null);
  if (!active) return null;

  const open = (event: ReactMouseEvent<HTMLAnchorElement>, view: NavView) => {
    event.preventDefault();
    onNavigate(view);
    drawer.current?.close();
  };
  const link = (view: NavView, label: string, icon?: React.ReactNode) => (
    <a key={view} href={viewHref(view, filters)} aria-current={activeId === view ? "page" : undefined} onClick={(event) => open(event, view)}>
      {icon}{label}
    </a>
  );

  return <>
    <button className="menu-button" type="button" aria-haspopup="dialog" aria-label="Menü öffnen" onClick={() => drawer.current?.showModal()}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
    </button>
    <dialog ref={drawer} className="drawer" aria-label="Menü" onClick={(event) => { if (event.target === event.currentTarget) event.currentTarget.close(); }}>
      <div className="drawer-head">
        <strong>Punktespiegel</strong>
        <button type="button" className="menu-button" aria-label="Menü schließen" onClick={() => drawer.current?.close()}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
        </button>
      </div>
      <nav aria-label="Bereiche">{nav.map((item) => link(item.id, item.label, navMobile[item.id].icon))}</nav>
      <nav className="drawer-minor" aria-label="Weitere Seiten">{infoLinks.map((item) => link(item.view, item.label))}</nav>
    </dialog>
  </>;
}
