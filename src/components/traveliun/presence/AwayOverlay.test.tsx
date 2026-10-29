import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  awayKindOf,
  elapsedMinutes,
  minutesText,
  once,
} from "@/lib/presence/away-overlay";
import { AwayOverlayView } from "./AwayOverlay";

const at = (kind: "client" | "call" | "prayer" | "meeting") => ({ kind });

describe("the page is covered only while «صلاة» (or «اجتماع») is on", () => {
  it("prayer and meeting cover it; a client, a call or nothing do not", () => {
    expect(awayKindOf(at("prayer"))).toBe("prayer");
    expect(awayKindOf(at("meeting"))).toBe("meeting");
    expect(awayKindOf(at("client"))).toBeNull();
    expect(awayKindOf(at("call"))).toBeNull();
    expect(awayKindOf(null)).toBeNull();
    expect(awayKindOf(undefined)).toBeNull();
  });

  it("draws the prayer's words, the minutes and the one way out", () => {
    const html = renderToStaticMarkup(
      <AwayOverlayView
        kind="prayer"
        minutes={7}
        busy={false}
        onEnd={() => undefined}
      />,
    );
    expect(html).toContain("وقت الصلاة");
    expect(html).toContain("تقبّل الله");
    expect(html).toContain("منذ 7 دقائق");
    expect(html).toContain("انتهيت — أغلق");
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('dir="rtl"');
    // the pulse is the only motion, and only when motion is welcome
    expect(html).toContain("motion-safe:animate-pulse");
    expect(html).not.toMatch(/\banimate-(?!pulse)/);
  });

  it("a meeting says so, with its title", () => {
    const html = renderToStaticMarkup(
      <AwayOverlayView
        kind="meeting"
        minutes={0}
        detail="اجتماع المبيعات"
        busy={false}
        onEnd={() => undefined}
      />,
    );
    expect(html).toContain("في اجتماع");
    expect(html).toContain("اجتماع المبيعات");
    expect(html).toContain("انتهى الاجتماع");
    expect(html).toContain("منذ أقل من دقيقة");
    // the sky and the table: the mosque is the prayer's, not the meeting's
    expect(html.match(/<svg/g)?.length).toBe(2);
  });

  it("counts whole minutes from the start", () => {
    const start = "2026-10-29T12:00:00.000Z";
    expect(elapsedMinutes(start, Date.parse(start) + 59_000)).toBe(0);
    expect(elapsedMinutes(start, Date.parse(start) + 12 * 60_000 + 5_000)).toBe(
      12,
    );
    expect(elapsedMinutes(start, Date.parse(start) - 5_000)).toBe(0);
    expect([1, 2, 3, 11].map(minutesText)).toEqual([
      "دقيقة",
      "دقيقتان",
      "3 دقائق",
      "11 دقيقة",
    ]);
  });
});

describe("«انتهيت — أغلق» ends the status once", () => {
  it("a double tap ends it once; after it ended nothing more is sent", async () => {
    const end = vi.fn(async () => ({ ok: true }));
    const close = once(end);
    const [a, b] = await Promise.all([close(), close()]);
    expect(end).toHaveBeenCalledTimes(1);
    expect([a, b]).toEqual([{ ok: true }, null]);
    expect(await close()).toBeNull();
    expect(end).toHaveBeenCalledTimes(1);
  });

  it("a failed end may be tried again", async () => {
    const end = vi
      .fn()
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: true });
    const close = once(end);
    expect(await close()).toEqual({ ok: false });
    expect(await close()).toEqual({ ok: true });
    expect(end).toHaveBeenCalledTimes(2);
  });
});
