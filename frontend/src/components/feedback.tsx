import { EmptyState, ErrorMessage, LoadingSpinner } from "@gruberb/fun-ui";

export function Empty({ message }: { message: string }) { return <EmptyState variant="dashed" className="empty" icon="○" heading={message} />; }

export function ErrorState({ message }: { message: string }) { return <ErrorMessage title="Ansicht konnte nicht geladen werden" message={message} hint="Bitte prüfen, ob die statischen Datendateien vorhanden sind, und anschließend neu laden." />; }

export function LoadingState() { return <LoadingSpinner variant="skeleton" columns={3} className="loading-grid" message="Dashboard wird geladen" />; }
