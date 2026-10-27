import { describe, expect, it } from "vitest";
import { dedupeKeys, groupNotifications, relativeTime, shouldChime, type NotificationRow } from "./core";

const row = (over: Partial<NotificationRow>): NotificationRow => ({
  id: Math.random().toString(36).slice(2), kind: "waiting", title: "t", body: "", href: null, source: "secretary",
  created_at: new Date().toISOString(), read_at: null, ...over,
});

describe("dedupe keys", () => {
  it("one key per EVENT: the same waiting episode, the same reminder, the same day's hot", () => {
    expect(dedupeKeys.waiting(100, 1700000000)).toBe("wait:100:1700000000");
    expect(dedupeKeys.waiting(100, 1700000000)).toBe(dedupeKeys.waiting(100, 1700000000));
    expect(dedupeKeys.waiting(100, 1700000005)).not.toBe(dedupeKeys.waiting(100, 1700000000));
    expect(dedupeKeys.hot(100, "2026-10-26")).not.toBe(dedupeKeys.hot(100, "2026-10-27"));
    expect(dedupeKeys.reminder(7)).toBe("rem:7");
    expect(dedupeKeys.offerDue("f1", null)).toBe("due:f1:x");
  });
});

describe("groupNotifications", () => {
  it("≥5 unread of one kind fold; fewer stay flat; newest group first", () => {
    const old = new Date(Date.now() - 3600_000).toISOString();
    const rows = [
      ...Array.from({ length: 6 }, (_, k) => row({ kind: "waiting", created_at: new Date(Date.now() - k * 1000).toISOString() })),
      row({ kind: "hot", created_at: old }),
      row({ kind: "hot", created_at: old, read_at: old }),
    ];
    const groups = groupNotifications(rows);
    expect(groups[0].kind).toBe("waiting");
    expect(groups[0].folded).toBe(true);
    expect(groups[1].kind).toBe("hot");
    expect(groups[1].folded).toBe(false);
  });
  it("read rows do not count toward folding", () => {
    const read = new Date().toISOString();
    const rows = Array.from({ length: 6 }, () => row({ kind: "waiting", read_at: read }));
    expect(groupNotifications(rows)[0].folded).toBe(false);
  });
});

describe("shouldChime", () => {
  const openedAt = Date.parse("2026-10-26T10:00:00Z");
  const after = { created_at: "2026-10-26T10:05:00Z", read_at: null };
  it("only new, unmuted, in-hours, unread", () => {
    expect(shouldChime(after, openedAt, false, true)).toBe(true);
    expect(shouldChime({ ...after, created_at: "2026-10-26T09:00:00Z" }, openedAt, false, true)).toBe(false); // old
    expect(shouldChime(after, openedAt, true, true)).toBe(false); // muted
    expect(shouldChime(after, openedAt, false, false)).toBe(false); // outside hours
    expect(shouldChime({ ...after, read_at: after.created_at }, openedAt, false, true)).toBe(false); // read
  });
});

describe("relativeTime", () => {
  it("minutes, hours, days", () => {
    const now = Date.now();
    expect(relativeTime(new Date(now - 30_000).toISOString(), now)).toBe("الآن");
    expect(relativeTime(new Date(now - 5 * 60_000).toISOString(), now)).toBe("قبل 5 دقيقة");
    expect(relativeTime(new Date(now - 3 * 3600_000).toISOString(), now)).toBe("قبل 3 ساعة");
    expect(relativeTime(new Date(now - 26 * 3600_000).toISOString(), now)).toBe("أمس");
  });
});
