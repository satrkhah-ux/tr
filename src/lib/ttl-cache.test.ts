import { afterEach, describe, expect, it, vi } from "vitest";
import { ttlCache } from "./ttl-cache";

describe("ttlCache", () => {
  afterEach(() => vi.useRealTimers());

  it("answers until its expiry, then asks again; the oldest goes first when full", () => {
    vi.useFakeTimers();
    const c = ttlCache<string, number>(1000, 2);
    c.set("a", 1);
    expect(c.get("a")).toBe(1);
    vi.advanceTimersByTime(1001);
    expect(c.get("a")).toBeUndefined();
    c.set("a", 1);
    c.set("b", 2);
    c.set("c", 3);
    expect([c.get("a"), c.get("b"), c.get("c")]).toEqual([undefined, 2, 3]);
    c.clear();
    expect(c.get("b")).toBeUndefined();
  });
});
