/** One writer per draft tab. A flush includes edits queued while a save is in flight. */
export function createSaveQueue<T extends object>(write: (slice: Partial<T>) => Promise<void>) {
  let pending: Partial<T> = {};
  let active: Promise<void> | null = null;
  return {
    patch(slice: Partial<T>) { pending = { ...pending, ...slice }; },
    pending() { return pending; },
    clear() { pending = {}; },
    flush(): Promise<void> {
      if (active) return active;
      active = (async () => {
        while (Object.keys(pending).length) {
          const slice = pending;
          pending = {};
          try { await write(slice); }
          catch (error) {
            pending = { ...slice, ...pending };
            throw error;
          }
        }
      })().finally(() => { active = null; });
      return active;
    },
  };
}
