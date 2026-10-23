import { expect, it } from "vitest";
import { since } from "./followup-ui";

it("counts in Arabic: 1 ساعة, 2 ساعتان, 3–10 ساعات, 11+ ساعة; يوماً past ten", () => {
  const now = Date.parse("2026-10-23T12:00:00Z");
  const ago = (h: number) => new Date(now - h * 3600_000).toISOString();
  expect(since(ago(1), now)).toBe("ساعة");
  expect(since(ago(2), now)).toBe("ساعتان");
  expect(since(ago(6), now)).toBe("6 ساعات");
  expect(since(ago(12), now)).toBe("12 ساعة");
  expect(since(ago(48), now)).toBe("يومان");
  expect(since(ago(24 * 5), now)).toBe("5 أيام");
  expect(since(ago(24 * 12), now)).toBe("12 يوماً");
});
