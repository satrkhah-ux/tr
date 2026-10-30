import { describe, expect, it } from "vitest";
import { IDLE_MS, makeUnlockToken, unlockTokenValid } from "./lock";

describe("the finance unlock token", () => {
  const now = 1_800_000_000_000;
  const t = makeUnlockToken("salt:hash", "user-1", now);

  it("opens for its user until the idle time passes", () => {
    expect(unlockTokenValid(t, "salt:hash", "user-1", now + IDLE_MS - 1)).toBe(true);
    expect(unlockTokenValid(t, "salt:hash", "user-1", now + IDLE_MS)).toBe(false);
  });
  it("never opens for another user, after a new password, or when altered", () => {
    expect(unlockTokenValid(t, "salt:hash", "user-2", now)).toBe(false);
    expect(unlockTokenValid(t, "salt:other", "user-1", now)).toBe(false);
    const [exp, mac] = t.split(".");
    expect(unlockTokenValid(`${Number(exp) + 60_000}.${mac}`, "salt:hash", "user-1", now)).toBe(false); // a later expiry, same signature
    expect(unlockTokenValid(undefined, "salt:hash", "user-1", now)).toBe(false);
    expect(unlockTokenValid("garbage", "salt:hash", "user-1", now)).toBe(false);
  });
  it("refuses an expiry further than one idle period ahead", () => {
    expect(unlockTokenValid(makeUnlockToken("salt:hash", "user-1", now + IDLE_MS * 5), "salt:hash", "user-1", now)).toBe(false);
  });
});
