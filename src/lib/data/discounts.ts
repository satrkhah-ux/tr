import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { cleanName, lastNine, type Audience, type DiscountKind } from "@/lib/discounts/rules";

/**
 * «قسم الخصومات» (the owner, 2026-10-31) — reads. The tables are closed to sessions; every caller
 * checks the permission first (discounts.manage / discounts.redeem), the coupon page only by its token.
 */

export const db = () => createSupabaseServiceClient() as unknown as SupabaseClient;
export const site = () => (process.env["NEXT_PUBLIC_SITE_URL"] ?? "https://pkg.traveliun.com").replace(/\/$/, "");

export type Campaign = {
  id: string;
  title: string;
  kind: DiscountKind;
  value: number;
  applies_to: string;
  valid_days: number;
  audience: Audience;
  audience_days: number | null;
  status: string;
  created_at: string;
};
export type CampaignRow = Campaign & { total: number; sent: number; opened: number; redeemed: number };

export type Coupon = {
  id: string;
  campaign_id: string;
  code: string;
  token: string;
  client_name: string | null;
  phone: string;
  expires_at: string;
  excluded: boolean;
  sent_at: string | null;
  send_result: string | null;
  opened_at: string | null;
  redeemed_at: string | null;
  redeemed_by: string | null;
  redeemed_ref: string | null;
};

const CAMPAIGN = "id, title, kind, value, applies_to, valid_days, audience, audience_days, status, created_at";
const COUPON = "id, campaign_id, code, token, client_name, phone, expires_at, excluded, sent_at, send_result, opened_at, redeemed_at, redeemed_by, redeemed_ref";

/** Every row of a query, a thousand at a time (PostgREST's page). */
async function all<T>(page: (from: number, to: number) => PromiseLike<{ data: unknown }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await page(from, from + 999);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < 1000) return out;
  }
}

export type Recipient = { phone: string; name: string | null };

/**
 * Who a campaign goes to: every client the system knows — the conversations («العملاء») and the files'
 * customers — once per mobile (its last nine digits), the file's name before the WhatsApp name.
 * «booked»: a customer of an operations file; «older»: first contact more than `days` ago.
 */
export async function recipients(audience: Audience, days: number | null): Promise<Recipient[]> {
  const s = db();
  const [leads, customers, ops] = await Promise.all([
    all<{ phone: string | null; name: string | null; created_at: string }>((a, b) => s.from("client_leads").select("phone, name, created_at").order("id").range(a, b)),
    all<{ mobile: string | null; arabic_name: string | null; created_at: string }>((a, b) => s.from("customers").select("mobile, arabic_name, created_at").order("id").range(a, b)),
    all<{ offers: { customers: { mobile: string | null } | { mobile: string | null }[] | null } | null }>((a, b) =>
      s.from("operations").select("offers(customers(mobile))").order("id").range(a, b),
    ),
  ]);
  const people = new Map<string, { phone: string; name: string | null; first: number; fileName: boolean }>();
  const add = (phone: string | null, name: string | null, at: string, fileName: boolean) => {
    const key = lastNine(phone);
    if (key.length < 9 || !phone) return;
    const t = new Date(at).getTime();
    const was = people.get(key);
    const clean = cleanName(name);
    if (!was) return void people.set(key, { phone: phone.trim(), name: clean, first: t, fileName });
    was.first = Math.min(was.first, t);
    if (clean && (fileName || !was.name) && !(was.fileName && !fileName)) Object.assign(was, { name: clean, fileName });
  };
  for (const c of customers) add(c.mobile, c.arabic_name, c.created_at, true);
  for (const l of leads) add(l.phone, l.name, l.created_at, false);
  const booked = new Set<string>();
  for (const o of ops) {
    const c = o.offers?.customers;
    for (const one of Array.isArray(c) ? c : c ? [c] : []) booked.add(lastNine(one.mobile));
  }
  const cutoff = Date.now() - (days ?? 0) * 86_400_000;
  return [...people.entries()]
    .filter(([key, p]) =>
      audience === "booked" ? booked.has(key) : audience === "never_booked" ? !booked.has(key) : audience === "older" ? p.first < cutoff : true,
    )
    .map(([, p]) => ({ phone: p.phone, name: p.name }));
}

export async function listCampaigns(): Promise<CampaignRow[]> {
  const s = db();
  const { data } = await s.from("discount_campaigns").select(CAMPAIGN).order("created_at", { ascending: false });
  const campaigns = (data ?? []) as Campaign[];
  if (!campaigns.length) return [];
  const coupons = await all<{ campaign_id: string; excluded: boolean; sent_at: string | null; opened_at: string | null; redeemed_at: string | null }>((a, b) =>
    s.from("discount_coupons").select("campaign_id, excluded, sent_at, opened_at, redeemed_at").order("id").range(a, b),
  );
  return campaigns.map((c) => {
    const mine = coupons.filter((x) => x.campaign_id === c.id && !x.excluded);
    return {
      ...c,
      value: Number(c.value),
      total: mine.length,
      sent: mine.filter((x) => x.sent_at).length,
      opened: mine.filter((x) => x.opened_at).length,
      redeemed: mine.filter((x) => x.redeemed_at).length,
    };
  });
}

export async function getCampaign(id: string): Promise<{ campaign: Campaign; coupons: Coupon[]; names: Record<string, string> } | null> {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  const s = db();
  const { data } = await s.from("discount_campaigns").select(CAMPAIGN).eq("id", id).maybeSingle();
  if (!data) return null;
  const coupons = await all<Coupon>((a, b) => s.from("discount_coupons").select(COUPON).eq("campaign_id", id).order("created_at").order("id").range(a, b));
  const ids = [...new Set(coupons.map((c) => c.redeemed_by).filter((x): x is string => !!x))];
  const { data: emps } = ids.length ? await s.from("employees").select("id, arabic_name").in("id", ids) : { data: [] };
  const names = Object.fromEntries(((emps ?? []) as { id: string; arabic_name: string | null }[]).map((e) => [e.id, e.arabic_name ?? ""]));
  return { campaign: { ...(data as Campaign), value: Number((data as Campaign).value) }, coupons, names };
}

/** The coupon page and the scanner: the coupon with its campaign. */
export async function couponWith(by: { token: string } | { code: string } | { id: string }): Promise<{ coupon: Coupon; campaign: Campaign } | null> {
  const [col, val] = "token" in by ? ["token", by.token] : "code" in by ? ["code", by.code] : ["id", by.id];
  const { data } = await db().from("discount_coupons").select(`${COUPON}, discount_campaigns(${CAMPAIGN})`).eq(col, val).maybeSingle();
  if (!data) return null;
  const row = data as unknown as Coupon & { discount_campaigns: Campaign | Campaign[] | null };
  const campaign = Array.isArray(row.discount_campaigns) ? row.discount_campaigns[0] : row.discount_campaigns;
  if (!campaign) return null;
  const coupon: Coupon = { ...row };
  delete (coupon as Partial<typeof row>).discount_campaigns;
  return { coupon, campaign: { ...campaign, value: Number(campaign.value) } };
}

export type Exclusions = { booked: boolean; followups: boolean; stages: number[] };
export const DEFAULT_EXCLUSIONS: Omit<Exclusions, "stages"> = { booked: true, followups: true };

/**
 * Who a campaign leaves out, by mobile (last nine) with the reason shown beside them (the owner, 2026-10-31:
 * «لا نريد ان نرسله لمن اشترى من عندنا»): a client with a booking file, a follow-up closed «غير مهتم» /
 * «حجز مؤكد», and the Teletel classifications picked (the «won» ones by default). A stage Teletel would not
 * give is reported, never treated as empty.
 */
export async function excludedPhones(x: Exclusions, stageNames: Map<number, string>): Promise<{ reasons: Map<string, string>; failed: string[] }> {
  const s = db();
  const reasons = new Map<string, string>();
  const mark = (phone: string | null | undefined, why: string) => {
    const k = lastNine(phone);
    if (k.length === 9 && !reasons.has(k)) reasons.set(k, why);
  };
  if (x.booked) {
    const ops = await all<{ offers: { customers: { mobile: string | null } | { mobile: string | null }[] | null } | null }>((a, b) =>
      s.from("operations").select("offers(customers(mobile))").order("id").range(a, b),
    );
    for (const o of ops) {
      const c = o.offers?.customers;
      for (const one of Array.isArray(c) ? c : c ? [c] : []) mark(one.mobile, "مستثنى: حجز معنا");
    }
  }
  if (x.followups) {
    const rows = await all<{ contact_phone: string | null; outcome: string }>((a, b) =>
      s.from("sla_followups").select("contact_phone, outcome").in("outcome", ["not_interested", "completed"]).order("id").range(a, b),
    );
    for (const r of rows) mark(r.contact_phone, r.outcome === "completed" ? "مستثنى: حجز مؤكد" : "مستثنى: غير مهتم");
  }
  const failed: string[] = [];
  const { lifecycleStagePhones } = await import("@/lib/providers/teletel");
  for (const id of x.stages) {
    const phones = await lifecycleStagePhones(id);
    if (!phones) failed.push(stageNames.get(id) ?? String(id));
    else for (const p of phones) mark(p, `مستثنى: ${stageNames.get(id) ?? "تصنيف"}`);
  }
  return { reasons, failed };
}
