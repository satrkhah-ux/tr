import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The owner (2026-10-17): «عند الضغط على إصدار بكج يصل إلى العميل فوراً — يجب
 * أن تكون هنالك مراجعة وزر أرسل إلى العميل عبر الواتساب». Issuing sends
 * nothing; the employee's button sends the reviewed text, and every send is
 * recorded so the file's state can say «أُرسل للعميل».
 */

const state = vi.hoisted(() => ({
  can: { "offers.write": true, "operations.write": false, "dashboard.admin": false } as Record<string, boolean>,
  me: "emp-1",
  draft: { id: "d1", data: { produced_serial: "AD-1" }, partner_company_id: null } as { id: string; data: { produced_serial: string | null }; partner_company_id: string | null } | null,
  offer: { id: "o1", status: "sent", employee_id: "emp-1", partner_company_id: null as string | null, total: 8970, currency: "SAR" },
  sentBefore: [] as { action: string; meta: Record<string, unknown> }[],
  operation: null as { id: string } | null,
  audits: [] as { action: string; entity_id: string; meta?: Record<string, unknown> }[],
  sends: [] as { serial: string; updated: boolean; body?: string }[],
  sendResult: "sent" as string,
  statuses: [] as { offerId: string; to: string }[],
  confirmed: [] as string[],
  drafts: [] as { id: string; title: string | null; data: Record<string, unknown>; created_by: string | null; partner_company_id: string | null }[],
  deletes: [] as string[],
  auditFails: false,
}));

/** offers / audit_logs / offer_renders / operations — each read the way file-status.ts reads it. */
function fakeDb() {
  return {
    from(table: string) {
      const rows = (): unknown[] =>
        table === "offers"
          ? [state.offer]
          : table === "audit_logs"
            ? state.sentBefore
            : table === "offer_renders"
              ? [{ version: 2 }]
              : table === "operations"
                ? state.operation
                  ? [state.operation]
                  : []
                : table === "offer_drafts"
                  ? state.drafts
                  : [];
      const builder = {
        select: () => builder,
        eq: () => builder,
        in: () => builder,
        delete: () => (state.deletes.push(table), builder),
        maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
        then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: rows(), error: null }).then(ok),
      };
      return builder;
    },
  };
}

vi.mock("@/lib/supabase/server", () => ({
  getServerUser: async () => ({ id: "user-1", email: "agent@traveliun.com" }),
  createSupabaseServiceClient: () => fakeDb(),
}));
vi.mock("@/lib/roles/current", () => ({
  currentCan: async (p: string) => Boolean(state.can[p]),
  currentCanOpen: async () => true,
}));
vi.mock("./draft-store", () => ({ loadDraft: async () => state.draft }));
vi.mock("./metrics", () => ({ getCurrentEmployeeId: async () => state.me }));
vi.mock("./audit", () => ({
  logAudit: async (a: { action: string; entity_id: string; meta?: Record<string, unknown> }) => (state.auditFails ? false : (state.audits.push(a), true)),
}));
vi.mock("./offer-status", () => ({ setOfferStatus: async (_db: unknown, offerId: string, to: string) => void state.statuses.push({ offerId, to }) }));
vi.mock("./operations", () => ({ confirmOffer: async (i: { offer_id: string }) => (state.confirmed.push(i.offer_id), { ok: true, id: "op-1" }) }));
vi.mock("./file-status-core", () => ({ loadFileStatus: async () => null }));
vi.mock("./client-whatsapp", () => ({
  clientWhatsappAllowed: async () => null,
  offerMessage: async (serial: string, updated: boolean) => ({
    text: updated ? `تم تحديث ملفك ${serial}` : `تم إعداد برنامج رحلتك ${serial}`,
    client: { employee_id: "emp-1", partner_company_id: null, customer: { arabic_name: "سالم", mobile: "+966500000000" } },
    link: `https://pkg.traveliun.com/client-offer/${serial}`,
    pdf: `https://pkg.traveliun.com/client-offer/${serial}/pdf`,
  }),
  sendOfferToClient: async (serial: string, updated: boolean, body?: string) => (state.sends.push({ serial, updated, body }), state.sendResult),
}));

const { prepareOfferMessage, sendOfferMessage, cancelFile, confirmFromBasic, deleteFiles } = await import("./file-status");

beforeEach(() => {
  state.can = { "offers.write": true, "operations.write": false, "dashboard.admin": false };
  state.me = "emp-1";
  state.draft = { id: "d1", data: { produced_serial: "AD-1" }, partner_company_id: null };
  state.offer = { id: "o1", status: "sent", employee_id: "emp-1", partner_company_id: null, total: 8970, currency: "SAR" };
  state.sentBefore = [];
  state.operation = null;
  state.audits = [];
  state.sends = [];
  state.sendResult = "sent";
  state.statuses = [];
  state.confirmed = [];
  state.drafts = [];
  state.deletes = [];
  state.auditFails = false;
});

describe("issuing sends nothing", () => {
  it("produceOfferFromDraft no longer calls the client's WhatsApp", () => {
    const src = fs.readFileSync(path.join(__dirname, "drafts.ts"), "utf8");
    expect(src).not.toMatch(/sendOfferToClient\s*\(/);
    expect(src).not.toMatch(/from "\.\/client-whatsapp"/);
  });
});

describe("«أرسل إلى العميل عبر واتساب» — reviewed, then sent, then recorded", () => {
  it("prepares the first message as «تم إعداد برنامج رحلتك» with the link and PDF to look at", async () => {
    const r = await prepareOfferMessage("d1");
    expect(r).toMatchObject({ ok: true, updated: false, toName: "سالم", blocked: null });
    if (r.ok) expect(r.pdf).toMatch(/\/pdf$/);
  });

  it("sends the text as the employee left it, and records the send with its version", async () => {
    const r = await sendOfferMessage("d1", "  نص بعد المراجعة  ");
    expect(r).toMatchObject({ ok: true, result: "sent" });
    expect(state.sends).toEqual([{ serial: "AD-1", updated: false, body: "نص بعد المراجعة" }]);
    expect(state.audits).toEqual([{ action: "offer.client_sent", entity: "offers", entity_id: "o1", meta: { result: "sent", version: 2, serial: "AD-1" } }]);
  });

  it("says «تم تحديث ملفك» once the client really had a version — a note outside 24 hours does not count", async () => {
    state.sentBefore = [{ action: "offer.client_sent", meta: { result: "window", version: 1 } }];
    expect(await prepareOfferMessage("d1")).toMatchObject({ updated: false });
    state.sentBefore = [{ action: "offer.client_sent", meta: { result: "sent", version: 1 } }];
    expect(await prepareOfferMessage("d1")).toMatchObject({ updated: true });
    // the client already has version 2, the newest: sending it again is not an update
    state.sentBefore = [{ action: "offer.client_sent", meta: { result: "sent", version: 2 } }];
    expect(await prepareOfferMessage("d1")).toMatchObject({ updated: false });
  });

  it("records the approved template as what it is", async () => {
    state.sendResult = "template";
    expect(await sendOfferMessage("d1", "نص")).toMatchObject({ ok: true, result: "template" });
    expect(state.audits[0]?.meta).toMatchObject({ result: "template", version: 2 });
  });

  it("records «أرسلته يدوياً» without touching WhatsApp", async () => {
    const r = await sendOfferMessage("d1", "", true);
    expect(r).toMatchObject({ ok: true, result: "manual" });
    expect(state.sends).toEqual([]);
    expect(state.audits[0]?.meta).toMatchObject({ result: "manual", version: 2 });
  });

  it("records nothing when the trial gate kept it from going", async () => {
    state.sendResult = "not_allowed";
    expect(await sendOfferMessage("d1", "نص")).toMatchObject({ ok: true, result: "not_allowed" });
    expect(state.audits).toEqual([]);
  });

  it("refuses a colleague's file, a partner's file and a cancelled one; a manager may send a colleague's", async () => {
    state.offer = { ...state.offer, employee_id: "emp-2" };
    expect(await sendOfferMessage("d1", "نص")).toEqual({ ok: false, error: "forbidden" });
    state.can["operations.write"] = true;
    expect(await sendOfferMessage("d1", "نص")).toMatchObject({ ok: true });
    state.offer = { ...state.offer, partner_company_id: "p-1" };
    expect(await sendOfferMessage("d1", "نص")).toEqual({ ok: false, error: "partner" });
    state.offer = { ...state.offer, partner_company_id: null, status: "cancelled" };
    expect(await prepareOfferMessage("d1")).toEqual({ ok: false, error: "cancelled" });
  });

  it("refuses an empty text, and anyone without offers.write", async () => {
    expect(await sendOfferMessage("d1", "   ")).toEqual({ ok: false, error: "empty" });
    state.can["offers.write"] = false;
    expect(await prepareOfferMessage("d1")).toEqual({ ok: false, error: "forbidden" });
  });
});

describe("«العميل أكّد» and «إلغاء الملف» from Basic", () => {
  it("confirms through the kanban's confirmation, never a cancelled offer", async () => {
    expect(await confirmFromBasic("d1", "phone")).toMatchObject({ ok: true, operationId: "op-1" });
    expect(state.confirmed).toEqual(["o1"]);
    state.offer = { ...state.offer, status: "cancelled" };
    expect(await confirmFromBasic("d1", "phone")).toEqual({ ok: false, error: "cancelled" });
  });

  it("a file cancelled here is not confirmed back to life from the kanban either", () => {
    const src = fs.readFileSync(path.join(__dirname, "operations.ts"), "utf8");
    const body = src.slice(src.indexOf("async function recordConfirmation"));
    const refusal = body.indexOf('=== "cancelled"');
    expect(refusal).toBeGreaterThan(-1);
    expect(refusal).toBeLessThan(body.indexOf("setOfferStatus("));
  });

  it("cancels with a reason before operations hold the file, and records it", async () => {
    expect(await cancelFile("d1", "")).toEqual({ ok: false, error: "empty" });
    expect(await cancelFile("d1", "العميل اعتذر")).toEqual({ ok: true });
    expect(state.statuses).toEqual([{ offerId: "o1", to: "cancelled" }]);
    expect(state.audits.at(-1)).toMatchObject({ action: "offer.cancelled", meta: { reason: "العميل اعتذر" } });
    state.operation = { id: "op-1" };
    expect(await cancelFile("d1", "سبب")).toEqual({ ok: false, error: "inOperations" });
  });
});

describe("«حذف» from the files list (the owner, 2026-10-17)", () => {
  const row = (id: string, over: Partial<(typeof state.drafts)[number]> = {}) => ({ id, title: null, data: {}, created_by: "emp-1", partner_company_id: null, ...over });

  it("deletes a draft, and an issued file with its offer while nothing is booked; never a partner's or a colleague's", async () => {
    state.drafts = [
      row("d0"),
      row("d1", { data: { produced_serial: "AD-1" } }),
      row("dp", { created_by: null, partner_company_id: "p-1" }),
      row("dx", { created_by: "emp-2" }),
      // made before its maker was recorded: not anyone's to delete
      row("dn", { created_by: null }),
    ];
    expect(await deleteFiles(["d0", "d1", "dp", "dx", "dn"])).toEqual({ ok: true, deleted: 2, refused: 3 });
    expect(state.deletes).toEqual(["offer_drafts", "offers", "offer_drafts"]);
    expect(state.audits.map((a) => a.action)).toEqual(["draft.deleted", "offer.deleted"]);
    // the offer's serial and total, and the draft as it was, so a wrong press can be rebuilt
    expect(state.audits[1]?.meta).toMatchObject({ serial: "AD-1", total: 8970, currency: "SAR", draft: { produced_serial: "AD-1" } });
  });

  it("deletes nothing when the audit row cannot be written", async () => {
    state.auditFails = true;
    state.drafts = [row("d0"), row("d1", { data: { produced_serial: "AD-1" } })];
    expect(await deleteFiles(["d0", "d1"])).toEqual({ ok: true, deleted: 0, refused: 2 });
    expect(state.deletes).toEqual([]);
  });

  it("never deletes a file operations holds — that one is cancelled from its case", async () => {
    state.operation = { id: "op-1" };
    state.drafts = [row("d1", { data: { produced_serial: "AD-1" } })];
    expect(await deleteFiles(["d1"])).toEqual({ ok: true, deleted: 0, refused: 1 });
    expect(state.deletes).toEqual([]);
  });

  it("a manager may delete a colleague's file; nobody without offers.write", async () => {
    state.drafts = [row("dx", { created_by: "emp-2" })];
    state.can["dashboard.admin"] = true;
    expect(await deleteFiles(["dx"])).toEqual({ ok: true, deleted: 1, refused: 0 });
    state.can["offers.write"] = false;
    expect(await deleteFiles(["dx"])).toEqual({ ok: false, error: "forbidden" });
  });
});
