"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { currentCan } from "@/lib/roles/current";
import { getCurrentEmployeeId } from "./metrics";
import { logAudit } from "./audit";
import { messageClient } from "./client-whatsapp";
import { couponWith, db, getCampaign, recipients, site, type Campaign, type Coupon } from "./discounts";
import { whatsappTemplateStatus } from "@/lib/providers/teletel";
import { WA_TEMPLATES, waParams, waPreview } from "@/lib/operations/client-messages";
import { AUDIENCE_LABEL, arabicDate, couponCode, couponState, discountLabel, readScan, type Audience, type CouponState, type DiscountKind } from "@/lib/discounts/rules";

type Fail = { ok: false; error: string };

export type CampaignInput = {
  title: string;
  kind: DiscountKind;
  value: number;
  applies_to: "package" | "any";
  valid_days: number;
  audience: Audience;
  audience_days: number | null;
};

function inputError(i: CampaignInput): string | null {
  if (!i.title || i.title.length > 120) return "اكتب اسماً للحملة";
  if (i.kind !== "amount" && i.kind !== "percent") return "اختر نوع الخصم";
  if (!(i.value > 0) || (i.kind === "percent" && i.value > 100) || i.value > 100_000) return "قيمة الخصم غير صحيحة";
  if (i.applies_to !== "package" && i.applies_to !== "any") return "اختر على ماذا يطبّق الخصم";
  if (!Number.isInteger(i.valid_days) || i.valid_days < 1 || i.valid_days > 365) return "الصلاحية من 1 إلى 365 يوماً";
  if (!(i.audience in AUDIENCE_LABEL)) return "اختر من يستلم الكوبون";
  if (i.audience === "older" && !(Number.isInteger(i.audience_days) && (i.audience_days ?? 0) > 0)) return "اكتب عدد الأيام";
  return null;
}

/** How many a choice of recipients reaches — shown before the campaign is made. */
export async function countAudience(audience: Audience, days: number | null): Promise<number> {
  if (!(await currentCan("discounts.manage"))) return 0;
  if (!(audience in AUDIENCE_LABEL)) return 0;
  return (await recipients(audience, days)).length;
}

/** «أنشئ الحملة»: the campaign and one coupon per recipient — nothing is sent yet. */
export async function createCampaign(input: CampaignInput): Promise<{ ok: true; id: string } | Fail> {
  if (!(await currentCan("discounts.manage"))) return { ok: false, error: "لا صلاحية" };
  const i: CampaignInput = {
    ...input,
    title: String(input.title ?? "").trim(),
    value: Number(input.value),
    valid_days: Number(input.valid_days),
    audience_days: input.audience === "older" ? Number(input.audience_days) : null,
  };
  const bad = inputError(i);
  if (bad) return { ok: false, error: bad };
  const people = await recipients(i.audience, i.audience_days);
  if (!people.length) return { ok: false, error: "لا يوجد عملاء بهذا الاختيار" };
  const s = db();
  const { data, error } = await s
    .from("discount_campaigns")
    .insert({ ...i, value: Math.round(i.value * 100) / 100, created_by: await getCurrentEmployeeId() })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: "تعذّر إنشاء الحملة" };
  const id = (data as { id: string }).id;
  // set again when each coupon is sent: the days count from the client's message
  const expires = new Date(Date.now() + i.valid_days * 86_400_000).toISOString();
  const rows = people.map((p) => ({
    campaign_id: id,
    code: couponCode(randomBytes(6)),
    token: randomBytes(24).toString("base64url"),
    client_name: p.name,
    phone: p.phone,
    expires_at: expires,
  }));
  for (let k = 0; k < rows.length; k += 500) {
    const { error: e } = await s.from("discount_coupons").insert(rows.slice(k, k + 500));
    if (e) {
      await s.from("discount_campaigns").delete().eq("id", id);
      return { ok: false, error: "تعذّر إنشاء الكوبونات، أعد المحاولة" };
    }
  }
  await logAudit({ action: "discounts.campaign_created", entity: "discount_campaigns", entity_id: id, meta: { coupons: rows.length, audience: i.audience } });
  revalidatePath("/discounts");
  return { ok: true, id };
}

/** Leave one client out of the campaign (or bring them back) — before their coupon goes. */
export async function setExcluded(couponId: string, excluded: boolean): Promise<{ ok: true } | Fail> {
  if (!(await currentCan("discounts.manage"))) return { ok: false, error: "لا صلاحية" };
  if (!/^[0-9a-f-]{36}$/.test(couponId)) return { ok: false, error: "كوبون غير معروف" };
  const { error } = await db().from("discount_coupons").update({ excluded: !!excluded }).eq("id", couponId).is("sent_at", null);
  return error ? { ok: false, error: "تعذّر الحفظ" } : { ok: true };
}

const RESULT_LABEL: Record<string, string> = {
  sent: "أُرسل",
  template: "أُرسل",
  window: "لم يُرسل (القالب)",
  no_phone: "بلا رقم",
  unreachable: "تعذّر الوصول",
  partner: "عميل شريك",
  off: "رسائل العملاء موقوفة",
  not_allowed: "غير مسموح (وضع التجربة)",
};

function message(c: Coupon, campaign: Campaign, expires: string): { text: string; params: string[] } {
  const params = waParams("coupon", {
    name: c.client_name ?? "",
    destination: "",
    serial: "",
    rate_link: "",
    date: arabicDate(expires),
    discount: discountLabel(campaign.kind, campaign.value),
    link: `${site()}/coupon/${c.token}`,
  });
  return { text: waPreview(WA_TEMPLATES.coupon, params), params };
}

/** The message as the client will read it — shown before «أرسل». */
export async function previewMessage(campaignId: string): Promise<string | null> {
  if (!(await currentCan("discounts.manage"))) return null;
  const data = await getCampaign(campaignId);
  const c = data?.coupons[0];
  if (!data || !c) return null;
  return message(c, data.campaign, new Date(Date.now() + data.campaign.valid_days * 86_400_000).toISOString()).text;
}

/**
 * «أرسل»: the next `count` coupons not sent yet, one by one through the client's own Teletel thread
 * (messageClient — its gate and its approved template). A manager presses it; the screen calls it again
 * until the campaign is done or they stop. Never sends one coupon twice.
 */
export async function sendBatch(campaignId: string, count: number): Promise<{ ok: true; sent: number; failed: number; left: number; last: string | null } | Fail> {
  if (!(await currentCan("discounts.manage"))) return { ok: false, error: "لا صلاحية" };
  const data = await getCampaign(campaignId);
  if (!data) return { ok: false, error: "حملة غير معروفة" };
  const status = await whatsappTemplateStatus();
  if (status?.get(WA_TEMPLATES.coupon.name) !== "APPROVED") return { ok: false, error: "قالب الكوبون لم يُعتمد من واتساب بعد. الإرسال يُفتح بعد اعتماده." };
  const me = await getCurrentEmployeeId();
  // never-tried first: a coupon that failed once (no number, a partner's client) waits behind the rest
  const pending = data.coupons.filter((c) => !c.sent_at && !c.excluded).sort((a, b) => Number(!!a.send_result) - Number(!!b.send_result));
  const queue = pending.slice(0, Math.max(1, Math.min(25, Math.floor(Number(count) || 1))));
  const s = db();
  if (data.campaign.status === "draft") await s.from("discount_campaigns").update({ status: "sending" }).eq("id", campaignId);
  let sent = 0;
  let failed = 0;
  let last: string | null = null;
  for (const c of queue) {
    // claim it first: two screens pressing «أرسل» together never send it twice
    const expires = new Date(Date.now() + data.campaign.valid_days * 86_400_000).toISOString();
    const { data: claimed } = await s
      .from("discount_coupons")
      .update({ sent_at: new Date().toISOString(), sent_by: me, expires_at: expires })
      .eq("id", c.id)
      .is("sent_at", null)
      .select("id");
    if (!claimed?.length) continue;
    const m = message(c, data.campaign, expires);
    const result = await messageClient(
      { employee_id: me, partner_company_id: null, customer: { arabic_name: c.client_name, mobile: c.phone } },
      m.text,
      { template: { key: "coupon", params: m.params, image: `${site()}/coupon/${c.token}/card` }, labels: ["كوبون"] },
    );
    const ok = result === "sent" || result === "template";
    last = RESULT_LABEL[result] ?? result;
    if (ok) sent++;
    else failed++;
    // a coupon that did not go stays unsent for the next try — only its reason is kept
    await s
      .from("discount_coupons")
      .update(ok ? { send_result: last } : { sent_at: null, sent_by: null, send_result: last })
      .eq("id", c.id);
    if (!ok && (result === "off" || result === "unreachable" || result === "not_allowed")) break;
  }
  const left = Math.max(0, pending.length - sent);
  if (left === 0) await s.from("discount_campaigns").update({ status: "done" }).eq("id", campaignId);
  await logAudit({ action: "discounts.sent", entity: "discount_campaigns", entity_id: campaignId, meta: { sent, failed } });
  revalidatePath(`/discounts/${campaignId}`);
  return { ok: true, sent, failed, left, last };
}

export type ScanResult = {
  id: string;
  code: string;
  name: string | null;
  phone: string;
  discount: string;
  scope: string;
  campaign: string;
  expires: string;
  state: CouponState;
  redeemed_at: string | null;
  redeemed_by: string | null;
  redeemed_ref: string | null;
};

async function toResult(found: { coupon: Coupon; campaign: Campaign }): Promise<ScanResult> {
  const { coupon: c, campaign } = found;
  let by: string | null = null;
  if (c.redeemed_by) {
    const { data } = await db().from("employees").select("arabic_name").eq("id", c.redeemed_by).maybeSingle();
    by = (data as { arabic_name: string | null } | null)?.arabic_name ?? null;
  }
  return {
    id: c.id,
    code: c.code,
    name: c.client_name,
    phone: c.phone,
    discount: discountLabel(campaign.kind, campaign.value),
    scope: campaign.applies_to === "package" ? "على طلب باقة سياحية فقط" : "على أي طلب",
    campaign: campaign.title,
    expires: arabicDate(c.expires_at),
    state: couponState(c),
    redeemed_at: c.redeemed_at ? arabicDate(c.redeemed_at) : null,
    redeemed_by: by,
    redeemed_ref: c.redeemed_ref,
  };
}

/** The scanner: a QR read by the camera, or a code typed — the coupon and whether it can still be used. */
export async function lookupCoupon(raw: string): Promise<{ ok: true; coupon: ScanResult } | Fail> {
  if (!(await currentCan("discounts.redeem"))) return { ok: false, error: "لا صلاحية لقراءة الكوبونات" };
  const key = readScan(String(raw ?? ""));
  if (!key) return { ok: false, error: "هذا ليس كوبون ترافليون" };
  const found = await couponWith(key);
  if (!found || found.coupon.excluded) return { ok: false, error: "الكوبون غير موجود" };
  return { ok: true, coupon: await toResult(found) };
}

/**
 * «اعتمد الخصم»: the coupon is used — once. The update only matches an unused, unexpired coupon, so a
 * second scan (or two employees at once) finds it already used, with who and when.
 */
export async function redeemCoupon(id: string, ref: string): Promise<{ ok: true; coupon: ScanResult } | Fail> {
  if (!(await currentCan("discounts.redeem"))) return { ok: false, error: "لا صلاحية" };
  if (!/^[0-9a-f-]{36}$/.test(id)) return { ok: false, error: "كوبون غير معروف" };
  const reference = String(ref ?? "").trim().slice(0, 80);
  if (!reference) return { ok: false, error: "اكتب رقم الملف أو الطلب الذي استُخدم عليه الخصم" };
  const now = new Date().toISOString();
  const { data } = await db()
    .from("discount_coupons")
    .update({ redeemed_at: now, redeemed_by: await getCurrentEmployeeId(), redeemed_ref: reference })
    .eq("id", id)
    .is("redeemed_at", null)
    .eq("excluded", false)
    .gt("expires_at", now)
    .select("id");
  const found = await couponWith({ id });
  if (!found) return { ok: false, error: "كوبون غير معروف" };
  if (!data?.length) return { ok: false, error: found.coupon.redeemed_at ? "الكوبون مستخدم مسبقاً" : "انتهت صلاحية الكوبون" };
  await logAudit({ action: "discounts.redeemed", entity: "discount_coupons", entity_id: id, meta: { ref: reference } });
  revalidatePath(`/discounts/${found.campaign.id}`);
  return { ok: true, coupon: await toResult(found) };
}
