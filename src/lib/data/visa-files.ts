"use server";

import { randomUUID } from "node:crypto";
import { decryptJson, encryptJson, isVaultConfigured } from "@/lib/crypto/secrets";
import { addTeletelNote, getTeletelConfig, intlPhone } from "@/lib/providers/teletel";
import { isOpenAIConfigured } from "@/lib/providers/openai";
import { readPassportImage } from "@/lib/providers/mrz-vision";
import { nationalityName } from "@/lib/operations/nationality";
import { MRZ_READABLE } from "@/lib/operations/client-passport";
import { riyadhDate } from "@/lib/operations/payments";
import { employeeWorksVisas, visaPeople, type VisaEmployeeRow } from "@/lib/visa-files/access";
import { buildBoard } from "@/lib/visa-files/board";
import {
  checkUpload, cleanFields, cleanFileName, cleanServices, cleanText, defaultServices, describeChange, diffFields, docPath, expectedDocs, fold, isUuid, money2, nextSerial,
  parseInstant, parseProcessingDays, planStatus, requirementLines, serialYear, sniffMime, stampSubmitted, UPLOAD_MESSAGE,
} from "@/lib/visa-files/rules";
import { blankTraveler, BOARD_COLS, boardRowToFile, mergeTravelers, rowToEvent, rowToPayment, storedTravelers, toColumns, type BoardDb, type StoredTraveler } from "@/lib/visa-files/rows";
import { audit, addEvents, BUCKET, db, employeeNames, ERR, gate, mutateFile, readFile } from "@/lib/visa-files/store";
import { downloadAttachment, findAttachment, pullConversation, searchConversations } from "@/lib/visa-files/teletel";
import {
  VISA_DOC_KINDS, VISA_DOC_LABEL, VISA_OPEN, VISA_STATUSES, VISA_STATUS_LABEL,
  type TeletelCandidate, type TeletelPull, type VisaActionResult, type VisaBoard, type VisaDoc, type VisaDocKind, type VisaEvent, type VisaFile, type VisaFilter, type VisaPayment, type VisaService, type VisaStatus, type VisaTraveler,
} from "@/lib/visa-files/types";
import { allRows } from "@/lib/data/all-rows";

/**
 * «ملفات التأشيرات» — the data layer (the owner, 2026-10-26). Every action checks the caller itself (visas.work to
 * work a file; visas.manage for the whole board, reassigning and payments; developer.access and dashboard.admin
 * pass both — see lib/visa-files/access.ts), reads and writes with the service client (the tables are closed to
 * sessions), writes audit_logs, a timeline line for what a person would want to see in the file, and answers an
 * expected failure with {ok:false, error} in Arabic — nothing throws to the screen.
 *
 * The rules (transitions, dates, documents, the upload gate) are pure in lib/visa-files/rules.ts; the board's
 * numbers in board.ts; the rows ⇄ VisaFile mapping, with the passport kept encrypted, in rows.ts.
 */

const fail = (error: string) => ({ ok: false as const, error });
const ID_OK = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n) && n > 0;

export type NewVisaFile = {
  country: string;
  countryId?: string | null;
  visaCatalogId?: string | null;
  visaType?: string | null;
  applicants: number;
  clientName: string;
  clientPhone?: string | null;
  conversationId?: number | null;
  contactId?: number | null;
  leadId?: string | null;
  assignedTo?: string | null;
  appliedAt?: string | null;
  services?: VisaService[];
  feeService?: number;
  feeEmbassy?: number;
  currency?: string;
  note?: string | null;
};
/**
 * `travelers`: replaces the list. A traveller keeps his stored passport number unless `passportNo` is a new number
 * (stored encrypted); the masked text getVisaFile returned, or null, leaves it; "" clears it.
 */
export type VisaFilePatch = Partial<Omit<NewVisaFile, "conversationId" | "contactId" | "leadId">> & {
  appointmentAt?: string | null;
  expectedReplyAt?: string | null;
  repliedAt?: string | null;
  nextAction?: string | null;
  nextActionAt?: string | null;
  travelers?: VisaTraveler[];
};

const encrypt = (p: { number: string; full_name: string; nationality: string }) => {
  if (!isVaultConfigured()) throw new Error("vault");
  return encryptJson(p);
};

async function setting(key: string): Promise<string | null> {
  const { data } = await db().from("app_settings").select("value").eq("key", key).maybeSingle();
  return (data as { value?: string } | null)?.value ?? null;
}

/** An active employee who works visa files: the only one a file may be handed to (he could not open it otherwise). */
async function assignable(employeeId: string): Promise<boolean> {
  const { data } = await db().from("employees").select("id, arabic_name, status, extra_permission_keys, removed_permission_keys, roles(permission_keys)").eq("id", employeeId).maybeSingle();
  return Boolean(data) && employeeWorksVisas(data as unknown as VisaEmployeeRow);
}

/** the management hands files to anyone; a worker may only take an unassigned one for himself */
const mayAssign = (caller: { manage: boolean; employeeId: string | null }, file: { assignedTo: string | null }, to: string | null) =>
  caller.manage || (to !== null && to === caller.employeeId && file.assignedTo === null);

// ---------- the board and one file ----------

/** the board: counters + the rows the filter selects (the department's board needs visas.manage; visas.work sees its own and the unassigned) */
export async function getVisaBoard(filter?: VisaFilter): Promise<VisaActionResult<{ board: VisaBoard }>> {
  const g = await gate();
  if (!g.ok) return g;
  const { caller } = g;
  try {
    let failed = false;
    const { data } = await allRows<BoardDb>(async (from, to) => {
      let q = db().from("visa_files").select(BOARD_COLS).order("id").range(from, to);
      if (!caller.manage) q = caller.employeeId ? q.or(`assigned_to.eq.${caller.employeeId},assigned_to.is.null`) : q.is("assigned_to", null);
      const r = await q;
      if (r.error) failed = true;
      return r;
    });
    if (failed) return fail(ERR.load);
    const files = data.map(boardRowToFile);

    let people: { id: string; name: string }[];
    if (caller.manage) {
      const { data: staff } = await db().from("employees").select("id, arabic_name, status, extra_permission_keys, removed_permission_keys, roles(permission_keys)").eq("status", "Active");
      people = visaPeople((staff ?? []) as unknown as VisaEmployeeRow[]);
      const known = new Set(people.map((p) => p.id));
      const others = [...new Set(files.map((f) => f.assignedTo).filter((id): id is string => Boolean(id) && !known.has(id as string)))];
      const names = await employeeNames(others);
      people.push(...others.map((id) => ({ id, name: names[id] ?? "—" })));
    } else {
      people = caller.employeeId ? [{ id: caller.employeeId, name: (await employeeNames([caller.employeeId]))[caller.employeeId] ?? "أنا" }] : [];
    }
    return { ok: true, board: buildBoard(files, filter ?? {}, people) };
  } catch {
    return fail(ERR.load);
  }
}

/** The file with its payments and timeline (newest first); `names` maps every employee id in them to his name. */
export async function getVisaFile(id: string): Promise<VisaActionResult<{ file: VisaFile; payments: VisaPayment[]; events: VisaEvent[]; names: Record<string, string> }>> {
  const g = await gate();
  if (!g.ok) return g;
  try {
    const read = await readFile(g.caller, id);
    if (!read.ok) return read;
    const [pay, ev] = await Promise.all([
      db().from("visa_file_payments").select("id, file_id, amount, method, note, paid_at, by").eq("file_id", id).order("paid_at", { ascending: false }),
      db().from("visa_file_events").select("id, file_id, at, by, kind, text").eq("file_id", id).order("at", { ascending: false }).limit(300),
    ]);
    if (pay.error || ev.error) return fail(ERR.load);
    const payments = (pay.data ?? []).map(rowToPayment);
    const events = (ev.data ?? []).map(rowToEvent);
    const names = await employeeNames([read.file.assignedTo, read.file.createdBy, ...payments.map((p) => p.by), ...events.map((e) => e.by)]);
    return { ok: true, file: read.file, payments, events, names };
  } catch {
    return fail(ERR.load);
  }
}

// ---------- create and edit ----------

export async function createVisaFile(input: NewVisaFile): Promise<VisaActionResult<{ id: string; serial: string }>> {
  const g = await gate();
  if (!g.ok) return g;
  const { caller } = g;
  if (!input || typeof input !== "object") return fail("بيانات الملف ناقصة.");
  try {
    const cleaned = cleanFields(input);
    if (!cleaned.ok) return fail(cleaned.error);
    const f = cleaned.set;
    if (!f.country) return fail("الدولة مطلوبة.");
    if (!f.clientName) return fail("اسم العميل مطلوب.");
    if (f.applicants === undefined) return fail("عدد المتقدمين مطلوب.");
    for (const n of [input.conversationId, input.contactId]) if (n != null && !ID_OK(n)) return fail("معرّف المحادثة غير صالح.");
    if (input.leadId != null && !isUuid(input.leadId)) return fail("معرّف العميل المحتمل غير صالح.");
    if (input.services !== undefined && !cleanServices(input.services).ok) return fail("قائمة الخدمات غير صالحة.");

    // the one who works files only (no manage) keeps what he opens; the management leaves it to the pool unless it names someone
    const assignedTo = caller.manage ? (f.assignedTo ?? null) : caller.employeeId;
    if (assignedTo && assignedTo !== caller.employeeId && !(await assignable(assignedTo))) return fail("هذا الموظف لا يعمل على ملفات التأشيرات.");

    const { data: cat } = f.visaCatalogId
      ? await db().from("visas").select("id, country, country_id, visa_type, sell_price, sell_currency, arabic_requirements").eq("id", f.visaCatalogId).maybeSingle()
      : { data: null };
    const catalog = cat as { country_id: string | null; visa_type: string | null; sell_price: number | null; sell_currency: string | null; arabic_requirements: string | null } | null;
    if (f.visaCatalogId && !catalog) return fail("نوع التأشيرة غير موجود في القائمة.");

    // the lead and the conversation are one link: either given finds the other
    let conversationId = input.conversationId ?? null;
    let leadId = input.leadId ?? null;
    if (leadId && !conversationId) {
      const { data: lead } = await db().from("client_leads").select("teletel_conversation_id").eq("id", leadId).maybeSingle();
      if (!lead) return fail("العميل المحتمل غير موجود.");
      conversationId = (lead as { teletel_conversation_id: number | null }).teletel_conversation_id ?? null;
    } else if (!leadId && conversationId) {
      const { data: lead } = await db().from("client_leads").select("id").eq("teletel_conversation_id", conversationId).maybeSingle();
      leadId = (lead as { id: string } | null)?.id ?? null;
    }
    const visaType = f.visaType ?? catalog?.visa_type ?? null;
    if (conversationId) {
      const { data: open } = await db().from("visa_files").select("serial, country, visa_type").eq("conversation_id", conversationId).in("status", [...VISA_OPEN, "approved"]);
      const twin = ((open ?? []) as { serial: string; country: string; visa_type: string | null }[]).find((o) => fold(o.country) === fold(f.country as string) && fold(o.visa_type ?? "") === fold(visaType ?? ""));
      if (twin) return fail(`يوجد ملف مفتوح لنفس المحادثة والدولة: ${twin.serial}.`);
    }

    const travelers: StoredTraveler[] = Array.from({ length: f.applicants }, () => blankTraveler(randomUUID()));
    const services = input.services !== undefined ? (cleanServices(input.services) as { services: VisaService[] }).services : defaultServices();
    const per = catalog?.sell_price && catalog.sell_price > 0 ? catalog.sell_price : null;
    const currency = f.currency ?? (catalog?.sell_currency && /^[A-Za-z]{3}$/.test(catalog.sell_currency) ? catalog.sell_currency.toUpperCase() : "SAR");
    const row = {
      ...toColumns({ ...f, assignedTo, countryId: f.countryId ?? catalog?.country_id ?? null, visaType, currency }),
      client_phone: f.clientPhone ? (intlPhone(f.clientPhone) ?? f.clientPhone) : null,
      fee_service: f.feeService ?? (per ? money2(per * f.applicants) : 0),
      fee_embassy: f.feeEmbassy ?? 0,
      conversation_id: conversationId,
      contact_id: input.contactId ?? null,
      lead_id: leadId,
      travelers,
      documents: expectedDocs(requirementLines(catalog?.arabic_requirements), travelers.map((t) => t.id)),
      services,
      created_by: caller.employeeId,
    };

    // the next serial after the year's highest; the unique constraint settles two files opened in the same instant
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const year = serialYear();
      const { data: last } = await db().from("visa_files").select("serial").like("serial", `VF-${String(year).padStart(2, "0")}-%`).order("serial", { ascending: false }).limit(1);
      const serial = nextSerial(year, (last as { serial: string }[] | null)?.[0]?.serial ?? null);
      const { data, error } = await db().from("visa_files").insert({ ...row, serial }).select("id, serial").single();
      if (error) {
        if (error.code === "23505") continue;
        return fail(ERR.db);
      }
      const made = data as { id: string; serial: string };
      await addEvents(made.id, caller.employeeId, [{ kind: "created", text: `فُتح الملف — ${f.country}${visaType ? ` (${visaType})` : ""} · ${f.applicants} متقدم` }]);
      await audit("visa.file.created", made.id, { serial: made.serial, country: f.country, applicants: f.applicants, conversation: conversationId, lead: leadId, catalog: f.visaCatalogId ?? null });
      // a private note for the team in the conversation — never a message to the client
      if (conversationId && getTeletelConfig()) await addTeletelNote(conversationId, `فُتح ملف تأشيرة ${made.serial} للعميل (${f.country})`).catch(() => false);
      return { ok: true, id: made.id, serial: made.serial };
    }
    return fail(ERR.db);
  } catch {
    return fail(ERR.db);
  }
}

export async function updateVisaFile(id: string, patch: VisaFilePatch): Promise<VisaActionResult> {
  const g = await gate();
  if (!g.ok) return g;
  const { caller } = g;
  if (!patch || typeof patch !== "object") return fail("لا توجد تعديلات.");
  try {
    const cleaned = cleanFields(patch);
    if (!cleaned.ok) return fail(cleaned.error);
    if (cleaned.set.clientPhone) cleaned.set.clientPhone = intlPhone(cleaned.set.clientPhone) ?? cleaned.set.clientPhone;
    let services: VisaService[] | undefined;
    if (patch.services !== undefined) {
      const s = cleanServices(patch.services);
      if (!s.ok) return fail(s.error);
      services = s.services;
    }
    const touched: string[] = [];
    const res = await mutateFile(caller, id, async (file, row) => {
      touched.length = 0;
      const changed = diffFields(file, cleaned.set);
      const events: { kind: VisaEvent["kind"]; text: string }[] = [];
      const columns: Record<string, unknown> = {};
      if ("assignedTo" in changed) {
        if (!mayAssign(caller, file, changed.assignedTo ?? null)) return { error: "إعادة الإسناد من صلاحية الإدارة." };
        if (changed.assignedTo && !(await assignable(changed.assignedTo))) return { error: "هذا الموظف لا يعمل على ملفات التأشيرات." };
        const names = await employeeNames([changed.assignedTo]);
        events.push({ kind: "edit", text: changed.assignedTo ? `الإسناد إلى ${names[changed.assignedTo] ?? "موظف"}` : "أُلغي الإسناد (الملف في القسم)" });
      }
      if (("feeService" in changed || "feeEmbassy" in changed || "currency" in changed) && file.paid > 0 && !caller.manage) return { error: "الرسوم لا تتغير بعد تسجيل دفعات — من صلاحية الإدارة." };
      const line = describeChange(changed);
      if (line) events.push({ kind: "edit", text: `تعديل: ${line}` });
      Object.assign(columns, toColumns(changed));
      touched.push(...Object.keys(changed));
      if (services && JSON.stringify(services) !== JSON.stringify(file.services)) {
        columns.services = services;
        events.push({ kind: "edit", text: `تحديث الخدمات (${services.filter((s) => s.done).length}/${services.length} منجزة)` });
        touched.push("services");
      }
      if (patch.travelers !== undefined) {
        const before = storedTravelers(row);
        const m = mergeTravelers(patch.travelers, before, { today: riyadhDate(), encrypt });
        if (!m.ok) return { error: m.error };
        if (JSON.stringify(m.travelers) !== JSON.stringify(before)) {
          columns.travelers = m.travelers;
          // the papers of a traveller who left the list stay on the file, no longer tied to him
          const kept = new Set(m.travelers.map((t) => t.id));
          if (file.documents.some((d) => d.travelerId && !kept.has(d.travelerId))) columns.documents = file.documents.map((d) => (d.travelerId && !kept.has(d.travelerId) ? { ...d, travelerId: null } : d));
          const passportChanged = m.travelers.some((t) => t.passportEnc !== (before.find((b) => b.id === t.id)?.passportEnc ?? null));
          events.push({ kind: "edit", text: "تعديل بيانات المسافرين" });
          touched.push(passportChanged ? "travelers+passport" : "travelers");
        }
      }
      return { patch: columns, events };
    });
    if (!res.ok) return res;
    if (touched.length) await audit("visa.file.updated", id, { fields: touched });
    if (touched.includes("assignedTo")) await audit("visa.file.assigned", id, { to: cleaned.set.assignedTo ?? null, via: "update" });
    return { ok: true };
  } catch {
    return fail(ERR.db);
  }
}

export async function setVisaStatus(id: string, status: VisaStatus, note?: string): Promise<VisaActionResult> {
  const g = await gate();
  if (!g.ok) return g;
  if (!(VISA_STATUSES as readonly string[]).includes(status)) return fail("الحالة غير صالحة.");
  const why = cleanText(note ?? null, 500);
  if (why === "bad") return fail("الملاحظة طويلة.");
  try {
    const days = status === "submitted" ? parseProcessingDays(await setting("visa_processing_days")) : {};
    const res = await mutateFile(g.caller, id, (file) => {
      const plan = planStatus(file, status, { processingDays: days });
      if (!plan.ok) return { error: plan.error };
      const attached = status === "submitted" ? stampSubmitted(file.documents, new Date().toISOString()) : null;
      return {
        patch: { status, ...toColumns(plan.patch), ...(attached ? { documents: attached } : {}) },
        events: [{ kind: "status", text: `الحالة: من «${VISA_STATUS_LABEL[file.status]}» إلى «${VISA_STATUS_LABEL[status]}»${why ? ` — ${why}` : ""}` }],
      };
    });
    if (!res.ok) return res;
    await audit("visa.file.status", id, { from: res.file.status, to: status });
    return { ok: true };
  } catch {
    return fail(ERR.db);
  }
}

export async function assignVisaFile(id: string, employeeId: string | null): Promise<VisaActionResult> {
  const g = await gate();
  if (!g.ok) return g;
  if (employeeId !== null && !isUuid(employeeId)) return fail("الموظف غير صالح.");
  try {
    if (employeeId && !(await assignable(employeeId))) return fail("هذا الموظف لا يعمل على ملفات التأشيرات.");
    const name = employeeId ? ((await employeeNames([employeeId]))[employeeId] ?? "موظف") : null;
    const res = await mutateFile(g.caller, id, (file) =>
      file.assignedTo === employeeId
        ? { patch: {} }
        : !mayAssign(g.caller, file, employeeId)
          ? { error: "إعادة الإسناد من صلاحية الإدارة. يمكنك فقط استلام ملف غير مسند." }
          : { patch: { assigned_to: employeeId }, events: [{ kind: "edit", text: name ? `الإسناد إلى ${name}` : "أُلغي الإسناد (الملف في القسم)" }] },
    );
    if (!res.ok) return res;
    if (res.file.assignedTo !== employeeId) await audit("visa.file.assigned", id, { from: res.file.assignedTo, to: employeeId });
    return { ok: true };
  } catch {
    return fail(ERR.db);
  }
}

export async function setVisaServices(id: string, services: VisaService[]): Promise<VisaActionResult> {
  const g = await gate();
  if (!g.ok) return g;
  const s = cleanServices(services);
  if (!s.ok) return fail(s.error);
  try {
    const res = await mutateFile(g.caller, id, (file) =>
      JSON.stringify(s.services) === JSON.stringify(file.services)
        ? { patch: {} }
        : { patch: { services: s.services }, events: [{ kind: "edit", text: `تحديث الخدمات (${s.services.filter((x) => x.done).length}/${s.services.length} منجزة)` }] },
    );
    if (!res.ok) return res;
    await audit("visa.file.updated", id, { fields: ["services"] });
    return { ok: true };
  } catch {
    return fail(ERR.db);
  }
}

/** a payment (the management only); visa_files.paid follows from the table's trigger, so it cannot drift */
export async function addVisaPayment(id: string, p: { amount: number; method?: string | null; note?: string | null; paidAt?: string }): Promise<VisaActionResult> {
  const g = await gate("manage");
  if (!g.ok) return g;
  const amount = typeof p?.amount === "number" && Number.isFinite(p.amount) && p.amount > 0 && p.amount <= 10_000_000 ? money2(p.amount) : null;
  if (amount === null) return fail("المبلغ غير صالح.");
  const method = cleanText(p.method ?? null, 40);
  const note = cleanText(p.note ?? null, 300);
  if (method === "bad" || note === "bad") return fail("بيانات الدفعة غير صالحة.");
  const paidAt = p.paidAt ? parseInstant(p.paidAt, "noon") : new Date().toISOString();
  if (!paidAt) return fail("تاريخ الدفعة غير صالح.");
  if (Date.parse(paidAt) > Date.now() + 36 * 3600_000) return fail("تاريخ الدفعة في المستقبل.");
  try {
    const read = await readFile(g.caller, id);
    if (!read.ok) return read;
    const { error } = await db().from("visa_file_payments").insert({ file_id: id, amount, method, note, paid_at: paidAt, by: g.caller.employeeId });
    if (error) return fail(ERR.db);
    const c = read.file.currency;
    await addEvents(id, g.caller.employeeId, [{ kind: "payment", text: `دفعة ${amount} ${c}${method ? ` (${method})` : ""}${note ? ` — ${note}` : ""}` }]);
    await audit("visa.file.payment", id, { amount, currency: c, method });
    return { ok: true };
  } catch {
    return fail(ERR.db);
  }
}

export async function addVisaNote(id: string, text: string, kind: "note" | "contact" = "note"): Promise<VisaActionResult> {
  const g = await gate();
  if (!g.ok) return g;
  const t = cleanText(text, 2000);
  if (t === "bad" || t === null) return fail("اكتب الملاحظة (حتى 2000 حرف).");
  if (kind !== "note" && kind !== "contact") return fail("نوع الملاحظة غير صالح.");
  try {
    const read = await readFile(g.caller, id);
    if (!read.ok) return read;
    await addEvents(id, g.caller.employeeId, [{ kind, text: t }]);
    await db().from("visa_files").update({ updated_at: new Date().toISOString() }).eq("id", id);
    return { ok: true };
  } catch {
    return fail(ERR.db);
  }
}

// ---------- documents ----------

/** documents: expected ones come from the catalogue's requirements; «received» when a file is attached */
export async function setVisaDocument(id: string, doc: { docId?: string; kind: VisaDocKind; label?: string; travelerId?: string | null; required?: boolean; submitted?: boolean }): Promise<VisaActionResult<{ docId: string }>> {
  const g = await gate();
  if (!g.ok) return g;
  if (!(VISA_DOC_KINDS as readonly string[]).includes(doc?.kind)) return fail("نوع المستند غير صالح.");
  const label = doc.label === undefined ? undefined : cleanText(doc.label, 120);
  if (label === "bad") return fail("اسم المستند غير صالح.");
  if (doc.docId !== undefined && !isUuid(doc.docId)) return fail("المستند غير صالح.");
  try {
    let docId = doc.docId ?? randomUUID();
    const res = await mutateFile(g.caller, id, (file) => {
      if (doc.travelerId && !file.travelers.some((t) => t.id === doc.travelerId)) return { error: "المسافر غير موجود في الملف." };
      const old = doc.docId ? file.documents.find((d) => d.id === doc.docId) : undefined;
      if (doc.docId && !old) return { error: "المستند غير موجود." };
      if (doc.submitted && old && !old.receivedAt) return { error: "لا يُرفق بالطلب قبل استلامه." };
      const next: VisaDoc = {
        ...(old ?? { id: docId, path: null, fileName: null, receivedAt: null, submittedAt: null, fromMessageId: null, travelerId: null, required: true }),
        kind: doc.kind,
        label: label ?? old?.label ?? VISA_DOC_LABEL[doc.kind],
        ...(doc.travelerId !== undefined ? { travelerId: doc.travelerId } : {}),
        ...(doc.required !== undefined ? { required: Boolean(doc.required) } : {}),
        ...(doc.submitted !== undefined ? { submittedAt: doc.submitted ? new Date().toISOString() : null } : {}),
      };
      docId = next.id;
      const text = !old ? `إضافة مستند مطلوب: ${next.label}` : doc.submitted !== undefined ? `${next.label}: ${doc.submitted ? "أُرفق بالطلب" : "أُزيل من الطلب"}` : `تعديل المستند: ${next.label}`;
      return { patch: { documents: old ? file.documents.map((d) => (d.id === old.id ? next : d)) : [...file.documents, next] }, events: [{ kind: "document", text }] };
    });
    if (!res.ok) return res;
    await audit("visa.file.document", id, { doc: docId, op: doc.docId ? "edit" : "add", kind: doc.kind });
    return { ok: true, docId };
  } catch {
    return fail(ERR.db);
  }
}

/** put the bytes in the private bucket and mark the document received (the old file, if any, goes after the new one is safe) */
async function storeDocument(
  caller: Parameters<typeof mutateFile>[0], fileId: string, docId: string,
  bytes: Uint8Array, mime: string, fileName: string, fromMessageId: number | null, how: string,
): Promise<VisaActionResult> {
  const path = docPath(fileId, docId, mime);
  const up = await db().storage.from(BUCKET).upload(path, bytes, { contentType: mime, upsert: false });
  if (up.error) return fail("تعذّر رفع الملف. حاول مرة أخرى.");
  const prev = { path: null as string | null };
  const res = await mutateFile(caller, fileId, (file) => {
    const doc = file.documents.find((d) => d.id === docId);
    if (!doc) return { error: "المستند غير موجود." };
    prev.path = doc.path;
    const next: VisaDoc = { ...doc, path, fileName, receivedAt: new Date().toISOString(), fromMessageId };
    return { patch: { documents: file.documents.map((d) => (d.id === docId ? next : d)) }, events: [{ kind: "document", text: `${how}: ${doc.label}` }] };
  });
  if (!res.ok) {
    await db().storage.from(BUCKET).remove([path]);
    return res;
  }
  if (prev.path && prev.path !== path) await db().storage.from(BUCKET).remove([prev.path]);
  await audit("visa.file.document", fileId, { doc: docId, op: how, bytes: bytes.length, from_teletel: fromMessageId !== null });
  return { ok: true };
}

export async function uploadVisaDocument(id: string, docId: string, form: FormData): Promise<VisaActionResult> {
  const g = await gate();
  if (!g.ok) return g;
  if (!isUuid(docId)) return fail("المستند غير صالح.");
  const file = form instanceof FormData ? form.get("file") : null;
  if (!(file instanceof File)) return fail("اختر الملف أولاً.");
  try {
    const read = await readFile(g.caller, id);
    if (!read.ok) return read;
    if (!read.file.documents.some((d) => d.id === docId)) return fail("المستند غير موجود.");
    const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
    const gateResult = checkUpload({ size: file.size, declaredType: file.type, head });
    if (!gateResult.ok) return fail(UPLOAD_MESSAGE[gateResult.problem]);
    return await storeDocument(g.caller, id, docId, new Uint8Array(await file.arrayBuffer()), gateResult.mime, cleanFileName(file.name), null, "رفع ملف");
  } catch {
    return fail(ERR.db);
  }
}

/** a 2-minute link to the paper; the read is audited first and the link withheld if the audit fails */
export async function visaDocumentUrl(id: string, docId: string): Promise<VisaActionResult<{ url: string }>> {
  const g = await gate();
  if (!g.ok) return g;
  try {
    const read = await readFile(g.caller, id);
    if (!read.ok) return read;
    const doc = read.file.documents.find((d) => d.id === docId);
    if (!doc?.path) return fail("لا يوجد ملف مرفق لهذا المستند.");
    if (!(await audit("visa.file.doc_viewed", id, { doc: docId, kind: doc.kind }))) return fail("تعذّر تسجيل الاطلاع. حاول مرة أخرى.");
    const signed = await db().storage.from(BUCKET).createSignedUrl(doc.path, 120);
    return signed.error || !signed.data?.signedUrl ? fail("تعذّر فتح الملف.") : { ok: true, url: signed.data.signedUrl };
  } catch {
    return fail(ERR.db);
  }
}

export async function removeVisaDocument(id: string, docId: string): Promise<VisaActionResult> {
  const g = await gate();
  if (!g.ok) return g;
  try {
    const prev = { path: null as string | null, label: "" };
    const res = await mutateFile(g.caller, id, (file) => {
      const doc = file.documents.find((d) => d.id === docId);
      if (!doc) return { error: "المستند غير موجود." };
      prev.path = doc.path;
      prev.label = doc.label;
      return { patch: { documents: file.documents.filter((d) => d.id !== docId) }, events: [{ kind: "document", text: `حذف المستند: ${doc.label}` }] };
    });
    if (!res.ok) return res;
    if (prev.path) await db().storage.from(BUCKET).remove([prev.path]);
    await audit("visa.file.document", id, { doc: docId, op: "remove", had_file: Boolean(prev.path) });
    return { ok: true };
  } catch {
    return fail(ERR.db);
  }
}

// ---------- Teletel ----------

const NO_TELETEL = "تيلي تيل غير مضبوط في هذا النظام.";

/** Teletel: find a conversation, pull the client's data and attachments into a file, copy an attachment into the file's documents */
export async function searchTeletelForVisa(query: string): Promise<VisaActionResult<{ candidates: TeletelCandidate[] }>> {
  const g = await gate();
  if (!g.ok) return g;
  const q = typeof query === "string" ? query.trim() : "";
  if (q.length < 2 || q.length > 80) return fail("اكتب حرفين على الأقل من الاسم أو الجوال.");
  if (!getTeletelConfig()) return fail(NO_TELETEL);
  const candidates = await searchConversations(q);
  return candidates ? { ok: true, candidates } : fail("تعذّر الاتصال بتيلي تيل. حاول بعد قليل.");
}

export async function pullFromTeletel(conversationId: number): Promise<VisaActionResult<{ pull: TeletelPull }>> {
  const g = await gate();
  if (!g.ok) return g;
  if (!ID_OK(conversationId)) return fail("معرّف المحادثة غير صالح.");
  if (!getTeletelConfig()) return fail(NO_TELETEL);
  try {
    const pull = await pullConversation(conversationId);
    return pull ? { ok: true, pull } : fail("لم نجد المحادثة في تيلي تيل.");
  } catch {
    return fail("تعذّر قراءة المحادثة من تيلي تيل.");
  }
}

/** one attachment of the file's own conversation → a document of the file (size and real type checked; the address is looked up here, never taken from the screen) */
export async function importTeletelAttachment(id: string, a: { messageId: number; attachmentId: number; docId: string }): Promise<VisaActionResult> {
  const g = await gate();
  if (!g.ok) return g;
  if (!ID_OK(a?.messageId) || !ID_OK(a?.attachmentId) || !isUuid(a?.docId)) return fail("المرفق غير صالح.");
  if (!getTeletelConfig()) return fail(NO_TELETEL);
  try {
    const read = await readFile(g.caller, id);
    if (!read.ok) return read;
    if (!read.file.conversationId) return fail("هذا الملف غير مرتبط بمحادثة تيلي تيل.");
    if (!read.file.documents.some((d) => d.id === a.docId)) return fail("المستند غير موجود.");
    const found = await findAttachment(read.file.conversationId, a.messageId, a.attachmentId);
    if (!found) return fail("المرفق لم يعد موجوداً في المحادثة.");
    const got = await downloadAttachment(found.url);
    if (!got.ok) return fail(got.error === "too_large" ? UPLOAD_MESSAGE.too_large : "تعذّر تنزيل المرفق من تيلي تيل.");
    const checked = checkUpload({ size: got.size, declaredType: got.contentType, head: got.bytes.subarray(0, 16) });
    if (!checked.ok) return fail(UPLOAD_MESSAGE[checked.problem]);
    return await storeDocument(g.caller, id, a.docId, got.bytes, checked.mime, cleanFileName(found.fileName), a.messageId, "استيراد من تيلي تيل");
  } catch {
    return fail(ERR.db);
  }
}

/**
 * reads the passport image of a document into a traveller (the existing MRZ reader), for the employee to confirm —
 * never saved here. `failed` names the fields whose check digit did not match: compare those with the passport.
 */
export async function readVisaPassport(id: string, docId: string): Promise<VisaActionResult<{ traveler: Partial<VisaTraveler>; failed: string[] }>> {
  const g = await gate();
  if (!g.ok) return g;
  try {
    const read = await readFile(g.caller, id);
    if (!read.ok) return read;
    const doc = read.file.documents.find((d) => d.id === docId);
    if (!doc?.path) return fail("لا توجد صورة مرفقة لهذا المستند.");
    if (doc.kind !== "passport") return fail("هذا المستند ليس جوازاً.");
    if (!isOpenAIConfigured()) return fail("قراءة الجواز غير مفعّلة في هذا النظام.");
    const file = await db().storage.from(BUCKET).download(doc.path);
    if (file.error || !file.data) return fail("تعذّر فتح صورة الجواز.");
    const bytes = Buffer.from(await file.data.arrayBuffer());
    const mime = sniffMime(bytes) ?? "";
    if (!MRZ_READABLE.test(mime)) return fail("القراءة تعمل مع صور JPG أو PNG أو WEBP فقط، وليس PDF.");
    // identity data is about to be read: audited first, withheld if the trail cannot be written
    if (!(await audit("visa.file.passport.read", id, { doc: docId }))) return fail("تعذّر تسجيل الاطلاع. حاول مرة أخرى.");
    const result = await readPassportImage({ mime, bytes }, riyadhDate());
    if (!result.ok) return fail(result.error === "not_configured" ? "قراءة الجواز غير مفعّلة في هذا النظام." : "تعذّرت قراءة الجواز. أدخل البيانات يدوياً.");
    const p = result.passport;
    if (!p) return fail("لم نجد سطري الجواز في الصورة. أدخل البيانات يدوياً أو صوّر الصفحة من جديد.");
    return {
      ok: true,
      traveler: { fullName: p.printed_name || p.full_name, passportNo: p.number, nationality: nationalityName(p.nationality), birthDate: p.birth_date, passportExpiry: p.expiry },
      failed: p.failed,
    };
  } catch {
    return fail("تعذّرت قراءة الجواز.");
  }
}

/** the whole passport number of one traveller, for filling the embassy's form — audited first, withheld if the audit fails */
export async function revealVisaPassportNo(id: string, travelerId: string): Promise<VisaActionResult<{ passportNo: string }>> {
  const g = await gate();
  if (!g.ok) return g;
  try {
    const read = await readFile(g.caller, id);
    if (!read.ok) return read;
    const t = storedTravelers(read.row).find((x) => x.id === travelerId);
    if (!t?.passportEnc) return fail("لا يوجد رقم جواز محفوظ لهذا المسافر.");
    if (!(await audit("visa.file.passport.revealed", id, { traveler: travelerId }))) return fail("تعذّر تسجيل الاطلاع. حاول مرة أخرى.");
    if (!isVaultConfigured()) return fail("مفتاح التشفير غير مضبوط.");
    const p = decryptJson<{ number?: string }>(t.passportEnc);
    return p?.number ? { ok: true, passportNo: p.number } : fail("تعذّر فك تشفير الرقم.");
  } catch {
    return fail(ERR.load);
  }
}

/** the catalogue rows for a country (price, requirements) — to start a file from; an empty country lists them all */
export async function visaCatalogFor(country: string): Promise<VisaActionResult<{ rows: { id: string; visaType: string | null; sellPrice: number | null; sellCurrency: string | null; requirements: string[] }[] }>> {
  const g = await gate();
  if (!g.ok) return g;
  try {
    // the sell side only: the buy price is never selected
    const { data, error } = await db().from("visas").select("id, country, visa_type, sell_price, sell_currency, arabic_requirements, status");
    if (error) return fail(ERR.load);
    const want = fold(typeof country === "string" ? country : "");
    const rows = ((data ?? []) as { id: string; country: string | null; visa_type: string | null; sell_price: number | null; sell_currency: string | null; arabic_requirements: string | null; status: string | null }[])
      .filter((r) => (r.status ?? "Active") === "Active" && (!want || fold(r.country ?? "") === want))
      .map((r) => ({ id: r.id, visaType: r.visa_type, sellPrice: r.sell_price === null ? null : Number(r.sell_price), sellCurrency: r.sell_currency, requirements: requirementLines(r.arabic_requirements) }));
    return { ok: true, rows };
  } catch {
    return fail(ERR.load);
  }
}
