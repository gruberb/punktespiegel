import { useState } from "react";
import type { ReactNode } from "react";
import { ErrorState } from "./feedback";

type Resource<T> = { data: T | null; error: string | null; loading: boolean };

// Retention belongs to the display boundary, not the request cache. A new
// identity clears old content; stale rows are inert so their links cannot use
// the newly selected season. Children stay mounted to preserve local UI state.
export function ResourcePanel<T>({ resource, label, identity = "section", className = "", feedback = "overlay", children }: {
  resource: Resource<T>;
  label: string;
  identity?: string;
  className?: string;
  feedback?: "overlay" | "quiet";
  children: (data: T) => ReactNode;
}) {
  const [previous, setPrevious] = useState<{ identity: string; data: T | null }>({ identity, data: null });
  const settled = !resource.loading && !resource.error;
  if (previous.identity !== identity || (settled && previous.data !== resource.data)) {
    setPrevious({ identity, data: settled ? resource.data : null });
  }
  const data = resource.data ?? (previous.identity === identity && !settled ? previous.data : null);
  const stale = data !== null && resource.data === null;
  return <section className={`resource-panel resource-feedback-${feedback} ${data !== null ? "resource-has-data" : ""} ${className}`} aria-label={label} aria-busy={resource.loading}>
    {resource.loading && <div className="resource-loading" role="status">
      {feedback === "overlay" && <span className="resource-spinner" aria-hidden="true" />}
      <span className="resource-sr-only">{label} wird geladen …</span>
    </div>}
    {resource.error && <div className="resource-error"><ErrorState message={resource.error} /></div>}
    <div className="resource-content" inert={stale || undefined}>{data !== null && children(data)}</div>
  </section>;
}
