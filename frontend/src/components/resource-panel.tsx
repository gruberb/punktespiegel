import { useState } from "react";
import type { ReactNode } from "react";
import { ErrorState } from "./feedback";

type Resource<T> = { data: T | null; error: string | null; loading: boolean };

// Retention belongs to the display boundary, not the request cache. A new
// identity clears old content; stale rows are inert so their links cannot use
// the newly selected season. Children stay mounted to preserve local UI state.
export function ResourcePanel<T>({ resource, label, identity = "section", className = "", children }: {
  resource: Resource<T>;
  label: string;
  identity?: string;
  className?: string;
  children: (data: T) => ReactNode;
}) {
  const [previous, setPrevious] = useState<{ identity: string; data: T | null }>({ identity, data: null });
  const settled = !resource.loading && !resource.error;
  if (previous.identity !== identity || (settled && previous.data !== resource.data)) {
    setPrevious({ identity, data: settled ? resource.data : null });
  }
  const data = resource.data ?? (previous.identity === identity && !settled ? previous.data : null);
  const stale = data !== null && resource.data === null;
  return <section className={`resource-panel ${className}`} aria-label={label} aria-busy={resource.loading}>
    {resource.loading && <p className="resource-status" role="status">{label} wird geladen …{stale && " Angezeigt wird noch die vorherige Auswahl."}</p>}
    {resource.error && <><ErrorState message={resource.error} />{stale && <p className="resource-status">Vorherige Auswahl, bis zum erfolgreichen Laden nicht bedienbar.</p>}</>}
    <div className="resource-content" inert={stale || undefined}>{data !== null && children(data)}</div>
  </section>;
}
