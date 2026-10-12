import { Segmented } from "@gruberb/fun-ui";
import { createContext, use, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { useMediaQuery } from "../hooks/use-media-query";
import { StepperSelect } from "./page-controls";

type Option = { value: string; label: string };
export type ScopeField = { kind?: "select" | "toggle"; label: string; value: string; options: Option[]; onChange: (value: string) => void };

/** App-bar element that hosts the compact scope row on phones; null renders it inline. */
export const ScopeSlotContext = createContext<HTMLElement | null>(null);

/** Matches the phone breakpoint in styles.css: below it, selectors collapse into one chip plus a sheet. */
const COMPACT_QUERY = "(max-width: 600px)";

/**
 * Scope selectors (league, season, matchday). Wide screens get one stepper per field.
 * Phones get a single row: previous, a chip summarising the scope, next. The chip opens a sheet with native selects.
 * The row moves into the app bar via ScopeSlotContext; toggles stay in the page.
 * Arrows step the last select field, which is the finest-grained one (matchday, else season).
 */
export function ScopeControls({ fields }: { fields: ScopeField[] }) {
  const compact = useMediaQuery(COMPACT_QUERY);
  const slot = use(ScopeSlotContext);
  const sheet = useRef<HTMLDialogElement>(null);
  const titleId = useId();
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
  const labelOf = (field: ScopeField) => field.options.find((option) => option.value === field.value)?.label;
  const context = selects.slice(0, -1).map(labelOf).filter(Boolean).join(" · ");

  const row = <div className="scope-bar">
    {stepped && <>
      <button className="scope-step" type="button" disabled={index <= 0} onClick={() => step(-1)} aria-label={`${stepped.label} zurück`}>‹</button>
      <button className="scope-chip" type="button" aria-haspopup="dialog" onClick={() => sheet.current?.showModal()}>
        <span className="scope-chip-text">{context && <small>{context}</small>}<strong>{(stepped && labelOf(stepped)) || "Auswahl"}</strong></span>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
      </button>
      <button className="scope-step" type="button" disabled={index < 0 || index >= stepped.options.length - 1} onClick={() => step(1)} aria-label={`${stepped.label} weiter`}>›</button>
    </>}
    <dialog ref={sheet} className="sheet" aria-labelledby={titleId} onClick={(event) => { if (event.target === event.currentTarget) event.currentTarget.close(); }}>
      <form method="dialog">
        <div className="sheet-grab" aria-hidden="true" />
        {/* showModal() focuses the dialog's autofocus element, else its first control. iOS opens the
            picker of a focused <select>, so the title takes initial focus. React's autoFocus only calls
            focus() on mount, so the attribute is set directly. */}
        <h2 id={titleId} className="sheet-title" tabIndex={-1} ref={(element) => element?.setAttribute("autofocus", "")}>Auswahl</h2>
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

  return <>
    {slot ? createPortal(row, slot) : row}
    {toggles.length > 0 && <div className="selectors selectors-compact">
      {toggles.map((field) => <Segmented key={field.label} ariaLabel={field.label} size="lg" stretch value={field.value} onChange={field.onChange} options={field.options} />)}
    </div>}
  </>;
}
