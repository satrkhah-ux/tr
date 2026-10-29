import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  AWAY_TEXT,
  awayKindOf,
  canFold,
  clientOf,
  elapsedMinutes,
  minutesText,
  once,
  type AwayKind,
} from "@/lib/presence/away-overlay";
import { AwayBar, AwayOverlayView } from "./AwayOverlay";

const KINDS: AwayKind[] = ["prayer", "meeting", "client", "call"];
const noop = () => undefined;
const view = (
  kind: AwayKind,
  extra: Partial<Parameters<typeof AwayOverlayView>[0]> = {},
) =>
  renderToStaticMarkup(
    <AwayOverlayView
      kind={kind}
      minutes={7}
      busy={false}
      onEnd={noop}
      {...extra}
    />,
  );

describe("the page is covered while a status is on, and only then", () => {
  it("every status covers it; nothing on, nothing covers", () => {
    for (const k of KINDS) expect(awayKindOf({ kind: k })).toBe(k);
    expect(awayKindOf(null)).toBeNull();
    expect(awayKindOf(undefined)).toBeNull();
  });

  for (const kind of KINDS) {
    it(`«${AWAY_TEXT[kind].bar}»: its own words, the minutes and the one end button, full page and modal`, () => {
      const html = view(kind);
      expect(html).toContain(AWAY_TEXT[kind].title);
      expect(html).toContain(AWAY_TEXT[kind].close);
      expect(html).toContain("منذ 7 دقائق");
      expect(html).toContain('aria-modal="true"');
      expect(html).toContain("fixed inset-0");
      expect(html).toContain('dir="rtl"');
      // the pulse is the only motion, and only when motion is welcome
      expect(html).toContain("motion-safe:animate-pulse");
      expect(html).not.toMatch(/\banimate-(?!pulse)/);
      // the sky + its own motif; the prayer adds the mosque along the bottom
      expect(html.match(/<svg/g)?.length).toBe(kind === "prayer" ? 3 : 2);
      // no crescent, anywhere (the owner, 2026-10-29): the old one was a masked circle
      expect(html).not.toMatch(/<mask|crescent/i);
    });
  }

  it("prayer and meeting stay full-page; a client and a call may fold", () => {
    expect(KINDS.filter(canFold)).toEqual(["client", "call"]);
    expect(view("client", { onFold: noop })).toContain(
      "افتح النظام للعمل مع العميل",
    );
    expect(view("prayer")).not.toContain("افتح النظام");
    expect(view("prayer")).toContain("تقبّل الله");
  });

  it("a meeting shows its title", () => {
    expect(view("meeting", { detail: "اجتماع المبيعات" })).toContain(
      "اجتماع المبيعات",
    );
  });

  it("a client and a call show who and what the colleague typed", () => {
    const client = clientOf({
      want: "عرض سعر",
      destination: "جورجيا",
      name: "أبو فهد",
      phone: "0500000000",
      note: "",
    });
    expect(client).toEqual({ name: "أبو فهد", request: "عرض سعر · جورجيا" });
    const html = view("client", { client });
    expect(html).toContain("أبو فهد");
    expect(html).toContain("عرض سعر · جورجيا");
    // the phone stays out of the cover
    expect(html).not.toContain("0500000000");
    expect(clientOf({ name: 3, want: "" })).toBeNull();
    expect(clientOf(undefined)).toBeNull();
    expect(clientOf({ want: "تأشيرة", note: "يسأل عن المدة" })).toEqual({
      name: "",
      request: "تأشيرة · يسأل عن المدة",
    });
  });

  it("folded: a slim bar with the name, the minutes, the same end button, and the way back", () => {
    const html = renderToStaticMarkup(
      <AwayBar
        kind="call"
        minutes={12}
        client={{ name: "سارة", request: "" }}
        busy={false}
        onEnd={noop}
        onOpen={noop}
      />,
    );
    expect(html).toContain("لدي اتصال");
    expect(html).toContain("سارة");
    expect(html).toContain("منذ 12 دقيقة");
    expect(html).toContain(AWAY_TEXT.call.close);
    expect(html).toContain("كبّر");
    expect(html).not.toContain("aria-modal");
  });

  it("counts whole minutes from the start", () => {
    const start = "2026-10-29T12:00:00.000Z";
    expect(elapsedMinutes(start, Date.parse(start) + 59_000)).toBe(0);
    expect(elapsedMinutes(start, Date.parse(start) + 12 * 60_000 + 5_000)).toBe(
      12,
    );
    expect(elapsedMinutes(start, Date.parse(start) - 5_000)).toBe(0);
    expect([0, 1, 2, 3, 11].map(minutesText)).toEqual([
      "أقل من دقيقة",
      "دقيقة",
      "دقيقتان",
      "3 دقائق",
      "11 دقيقة",
    ]);
  });
});

describe("the end button ends the status once", () => {
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
