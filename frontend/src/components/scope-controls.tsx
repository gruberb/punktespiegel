import { Segmented } from "@gruberb/fun-ui";
import { useRef } from "react";
import { useMediaQuery } from "../hooks/use-media-query";
import { StepperSelect } from "./page-controls";

type Option = { value: string; label: string };
export type ScopeField = { kind?: "select" | "toggle"; label: string; value: string; options: Option[]; onChange: (value: string) => void };

/** Matches the phone breakpoint in styles.css: below it, selectors collapse into one chip plus a sheet. */
const COMPACT_QUERY = "(max-width: 600px)";

/**
 * Scope selectors (league, season, matchday). Wide screens get one stepper per field.
 * Phones get a single row: previous, a chip summarising the scope, next. The chip opens a sheet with native selects.
 * Arrows step the last select field, which is the finest-grained one (matchday, else season).
 */
export function ScopeControls({ fields }: { fields: ScopeField[] }) {
  const compact = useMediaQuery(COMPACT_QUERY);
  const sheet = useRef<HTMLDialogElement>(null);
  const selects = fields.filter((field) => field.kind !== "toggle");
  const toggles = fields.filter((field) => field.kind === "toggle");

  if (!compact) {
    return <div className="selectors">{fields.map((field) => field.kind === "toggle"
      ? <Segmented key={field.label} ariaLabel={field.label} size="lg" stretch value={field.value} onChange={field.onChange} options={field.options} />
      : <StepperSelect key={field.label} {...field} />)}</div>;
  }

  const stepped = selects.at(-1);
  const index = stepped ? stepped.options.findIndex((option) => option.value === stepped.value) : -1;
  const step = (delta: number) => { const next = stepped?.options[index + delta]; if (stepped && next) stepped.onChange(next.value); };
  const summary = selects.map((field) => field.options.find((option) => option.value === field.value)?.label).filter(Boolean).join(" · ");

  return <div className="selectors selectors-compact">
    {stepped && <div className="scope-bar">
      <button className="scope-step" type="button" disabled={index <= 0} onClick={() => step(-1)} aria-label={`${stepped.label} zurück`}>‹</button>
      <button className="scope-chip" type="button" aria-haspopup="dialog" onClick={() => sheet.current?.showModal()}>
        <span>{summary || "Auswahl"}</span>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
      </button>
      <button className="scope-step" type="button" disabled={index < 0 || index >= stepped.options.length - 1} onClick={() => step(1)} aria-label={`${stepped.label} weiter`}>›</button>
    </div>}
    {toggles.map((field) => <Segmented key={field.label} ariaLabel={field.label} size="lg" stretch value={field.value} onChange={field.onChange} options={field.options} />)}
    <dialog ref={sheet} className="sheet" aria-label="Auswahl" onClick={(event) => { if (event.target === event.currentTarget) event.currentTarget.close(); }}>
      <form method="dialog">
        <div className="sheet-grab" aria-hidden="true" />
        {selects.map((field) => <label key={field.label} className="sheet-field">
          <span>{field.label}</span>
          <select value={field.value} onChange={(event) => field.onChange(event.target.value)}>
            {field.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>)}
        <button className="sheet-done">Fertig</button>
      </form>
    </dialog>
  </div>;
}
