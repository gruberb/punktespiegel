import { PageHeader as FunPageHeader, StepperSelect as FunStepperSelect } from "@gruberb/fun-ui";
import type { ReactNode } from "react";

export function PageHeader({ eyebrow = "kicker-Daten · kicker Manager-Liga", hero = false, ...props }: { title: string; eyebrow?: string; description?: string; controls?: ReactNode; hero?: boolean }) {
  return <FunPageHeader {...props} eyebrow={eyebrow} variant={hero ? "hero" : "default"} ariaLabel="Seitenkopf und Datenauswahl" />;
}

export function StepperSelect({ label, ...props }: { label: string; value: string; options: { value: string; label: string }[]; onChange: (value: string) => void }) {
  return <FunStepperSelect label={label} previousLabel={`${label} zurück`} nextLabel={`${label} weiter`} {...props} />;
}
