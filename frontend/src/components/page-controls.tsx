import { PageHeader as FunPageHeader, StepperSelect as FunStepperSelect } from "@gruberb/fun-ui";
import type { ReactNode } from "react";

/** One header layout for every page: eyebrow with league and season, title, optional description, controls. */
export function PageHeader(props: { title: string; eyebrow: string; description?: string; controls?: ReactNode }) {
  return <FunPageHeader {...props} ariaLabel="Seitenkopf und Datenauswahl" />;
}

export function StepperSelect({ label, ...props }: { label: string; value: string; options: { value: string; label: string }[]; onChange: (value: string) => void }) {
  return <FunStepperSelect label={label} previousLabel={`${label} zurück`} nextLabel={`${label} weiter`} {...props} />;
}
