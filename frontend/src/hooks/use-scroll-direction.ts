import { useEffect } from "react";

/**
 * Mirrors the scroll direction into `data-scroll` on <html> ("down" or "up") so CSS can slide chrome away.
 * The attribute stays "up" near the top of the page and ignores jitter below `threshold` pixels.
 */
export function useScrollDirection(enabled: boolean, threshold = 8) {
  useEffect(() => {
    if (!enabled) return;
    const root = document.documentElement;
    let last = window.scrollY;
    root.dataset.scroll = "up";
    const onScroll = () => {
      const y = window.scrollY;
      if (y < 80) root.dataset.scroll = "up";
      else if (Math.abs(y - last) >= threshold) root.dataset.scroll = y > last ? "down" : "up";
      last = y;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => { window.removeEventListener("scroll", onScroll); delete root.dataset.scroll; };
  }, [enabled, threshold]);
}
