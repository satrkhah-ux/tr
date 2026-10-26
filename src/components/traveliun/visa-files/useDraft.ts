"use client";

import { useCallback, useState } from "react";

export type DraftState<T> = { base: string; value: T; /** the next server copy replaces the draft, edited or not (the section was just saved) */ adopt: boolean };

/**
 * The server's copy moved under a draft: a clean draft follows it, an edited one stays as it was typed — saving one
 * section never throws away what is half-typed in another. A section that was just saved adopts the server's copy
 * whatever it holds: the server trims and rounds what was typed («03» became 3), and the draft must not stay
 * «edited» over that.
 */
export function reconcile<T>(state: DraftState<T>, server: T): DraftState<T> {
  const base = JSON.stringify(server);
  if (state.adopt) return { base, value: server, adopt: false };
  if (state.base === base) return state;
  return { base, value: JSON.stringify(state.value) === state.base ? server : state.value, adopt: false };
}
export const isDirty = (state: DraftState<unknown>) => JSON.stringify(state.value) !== state.base;

/** A section's draft beside the copy the server holds; `dirty` says it was edited, `adopt` says it was saved. */
export function useDraft<T>(server: T) {
  const [state, setState] = useState<DraftState<T>>({ base: JSON.stringify(server), value: server, adopt: false });
  const current = reconcile(state, server);
  if (current !== state) setState(current);
  const set = useCallback((next: T | ((previous: T) => T)) => {
    setState((s) => ({ ...s, value: typeof next === "function" ? (next as (previous: T) => T)(s.value) : next }));
  }, []);
  const adopt = useCallback(() => setState((s) => ({ ...s, adopt: true })), []);
  return { value: current.value, set, adopt, dirty: isDirty(current) };
}
