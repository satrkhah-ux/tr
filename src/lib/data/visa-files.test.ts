/* eslint-disable @typescript-eslint/no-explicit-any -- a hand-made stand-in for the query builder */
import { beforeEach, describe, expect, it, vi } from "vitest";

const ME = "11111111-1111-4111-8111-111111111111";
const COLLEAGUE = "22222222-2222-4222-8222-222222222222";
const CATALOG = "33333333-3333-4333-8333-333333333333";
const SOME = "44444444-4444-4444-8444-444444444444";

type Row = Record<string, any>;
const world = {
  tables: {} as Record<string, Row[]>,
  permissions: [] as string[],
  dbCalls: 0,
  audits: [] as { action: string; meta: unknown }[],
  notes: [] as { conversationId: number; text: string }[],
  teletel: false,
  seq: 0,
  objects: new Map<string, { bytes: Uint8Array; contentType: string }>(),
  removed: [] as string[],
  /** what Teletel's messages endpoint returns for conversation 40123 */
  messages: [] as Row[],
  fetched: [] as { url: string; token: string | undefined }[],
  /** what the passport reader answers; null = the reader is not configured */
  reader: null as Row | null,
};

/** the part of the PostgREST builder the actions use, over plain arrays */
function builder(name: string) {
  world.dbCalls += 1;
  const rows = () => (world.tables[name] ??= []);
  const st = { op: "select", filters: [] as ((r: Row) => boolean)[], patch: {} as Row, ins: [] as Row[], order: null as null | [string, boolean], limit: Infinity, range: null as null | [number, number], one: false, maybe: false };
  const api: any = {
    select: () => api,
    insert: (r: Row | Row[]) => { st.op = "insert"; st.ins = Array.isArray(r) ? r : [r]; return api; },
    update: (p: Row) => { st.op = "update"; st.patch = p; return api; },
    eq: (k: string, v: unknown) => { st.filters.push((r) => r[k] === v); return api; },
    in: (k: string, vs: unknown[]) => { st.filters.push((r) => vs.includes(r[k])); return api; },
    is: (k: string, v: unknown) => { st.filters.push((r) => (r[k] ?? null) === v); return api; },
    like: (k: string, pat: string) => { st.filters.push((r) => String(r[k] ?? "").startsWith(pat.replace(/%$/, ""))); return api; },
    or: () => { throw new Error("or() is for workers without manage — not exercised here"); },
    order: (k: string, o?: { ascending?: boolean }) => { st.order = [k, o?.ascending !== false]; return api; },
    limit: (n: number) => { st.limit = n; return api; },
    range: (a: number, b: number) => { st.range = [a, b]; return api; },
    single: () => { st.one = true; return api; },
    maybeSingle: () => { st.maybe = true; return api; },
    then: (resolve: (v: unknown) => void, reject: (e: unknown) => void) => Promise.resolve(run()).then(resolve, reject),
  };
  function run() {
    if (st.op === "insert") {
      const made: Row[] = [];
      for (const r of st.ins) {
        const row: Row = { id: `row-${++world.seq}`, created_at: new Date().toISOString(), ...r };
        if (name === "visa_files") Object.assign(row, { status: "new", rev: 0, paid: 0, updated_at: row.created_at, ...r, id: `${String(++world.seq).padStart(8, "0")}-0000-4000-8000-000000000000` });
        if (name === "visa_files" && rows().some((x) => x.serial === row.serial)) return { data: null, error: { code: "23505" } };
        rows().push(row);
        made.push(row);
      }
      return st.one ? { data: made[0], error: null } : { data: made, error: null };
    }
    let hit = rows().filter((r) => st.filters.every((f) => f(r)));
    if (st.op === "update") {
      for (const r of hit) Object.assign(r, st.patch);
      return { data: hit.map((r) => ({ id: r.id })), error: null };
    }
    if (st.order) {
      const [k, asc] = st.order;
      hit = [...hit].sort((a, b) => (String(a[k]) < String(b[k]) ? -1 : String(a[k]) > String(b[k]) ? 1 : 0) * (asc ? 1 : -1));
    }
    if (st.range) hit = hit.slice(st.range[0], st.range[1] + 1);
    hit = hit.slice(0, st.limit);
    if (st.one) return hit[0] ? { data: hit[0], error: null } : { data: null, error: { code: "PGRST116" } };
    if (st.maybe) return { data: hit[0] ?? null, error: null };
    return { data: hit, error: null };
  }
  return api;
}

vi.mock("@/lib/supabase/server", () => ({
  getServerUser: async () => ({ id: "user" }),
  createSupabaseServiceClient: () => ({
    from: builder,
    storage: {
      from: () => ({
        upload: async (path: string, bytes: Uint8Array, opts: { contentType: string }) => (world.objects.set(path, { bytes, contentType: opts.contentType }), { error: null }),
        remove: async (paths: string[]) => (paths.forEach((x) => { world.objects.delete(x); world.removed.push(x); }), { error: null }),
        createSignedUrl: async (path: string, ttl: number) => ({ data: { signedUrl: `https://files.example/${path}?ttl=${ttl}` }, error: null }),
        download: async (path: string) => ({ data: new Blob([world.objects.get(path)!.bytes as BlobPart]), error: null }),
      }),
    },
  }),
}));
vi.mock("@/lib/roles/current", () => ({ currentPermissions: async () => world.permissions }));
vi.mock("@/lib/data/metrics", () => ({ getCurrentEmployeeId: async () => ME }));
vi.mock("@/lib/data/audit", () => ({ logAudit: async (a: { action: string; meta: unknown }) => (world.audits.push({ action: a.action, meta: a.meta }), true) }));
vi.mock("@/lib/providers/teletel", () => ({
  getTeletelConfig: () => (world.teletel ? { baseUrl: "https://t.example", token: "t", accountId: "1" } : null),
  addTeletelNote: async (conversationId: number, text: string) => (world.notes.push({ conversationId, text }), true),
  intlPhone: (s: string) => (s.startsWith("05") ? `+966${s.slice(1)}` : s),
  listOpenConversations: async () => ({ rows: [], at: 0 }),
  searchTeletelContacts: async () => [],
  teletelGet: async (path: string) =>
    path.startsWith("/conversations/40123/messages")
      ? { payload: path.includes("before=") ? [] : world.messages }
      : path === "/conversations/40123"
        ? { id: 40123, meta: { sender: { id: 77, name: "عميل تيلي", phone_number: "+966500000008" } } }
        : null,
}));
vi.mock("@/lib/providers/openai", () => ({ isOpenAIConfigured: () => world.reader !== null }));
vi.mock("@/lib/providers/mrz-vision", () => ({ readPassportImage: async () => (world.reader ? { ok: true, passport: world.reader, model: "m" } : { ok: false, error: "not_configured" }) }));

const actions = await import("./visa-files");

const seedCatalog = () => {
  world.tables.visas = [{
    id: CATALOG, country: "جورجيا", country_id: SOME, visa_type: "سياحية", sell_price: 300, sell_currency: "SAR", status: "Active",
    arabic_requirements: "1- صورة الجواز 2- صورة شخصية بخلفية بيضاء 3- حجز فندق 4- رسوم السفارة 100 ريال",
  }];
};
const NEW = { country: "جورجيا", applicants: 2, clientName: "عميل تجريبي", clientPhone: "0500000000", visaCatalogId: CATALOG };
const make = async (over: Record<string, unknown> = {}) => {
  const r = await actions.createVisaFile({ ...NEW, ...over });
  if (!r.ok) throw new Error(r.error);
  return r;
};

beforeEach(() => {
  world.tables = {};
  world.permissions = ["dashboard.admin"];
  world.dbCalls = 0;
  world.audits = [];
  world.notes = [];
  world.teletel = false;
  world.objects = new Map();
  world.removed = [];
  world.messages = [];
  world.fetched = [];
  world.reader = null;
  seedCatalog();
});

describe("nobody without a visa key gets past the door", () => {
  it("every action refuses first, before reading or writing anything", async () => {
    world.permissions = ["offers.write", "followups.work"];
    world.dbCalls = 0;
    const args: any[] = [SOME, SOME, SOME];
    for (const [name, fn] of Object.entries(actions) as [string, (...a: any[]) => Promise<any>][]) {
      const r = await fn(...args);
      expect(r, name).toMatchObject({ ok: false });
    }
    expect(world.dbCalls).toBe(0);
  });

  it("a worker cannot take payments or reassign a colleague's file; the management can", async () => {
    const file = await make();
    const worker = (id: string, name: string) => ({ id, arabic_name: name, status: "Active", extra_permission_keys: [], removed_permission_keys: [], roles: { permission_keys: ["visas.work"] } });
    world.tables.employees = [worker(ME, "أنا"), worker(COLLEAGUE, "زميل")];
    world.permissions = ["visas.work"];
    expect(await actions.addVisaPayment(file.id, { amount: 100 })).toMatchObject({ ok: false });
    // a colleague's file is closed to him; an unassigned one he may take for himself, but not hand to somebody else
    world.tables.visa_files[0].assigned_to = COLLEAGUE;
    expect(await actions.assignVisaFile(file.id, ME)).toMatchObject({ ok: false });
    world.tables.visa_files[0].assigned_to = null;
    expect(await actions.assignVisaFile(file.id, COLLEAGUE)).toEqual({ ok: false, error: "إعادة الإسناد من صلاحية الإدارة. يمكنك فقط استلام ملف غير مسند." });
    expect(await actions.assignVisaFile(file.id, ME)).toEqual({ ok: true });
    expect(world.tables.visa_files[0].assigned_to).toBe(ME);
    world.permissions = ["visas.manage"];
    expect(await actions.addVisaPayment(file.id, { amount: 100 })).toMatchObject({ ok: true });
  });
});

describe("the management account runs the whole department with nothing granted", () => {
  it("opens a file from the catalogue: serial, one traveller per applicant, the documents the list asks for, the default services", async () => {
    const r = await make();
    expect(r.serial).toMatch(/^VF-\d{2}-0001$/);
    const row = world.tables.visa_files[0];
    expect(row).toMatchObject({ status: "new", country: "جورجيا", visa_type: "سياحية", applicants: 2, client_phone: "+966500000000", created_by: ME, assigned_to: null, fee_service: 600, currency: "SAR" });
    expect(row.travelers).toHaveLength(2);
    // passport ×2, photo ×2, hotel — the embassy fee line is not a document
    expect(row.documents.map((d: Row) => d.kind)).toEqual(["passport", "passport", "photo", "photo", "hotel"]);
    expect(row.documents.every((d: Row) => d.travelerId === null || row.travelers.some((t: Row) => t.id === d.travelerId))).toBe(true);
    expect(row.services.length).toBeGreaterThan(0);
    expect(world.tables.visa_file_events[0]).toMatchObject({ kind: "created", by: ME });
    expect(world.audits.map((a) => a.action)).toContain("visa.file.created");
  });

  it("serials count on", async () => {
    await make({ conversationId: undefined });
    const second = await make({ clientName: "آخر" });
    expect(second.serial).toMatch(/-0002$/);
  });

  it("a worker's own file is his; the management's goes to the pool unless it names someone", async () => {
    world.permissions = ["visas.work"];
    await make();
    expect(world.tables.visa_files[0].assigned_to).toBe(ME);
    world.permissions = ["visas.manage"];
    await make({ clientName: "ثان" });
    expect(world.tables.visa_files[1].assigned_to).toBeNull();
  });

  it("refuses what cannot be a file, in Arabic, without throwing", async () => {
    expect(await actions.createVisaFile({ ...NEW, applicants: 0 })).toEqual({ ok: false, error: "عدد المتقدمين غير صالح." });
    expect(await actions.createVisaFile({ ...NEW, country: "" })).toMatchObject({ ok: false });
    expect(await actions.createVisaFile({ ...NEW, feeService: -5 })).toMatchObject({ ok: false });
    expect(await actions.createVisaFile({ ...NEW, visaCatalogId: SOME })).toEqual({ ok: false, error: "نوع التأشيرة غير موجود في القائمة." });
    expect(await actions.createVisaFile(null as never)).toMatchObject({ ok: false });
    expect(world.tables.visa_files ?? []).toHaveLength(0);
  });

  it("from a Teletel conversation: links the lead, leaves a private note, and will not open the same file twice", async () => {
    world.teletel = true;
    world.tables.client_leads = [{ id: "55555555-5555-4555-8555-555555555555", teletel_conversation_id: 40123 }];
    const r = await make({ conversationId: 40123 });
    expect(world.tables.visa_files[0]).toMatchObject({ conversation_id: 40123, lead_id: "55555555-5555-4555-8555-555555555555" });
    expect(world.notes).toEqual([{ conversationId: 40123, text: `فُتح ملف تأشيرة ${r.serial} للعميل (جورجيا)` }]);
    const again = await actions.createVisaFile({ ...NEW, conversationId: 40123 });
    expect(again).toEqual({ ok: false, error: `يوجد ملف مفتوح لنفس المحادثة والدولة: ${r.serial}.` });
    // another country for the same client is another file
    expect((await actions.createVisaFile({ ...NEW, visaCatalogId: undefined, country: "تركيا", conversationId: 40123 })).ok).toBe(true);
  });

  it("walks a file through its life: submitted fills the dates, the answer stamps the reply, delivery needs the approval", async () => {
    const { id } = await make();
    expect(await actions.setVisaStatus(id, "approved")).toMatchObject({ ok: false });
    expect(await actions.setVisaStatus(id, "ready")).toEqual({ ok: true });
    expect(await actions.setVisaStatus(id, "submitted", "قُدِّم في السفارة")).toEqual({ ok: true });
    const row = world.tables.visa_files[0];
    expect(row.status).toBe("submitted");
    expect(row.applied_at).toBeTruthy();
    expect(Date.parse(row.expected_reply_at)).toBeGreaterThan(Date.parse(row.applied_at) + 14 * 86_400_000);
    expect(await actions.setVisaStatus(id, "delivered")).toMatchObject({ ok: false });
    expect(await actions.setVisaStatus(id, "approved")).toEqual({ ok: true });
    expect(row.replied_at).toBeTruthy();
    expect(await actions.setVisaStatus(id, "delivered")).toEqual({ ok: true });
    const lines = world.tables.visa_file_events.filter((e) => e.kind === "status").map((e) => e.text);
    expect(lines).toHaveLength(4);
    expect(lines[1]).toContain("قُدِّم في السفارة");
    expect(world.audits.filter((a) => a.action === "visa.file.status")).toHaveLength(4);
  });

  it("uses the country's processing days from the settings when there are any", async () => {
    world.tables.app_settings = [{ key: "visa_processing_days", value: JSON.stringify({ جورجيا: 5 }) }];
    const { id } = await make();
    await actions.setVisaStatus(id, "submitted");
    const row = world.tables.visa_files[0];
    const days = (Date.parse(row.expected_reply_at) - Date.parse(row.applied_at)) / 86_400_000;
    expect(days).toBeGreaterThan(4.5);
    expect(days).toBeLessThan(6);
  });

  it("a payment is recorded with its event and audit; the amount must be real", async () => {
    const { id } = await make();
    expect(await actions.addVisaPayment(id, { amount: 0 })).toMatchObject({ ok: false });
    expect(await actions.addVisaPayment(id, { amount: 100, paidAt: "2999-01-01" })).toMatchObject({ ok: false });
    expect(await actions.addVisaPayment(id, { amount: 250.456, method: "تحويل" })).toEqual({ ok: true });
    expect(world.tables.visa_file_payments).toHaveLength(1);
    expect(world.tables.visa_file_payments[0]).toMatchObject({ file_id: id, amount: 250.46, method: "تحويل", by: ME });
    expect(world.tables.visa_file_events.at(-1)).toMatchObject({ kind: "payment" });
    expect(world.audits.at(-1)).toMatchObject({ action: "visa.file.payment", meta: { amount: 250.46, currency: "SAR" } });
  });

  it("edits fields, keeps the passport number out of everything it records, and refuses a bad number", async () => {
    const { id } = await make();
    expect(await actions.updateVisaFile(id, { expectedReplyAt: "2026-12-01", nextAction: "اتصال بالعميل" })).toEqual({ ok: true });
    expect(world.tables.visa_files[0]).toMatchObject({ next_action: "اتصال بالعميل" });
    expect(world.tables.visa_file_events.at(-1)?.text).toContain("موعد الرد المتوقع: 2026-12-01");
    const file = await actions.getVisaFile(id);
    if (!file.ok) throw new Error(file.error);
    const bad = await actions.updateVisaFile(id, { travelers: [{ ...file.file.travelers[0], passportNo: "سش" }] });
    expect(bad).toMatchObject({ ok: false });
  });

  it("assigns only to somebody who can open visa files", async () => {
    const { id } = await make();
    world.tables.employees = [
      { id: COLLEAGUE, arabic_name: "زميل", status: "Active", extra_permission_keys: [], removed_permission_keys: [], roles: { permission_keys: ["visas.work"] } },
      { id: SOME, arabic_name: "بعيد", status: "Active", extra_permission_keys: [], removed_permission_keys: [], roles: { permission_keys: ["offers.write"] } },
    ];
    expect(await actions.assignVisaFile(id, SOME)).toEqual({ ok: false, error: "هذا الموظف لا يعمل على ملفات التأشيرات." });
    expect(await actions.assignVisaFile(id, COLLEAGUE)).toEqual({ ok: true });
    expect(world.tables.visa_files[0].assigned_to).toBe(COLLEAGUE);
    expect(world.audits.at(-1)).toMatchObject({ action: "visa.file.assigned" });
  });

  it("the board counts what every file needs, and the file's page carries its timeline newest first", async () => {
    const a = await make({ clientName: "أول" });
    const b = await make({ clientName: "ثان", feeService: 100, feeEmbassy: 50 });
    await actions.addVisaPayment(b.id, { amount: 150 });
    // the table's trigger keeps paid right in the database; the stand-in does not run it
    world.tables.visa_files.find((f) => f.id === b.id)!.paid = 150;
    await actions.setVisaStatus(a.id, "ready");
    const board = await actions.getVisaBoard({ status: "open" });
    if (!board.ok) throw new Error(board.error);
    expect(board.board.counts.total).toBe(2);
    expect(board.board.counts.byStatus).toMatchObject({ new: 1, ready: 1 });
    expect(board.board.counts.unpaid).toEqual({ files: 1, due: { SAR: 600 } });
    expect(board.board.counts.missingDocs).toBe(2);
    expect(board.board.rows).toHaveLength(2);

    const page = await actions.getVisaFile(b.id);
    if (!page.ok) throw new Error(page.error);
    expect(page.file.paid).toBe(150);
    expect(page.payments).toHaveLength(1);
    expect(page.events.map((e) => e.kind).sort()).toEqual(["created", "payment"]);
    expect(JSON.stringify(page)).not.toContain("passportEnc");
  });
});

const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, ...Array.from({ length: 40 }, (_, i) => i)]);
const PDF = new TextEncoder().encode("%PDF-1.7 test");
const upload = (bytes: Uint8Array, name: string, type: string) => {
  const form = new FormData();
  form.append("file", new File([bytes as BlobPart], name, { type }));
  return form;
};
const firstDoc = (kind = "passport") => world.tables.visa_files[0].documents.find((d: Row) => d.kind === kind) as Row;

describe("documents", () => {
  it("an upload lands in the private bucket under a random name, marks the document received and is audited", async () => {
    const { id } = await make({ applicants: 1 });
    const doc = firstDoc();
    expect(await actions.uploadVisaDocument(id, doc.id, upload(JPEG, "جواز علي.jpg", "image/jpeg"))).toEqual({ ok: true });
    const stored = firstDoc();
    expect(stored.path).toMatch(new RegExp(`^visa-files/${id}/${doc.id}/[0-9a-f-]{36}\\.jpg$`));
    expect(stored.path).not.toContain("علي");
    expect(stored.fileName).toBe("جواز علي.jpg");
    expect(stored.receivedAt).toBeTruthy();
    expect(world.objects.get(stored.path)?.contentType).toBe("image/jpeg");
    expect(world.tables.visa_file_events.at(-1)).toMatchObject({ kind: "document" });
    expect(world.audits.at(-1)).toMatchObject({ action: "visa.file.document" });
  });

  it("a second upload replaces the first and removes the old paper", async () => {
    const { id } = await make({ applicants: 1 });
    const doc = firstDoc();
    await actions.uploadVisaDocument(id, doc.id, upload(JPEG, "a.jpg", "image/jpeg"));
    const first = firstDoc().path;
    await actions.uploadVisaDocument(id, doc.id, upload(PDF, "b.pdf", "application/pdf"));
    expect(firstDoc().path).not.toBe(first);
    expect(world.removed).toEqual([first]);
    expect(world.objects.has(first)).toBe(false);
  });

  it("refuses an empty file, a wrong type, bytes that are not what they claim, and a file too large — storing nothing", async () => {
    const { id } = await make({ applicants: 1 });
    const doc = firstDoc();
    const exe = Uint8Array.from([0x4d, 0x5a, 0x90, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(await actions.uploadVisaDocument(id, doc.id, upload(new Uint8Array(0), "x.jpg", "image/jpeg"))).toMatchObject({ ok: false });
    expect(await actions.uploadVisaDocument(id, doc.id, upload(JPEG, "x.html", "text/html"))).toMatchObject({ ok: false });
    expect(await actions.uploadVisaDocument(id, doc.id, upload(exe, "x.jpg", "image/jpeg"))).toMatchObject({ ok: false });
    expect(await actions.uploadVisaDocument(id, doc.id, upload(new Uint8Array(10 * 1024 * 1024 + 1).fill(0xff), "big.jpg", "image/jpeg"))).toEqual({ ok: false, error: "حجم الملف أكبر من 10 ميجابايت." });
    expect(await actions.uploadVisaDocument(id, "not-an-id", upload(JPEG, "x.jpg", "image/jpeg"))).toMatchObject({ ok: false });
    expect(await actions.uploadVisaDocument(id, SOME, upload(JPEG, "x.jpg", "image/jpeg"))).toEqual({ ok: false, error: "المستند غير موجود." });
    expect(await actions.uploadVisaDocument(id, doc.id, new FormData())).toMatchObject({ ok: false });
    expect(world.objects.size).toBe(0);
  });

  it("the link is audited first, lasts two minutes, and a missing paper has none", async () => {
    const { id } = await make({ applicants: 1 });
    const doc = firstDoc();
    expect(await actions.visaDocumentUrl(id, doc.id)).toMatchObject({ ok: false });
    await actions.uploadVisaDocument(id, doc.id, upload(JPEG, "a.jpg", "image/jpeg"));
    const r = await actions.visaDocumentUrl(id, doc.id);
    expect(r.ok && r.url).toContain("?ttl=120");
    expect(world.audits.at(-1)).toMatchObject({ action: "visa.file.doc_viewed" });
  });

  it("removing a document deletes its paper too", async () => {
    const { id } = await make({ applicants: 1 });
    const doc = firstDoc();
    await actions.uploadVisaDocument(id, doc.id, upload(JPEG, "a.jpg", "image/jpeg"));
    const path = firstDoc().path;
    expect(await actions.removeVisaDocument(id, doc.id)).toEqual({ ok: true });
    expect(world.tables.visa_files[0].documents.some((d: Row) => d.id === doc.id)).toBe(false);
    expect(world.objects.has(path)).toBe(false);
    expect(await actions.removeVisaDocument(id, doc.id)).toMatchObject({ ok: false });
  });

  it("adds a wanted document; one counts as attached to the application only once it is received", async () => {
    const { id } = await make({ applicants: 1 });
    const added = await actions.setVisaDocument(id, { kind: "insurance", required: true });
    if (!added.ok) throw new Error(added.error);
    expect(world.tables.visa_files[0].documents.at(-1)).toMatchObject({ id: added.docId, kind: "insurance", label: "تأمين سفر", required: true });
    expect(await actions.setVisaDocument(id, { docId: added.docId, kind: "insurance", submitted: true })).toEqual({ ok: false, error: "لا يُرفق بالطلب قبل استلامه." });
    expect(await actions.setVisaDocument(id, { docId: added.docId, kind: "insurance", required: false })).toMatchObject({ ok: true, docId: added.docId });
    expect(await actions.setVisaDocument(id, { kind: "insurance", travelerId: SOME })).toEqual({ ok: false, error: "المسافر غير موجود في الملف." });
    expect(await actions.setVisaDocument(id, { kind: "weird" as never })).toMatchObject({ ok: false });
  });
});

describe("the passport number is never stored or logged in the clear", () => {
  const NUMBER = "A12345678";
  beforeEach(() => {
    process.env.SETTINGS_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  });

  it("saved encrypted beside its last four digits; read back masked; revealed only through the audited action", async () => {
    const { id } = await make({ applicants: 1 });
    const page = await actions.getVisaFile(id);
    if (!page.ok) throw new Error(page.error);
    const saved = await actions.updateVisaFile(id, { travelers: [{ ...page.file.travelers[0], fullName: "مسافر تجريبي", passportNo: NUMBER }] });
    expect(saved).toEqual({ ok: true });

    const dump = JSON.stringify([world.tables, world.audits]);
    expect(dump).not.toContain(NUMBER);
    expect(world.tables.visa_files[0].travelers[0]).toMatchObject({ passportLast4: "5678" });
    expect(world.tables.visa_files[0].travelers[0].passportEnc).toBeTruthy();
    expect(world.audits.at(-1)).toMatchObject({ action: "visa.file.updated", meta: { fields: ["travelers+passport"] } });

    const again = await actions.getVisaFile(id);
    if (!again.ok) throw new Error(again.error);
    expect(again.file.travelers[0].passportNo).toBe("•••• 5678");
    // saving the page back as it was read leaves the number alone
    expect(await actions.updateVisaFile(id, { travelers: again.file.travelers })).toEqual({ ok: true });
    expect(world.tables.visa_files[0].travelers[0].passportLast4).toBe("5678");

    const revealed = await actions.revealVisaPassportNo(id, again.file.travelers[0].id);
    expect(revealed).toEqual({ ok: true, passportNo: NUMBER });
    expect(world.audits.at(-1)).toMatchObject({ action: "visa.file.passport.revealed" });
    expect(JSON.stringify(world.audits)).not.toContain(NUMBER);
  });

  it("without the vault key nothing is saved", async () => {
    delete process.env.SETTINGS_ENCRYPTION_KEY;
    const { id } = await make({ applicants: 1 });
    const page = await actions.getVisaFile(id);
    if (!page.ok) throw new Error(page.error);
    const r = await actions.updateVisaFile(id, { travelers: [{ ...page.file.travelers[0], passportNo: NUMBER }] });
    expect(r).toEqual({ ok: false, error: "تعذّر حفظ رقم الجواز: مفتاح التشفير غير مضبوط." });
    expect(JSON.stringify(world.tables)).not.toContain(NUMBER);
  });

  it("reading a passport photo hands back a partial traveller to confirm — audited first, saved nowhere", async () => {
    world.reader = { full_name: "ALI TEST", printed_name: "ALI TEST", number: "P1234567", nationality: "SAU", birth_date: "1990-05-01", expiry: "2031-01-01", failed: ["birth_date"] };
    const { id } = await make({ applicants: 1 });
    const doc = firstDoc();
    await actions.uploadVisaDocument(id, doc.id, upload(JPEG, "a.jpg", "image/jpeg"));
    const r = await actions.readVisaPassport(id, doc.id);
    expect(r).toEqual({
      ok: true,
      traveler: { fullName: "ALI TEST", passportNo: "P1234567", nationality: "السعودية", birthDate: "1990-05-01", passportExpiry: "2031-01-01" },
      failed: ["birth_date"],
    });
    expect(world.audits.at(-1)).toMatchObject({ action: "visa.file.passport.read" });
    expect(JSON.stringify(world.audits)).not.toContain("P1234567");
    expect(world.tables.visa_files[0].travelers[0]).toMatchObject({ passportEnc: null, passportLast4: null, fullName: "" });
    // only a passport paper is read
    const hotel = firstDoc("hotel");
    await actions.uploadVisaDocument(id, hotel.id, upload(JPEG, "h.jpg", "image/jpeg"));
    expect(await actions.readVisaPassport(id, hotel.id)).toEqual({ ok: false, error: "هذا المستند ليس جوازاً." });
  });

  it("reading a passport photo is off when the reader is not configured, and a PDF is refused", async () => {
    const { id } = await make({ applicants: 1 });
    const doc = firstDoc();
    expect(await actions.readVisaPassport(id, doc.id)).toMatchObject({ ok: false });
    await actions.uploadVisaDocument(id, doc.id, upload(PDF, "a.pdf", "application/pdf"));
    expect(await actions.readVisaPassport(id, doc.id)).toMatchObject({ ok: false });
  });
});

describe("Teletel", () => {
  const stubFetch = (script: (url: string) => Response) =>
    vi.stubGlobal("fetch", async (input: URL | string, init?: { headers?: Record<string, string> }) => {
      const url = String(input);
      world.fetched.push({ url, token: init?.headers?.api_access_token });
      return script(url);
    });
  const image = () => new Response(JPEG as BodyInit, { status: 200, headers: { "content-type": "image/jpeg" } });
  const message = { id: 9, created_at: 1_700_000_000, message_type: 0, attachments: [{ id: 5, file_type: "image", data_url: "https://t.example/rails/blob/passport%20photo.jpg?x=1" }] };

  it("pulls a conversation: the client, Murad's visa facts, the lead, and the images and PDFs (no addresses)", async () => {
    world.teletel = true;
    world.messages = [
      message,
      { id: 8, created_at: 1_699_000_000, message_type: 1, private: true, attachments: [{ id: 4, file_type: "image", data_url: "https://t.example/private.jpg" }] },
      { id: 7, created_at: 1_698_000_000, message_type: 0, attachments: [{ id: 3, file_type: "file", extension: "pdf", data_url: "https://t.example/a/statement.pdf" }, { id: 2, file_type: "audio", data_url: "https://t.example/v.ogg" }] },
    ];
    world.tables.client_leads = [{ id: SOME, teletel_conversation_id: 40123, name: "عميل من القائمة", phone: "+966500000009" }];
    world.tables.murad_log = [{ conversation_id: 40123, created_at: "2026-10-20", intake: { visa_flow: { country: "جورجيا", nationality: "سعودي", applicants: 2 } } }];
    const r = await actions.pullFromTeletel(40123);
    if (!r.ok) throw new Error(r.error);
    expect(r.pull).toMatchObject({ conversationId: 40123, contactId: 77, clientName: "عميل تيلي", clientPhone: "+966500000008", leadId: SOME, intake: { country: "جورجيا", nationality: "سعودي", applicants: 2 } });
    expect(r.pull.attachments.map((a) => [a.messageId, a.attachmentId, a.fileType, a.fileName, a.fromClient])).toEqual([[9, 5, "image", "passport photo.jpg", true], [7, 3, "pdf", "statement.pdf", true]]);
    expect(JSON.stringify(r)).not.toContain("t.example");
    expect(await actions.pullFromTeletel(-1)).toMatchObject({ ok: false });
    world.teletel = false;
    expect(await actions.pullFromTeletel(40123)).toMatchObject({ ok: false });
  });

  it("copies one attachment of the file's own conversation into a document, sending the token only to Teletel's host", async () => {
    world.teletel = true;
    world.messages = [message];
    const { id } = await make({ applicants: 1, conversationId: 40123 });
    const doc = firstDoc();
    stubFetch((url) => (url.startsWith("https://t.example/") ? new Response(null, { status: 302, headers: { location: "https://cdn.other.example/blob.jpg" } }) : image()));
    expect(await actions.importTeletelAttachment(id, { messageId: 9, attachmentId: 5, docId: doc.id })).toEqual({ ok: true });
    expect(world.fetched).toEqual([{ url: "https://t.example/rails/blob/passport%20photo.jpg?x=1", token: "t" }, { url: "https://cdn.other.example/blob.jpg", token: undefined }]);
    expect(firstDoc()).toMatchObject({ fromMessageId: 9, fileName: "passport photo.jpg" });
    expect(firstDoc().receivedAt).toBeTruthy();
    expect(world.objects.size).toBe(1);
    expect(world.tables.visa_file_events.at(-1)?.text).toContain("استيراد من تيلي تيل");
    vi.unstubAllGlobals();
  });

  it("looks the address up itself: an attachment that is not in the file's conversation is refused, and a file with no conversation too", async () => {
    world.teletel = true;
    world.messages = [message];
    const linked = await make({ applicants: 1, conversationId: 40123 });
    const loose = await make({ applicants: 1, clientName: "بلا محادثة" });
    stubFetch(() => image());
    const doc = (fileId: string) => world.tables.visa_files.find((f) => f.id === fileId)!.documents[0].id as string;
    expect(await actions.importTeletelAttachment(linked.id, { messageId: 9, attachmentId: 999, docId: doc(linked.id) })).toEqual({ ok: false, error: "المرفق لم يعد موجوداً في المحادثة." });
    expect(await actions.importTeletelAttachment(loose.id, { messageId: 9, attachmentId: 5, docId: doc(loose.id) })).toEqual({ ok: false, error: "هذا الملف غير مرتبط بمحادثة تيلي تيل." });
    expect(world.fetched).toEqual([]);
    vi.unstubAllGlobals();
  });

  it("refuses what is not a picture or a PDF, or too big, from the other side too", async () => {
    world.teletel = true;
    world.messages = [message];
    const { id } = await make({ applicants: 1, conversationId: 40123 });
    const docId = firstDoc().id as string;
    stubFetch(() => new Response("<html>login</html>", { status: 200, headers: { "content-type": "text/html" } }));
    expect(await actions.importTeletelAttachment(id, { messageId: 9, attachmentId: 5, docId })).toEqual({ ok: false, error: "صور (JPG أو PNG أو WEBP أو HEIC) أو ملف PDF فقط." });
    stubFetch(() => new Response(new Uint8Array(10 * 1024 * 1024 + 1) as BodyInit, { status: 200, headers: { "content-type": "image/jpeg" } }));
    expect(await actions.importTeletelAttachment(id, { messageId: 9, attachmentId: 5, docId })).toEqual({ ok: false, error: "حجم الملف أكبر من 10 ميجابايت." });
    stubFetch(() => new Response(null, { status: 500 }));
    expect(await actions.importTeletelAttachment(id, { messageId: 9, attachmentId: 5, docId })).toEqual({ ok: false, error: "تعذّر تنزيل المرفق من تيلي تيل." });
    expect(world.objects.size).toBe(0);
    vi.unstubAllGlobals();
  });
});
