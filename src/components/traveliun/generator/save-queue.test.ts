import { describe, expect, it } from "vitest";
import { createSaveQueue } from "./save-queue";

describe("draft save before issue", () => {
  it("waits for an automatic save and then saves the latest price before issuing", async () => {
    let release!: () => void;
    let stored = 100;
    const writes: number[] = [];
    const queue = createSaveQueue<{ price: number }>(async (slice) => {
      writes.push(slice.price!);
      if (writes.length === 1) await new Promise<void>((resolve) => { release = resolve; });
      stored = slice.price!;
    });
    queue.patch({ price: 200 });
    const automatic = queue.flush();
    queue.patch({ price: 300 });
    const beforeIssue = queue.flush();
    expect(writes).toEqual([200]);
    release();
    await Promise.all([automatic, beforeIssue]);
    expect(stored).toBe(300);
    expect(writes).toEqual([200, 300]);
  });

  it("blocks issuing on failure and keeps the newest price for retry", async () => {
    let fail = true;
    const queue = createSaveQueue<{ price: number; currency: string }>(async () => {
      if (fail) { queue.patch({ price: 300 }); throw new Error("offline"); }
    });
    queue.patch({ price: 200, currency: "SAR" });
    await expect(queue.flush()).rejects.toThrow("offline");
    expect(queue.pending()).toEqual({ price: 300, currency: "SAR" });
    fail = false;
    await queue.flush();
    expect(queue.pending()).toEqual({});
  });
});
