export type ResourceLoader<T> = (signal: AbortSignal) => Promise<T>;
export type ResourceResult<T> = { data: T | null; error: string | null; loading: false };

// A shared snapshot can finish after its consumer has navigated away. Only the
// current consumer may publish a result, even when the loader ignores abort.
export async function resolveResource<T>(
  load: ResourceLoader<T>,
  signal: AbortSignal,
  publish: (result: ResourceResult<T>) => void,
): Promise<void> {
  if (signal.aborted) return;
  let result: ResourceResult<T>;
  try {
    result = { data: await load(signal), error: null, loading: false };
  } catch (reason) {
    result = {
      data: null,
      error: reason instanceof Error ? reason.message : "Daten konnten nicht geladen werden.",
      loading: false,
    };
  }
  if (!signal.aborted) publish(result);
}
