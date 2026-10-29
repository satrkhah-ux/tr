import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  AWAY_TEXT,
  awayKindOf,
  elapsedMinutes,
  formOf,
  minutesText,
  once,
  type AwayKind,
  type ClientForm,
} from "@/lib/presence/away-overlay";
import { STATUS_BUTTON, WANTS } from "@/lib/presence/excuse";
import * as overlay from "./AwayOverlay";

const { AwayOverlayView } = overlay;
const KINDS: AwayKind[] = ["prayer", "meeting", "client", "call"];
const noop = () => undefined;
const withForm = (kind: AwayKind) => kind === "client" || kind === "call";
const form = (
  values: Partial<ClientForm> = {},
  colleagues = [{ id: "e2", name: "رشا" }],
) => ({
  values: { ...formOf(undefined), ...values },
  colleagues,
  note: "",
  onChange: noop,
  onKeep: noop,
});
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
    it(`«${STATUS_BUTTON[kind]}»: full page, nothing of the system behind, its words, the minutes and ONE way out`, () => {
      const html = view(kind, withForm(kind) ? { form: form() } : {});
      expect(html).toContain(AWAY_TEXT[kind].title);
      expect(html).toContain(AWAY_TEXT[kind].close);
      expect(html).toContain("منذ 7 دقائق");
      // the whole screen, modal, opaque: the system is out of sight and out of reach
      expect(html).toContain("fixed inset-0");
      expect(html).toContain('aria-modal="true"');
      expect(html).toMatch(/bg-\[radial-gradient\([^)]*#0a201b_100%\)\]/);
      // the end button is the only way out (a client / a call add only the «ماذا يريد» chips) — no fold, no sign-out
      expect(html.match(/<button/g)?.length).toBe(
        1 + (withForm(kind) ? WANTS.length : 0),
      );
      expect(html).not.toContain("افتح النظام");
      expect(html).not.toMatch(/تسجيل خروج|sign-?out|logout|ابدأ/i);
      expect(html).toContain('dir="rtl"');
      // the pulse is the only motion, and only when motion is welcome
      expect(html).toContain("motion-safe:animate-pulse");
      expect(html).not.toMatch(/\banimate-(?!pulse)/);
      // the sky + its own motif; the prayer adds the mosque along the bottom; never a crescent (the owner)
      expect(html.match(/<svg/g)?.length).toBe(kind === "prayer" ? 3 : 2);
      expect(html).not.toMatch(/<mask|crescent/i);
    });
  }

  it("«لدي عميل» / «لدي اتصال»: the client is typed inside the cover — what, where, who, the phone, the request, and whom they asked for", () => {
    for (const kind of ["client", "call"] as const) {
      const html = view(kind, {
        form: form({ want: "بكج", name: "أبو فهد", for_employee: "e2" }),
      });
      for (const label of [
        "ماذا يريد؟",
        "اسم العميل",
        "رقم الهاتف",
        "الوجهة",
        "الطلب",
        "يريد التحدث مع موظف",
        "اختياري، والعداد يعمل",
      ])
        expect(html).toContain(label);
      expect(html).toContain('value="أبو فهد"');
      expect(html).toMatch(/aria-pressed="true"[^>]*>بكج</);
      expect(html).toMatch(/<option value="e2" selected="">رشا<\/option>/);
      // the cover starts with the press: there is nothing to fill before the minutes run
      expect(html).toContain("منذ 7 دقائق");
    }
    // nobody to ask for: no picker; a prayer has no form at all
    expect(view("call", { form: form({}, []) })).not.toContain(
      "يريد التحدث مع موظف",
    );
    expect(view("prayer")).not.toContain("اسم العميل");
  });

  it("the form opens with what was already kept on the status, and nothing else", () => {
    expect(
      formOf({
        name: "سارة",
        phone: "966500000000",
        want: "تأشيرة",
        for_employee: "e2",
        for_name: "رشا",
        extra: 1,
      }),
    ).toEqual({
      want: "تأشيرة",
      destination: "",
      name: "سارة",
      phone: "966500000000",
      note: "",
      for_employee: "e2",
    });
    expect(formOf(undefined)).toEqual({
      want: "",
      destination: "",
      name: "",
      phone: "",
      note: "",
      for_employee: "",
    });
  });

  it("there is no folded bar any more", () => {
    expect(Object.keys(overlay).sort()).toEqual([
      "AwayOverlay",
      "AwayOverlayView",
    ]);
  });

  it("prayer says «تقبّل الله»; a meeting shows its title", () => {
    expect(view("prayer")).toContain("تقبّل الله");
    expect(view("meeting", { detail: "اجتماع المبيعات" })).toContain(
      "اجتماع المبيعات",
    );
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
  it("and carries what was typed with it", async () => {
    const end = vi.fn<(form?: ClientForm) => Promise<{ ok: boolean }>>(
      async () => ({ ok: true }),
    );
    const close = once(end);
    const typed = { ...formOf(undefined), phone: "0500000000" };
    await close(typed);
    expect(end).toHaveBeenCalledWith(typed);
  });

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
