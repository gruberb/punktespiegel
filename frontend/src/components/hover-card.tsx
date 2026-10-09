import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { FocusEvent, KeyboardEvent, ReactNode } from "react";
import { createPortal } from "react-dom";

// fun-ui's Popover is a non-interactive tooltip. These cards contain navigation
// links, so focus and pointer movement must work across the portalled panel.
export function useHoverCard<T extends HTMLElement>(onOpen?: () => void, closeDelayMs = 150) {
  const ref = useRef<T>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const id = useId();
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const cancelClose = () => clearTimeout(timer.current);
  function show() { cancelClose(); setOpen(true); onOpen?.(); }
  function hide() { cancelClose(); setOpen(false); }
  function scheduleClose() {
    cancelClose();
    timer.current = setTimeout(() => {
      if (!ref.current?.contains(document.activeElement) && !panelRef.current?.contains(document.activeElement)) setOpen(false);
    }, closeDelayMs);
  }
  function keyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.target !== event.currentTarget) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      panelRef.current?.querySelector<HTMLElement>("a, button")?.focus();
    } else if (event.key === "Escape") {
      event.preventDefault();
      hide();
    }
  }
  function blur(event: FocusEvent<HTMLElement>) {
    const next = event.relatedTarget;
    if (next instanceof Node && (ref.current?.contains(next) || panelRef.current?.contains(next))) return;
    scheduleClose();
  }
  useEffect(() => () => clearTimeout(timer.current), []);
  return {
    ref, panelRef, id, open,
    handlers: { "aria-keyshortcuts": "ArrowDown Escape", onKeyDownCapture: keyDown, "aria-controls": open ? id : undefined, onMouseEnter: show, onMouseLeave: scheduleClose, onFocus: show, onBlur: blur },
    panelHandlers: { onMouseEnter: show, onMouseLeave: scheduleClose, onFocus: show, onBlur: blur },
    close: hide,
  };
}

export function HoverCard({ hover, label, preferredWidth = 320, children }: { hover: ReturnType<typeof useHoverCard<HTMLElement>>; label: string; preferredWidth?: number; children: ReactNode }) {
  const [position, setPosition] = useState<{ top: number; left: number; width: number } | null>(null);
  useLayoutEffect(() => {
    if (!hover.open) return;
    function place() {
      const anchor = hover.ref.current;
      const panel = hover.panelRef.current;
      if (!anchor || !panel) return;
      const margin = 12;
      const gap = 8;
      const width = Math.min(preferredWidth, document.documentElement.clientWidth - margin * 2);
      const rect = anchor.getBoundingClientRect();
      const height = Math.min(panel.offsetHeight, window.innerHeight - margin * 2);
      const below = window.innerHeight - rect.bottom;
      const top = below >= height + gap || below >= rect.top ? rect.bottom + gap : rect.top - height - gap;
      setPosition({ width, top: Math.max(margin, Math.min(top, window.innerHeight - height - margin)), left: Math.max(margin, Math.min(rect.left + rect.width / 2 - width / 2, document.documentElement.clientWidth - width - margin)) });
    }
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => { window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [hover.open, hover.ref, hover.panelRef, preferredWidth]);
  if (!hover.open) return null;
  return createPortal(<div ref={hover.panelRef} id={hover.id} role="region" aria-label={label} className="fui-popover interactive-hover-card" style={{ ...position, visibility: position ? "visible" : "hidden" }} {...hover.panelHandlers} onClick={(event) => event.stopPropagation()} onKeyDown={(event) => {
    event.stopPropagation();
    if (event.key === "Escape") { event.preventDefault(); hover.ref.current?.focus(); hover.close(); }
  }}>{children}</div>, document.body);
}
