import { useEffect, useState } from "react";
import type { ResourceLoader } from "../lib/resource";
import { resolveResource } from "../lib/resource";

type ResourceState<T> = { data: T | null; error: string | null; loading: boolean };

// Callers memoize load with useCallback and include every request input in its
// dependencies. null disables the request without retaining an old result.
export function useResource<T>(load: ResourceLoader<T> | null): ResourceState<T> {
  const [state, setState] = useState<ResourceState<T> & { request: typeof load }>({
    request: load, data: null, error: null, loading: load !== null,
  });

  useEffect(() => {
    const controller = new AbortController();
    setState({ request: load, data: null, error: null, loading: load !== null });
    if (load) {
      void resolveResource(load, controller.signal, (result) => setState({ request: load, ...result }));
    }
    return () => controller.abort();
  }, [load]);

  // Effects run after render; never display the previous selection in that gap.
  return state.request === load ? state : { data: null, error: null, loading: load !== null };
}
