"use server";

import sharp from "sharp";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { currentCan } from "@/lib/roles/current";
import { logAudit } from "@/lib/data/audit";
import { AD_HEIGHT, AD_MAX_BYTES, AD_WIDTH, normalizeConfig, SCREENS_BUCKET, SCREENS_SETTING, type ScreensConfig } from "@/lib/office-screens/config";
import { forgetScreens, insertTestEvent, insertWalkInEvent, readScreensConfig } from "@/lib/office-screens/server";
import { getDraft } from "@/lib/data/drafts";
import { walkInKind } from "@/lib/office-screens/config";

/**
 * «الإدارة ← الشاشات» (the owner, 2026-10-19), settings.manage: how many screens
 * hang and in what order, the seconds per ad, which requests alert, the
 * ticker's speed, the ads (upload, order, on/off, delete) and «جرّب الإشعار».
 * The ads live in the private bucket office-screens — the screens get them
 * through pkg (screen/ad/[file]) — each as the uploaded original and a
 * 1920×1080 copy made here, so a TV never decodes a 4K file.
 */
type Result = { ok: true } | { ok: false; error: string };
const db = () => createSupabaseServiceClient() as unknown as SupabaseClient;
const allowed = () => currentCan("settings.manage");

export async function getScreensAdmin(): Promise<ScreensConfig | null> {
  if (!(await allowed())) return null;
  return readScreensConfig();
}

async function write(cfg: ScreensConfig, what: string): Promise<Result> {
  const { error } = await db().from("app_settings").upsert({ key: SCREENS_SETTING, value: JSON.stringify(cfg), updated_at: new Date().toISOString() });
  if (error) return { ok: false, error: "تعذّر الحفظ" };
  forgetScreens();
  await logAudit({ action: "settings.updated", entity: "app_settings", entity_id: SCREENS_SETTING, meta: { what } });
  return { ok: true };
}

/** the settings and the ads' order, names and on/off — ads are added and removed only below */
export async function saveScreens(next: ScreensConfig): Promise<Result> {
  if (!(await allowed())) return { ok: false, error: "لا صلاحية" };
  const had = await readScreensConfig();
  const known = new Set(had.ads.map((a) => a.id));
  const cfg = normalizeConfig(next);
  cfg.ads = cfg.ads.filter((a) => known.has(a.id));
  return write(cfg, "settings");
}

export async function uploadScreenAd(form: FormData): Promise<Result> {
  if (!(await allowed())) return { ok: false, error: "لا صلاحية" };
  const file = form.get("file");
  const name = String(form.get("name") ?? "").trim().slice(0, 60);
  if (!(file instanceof File) || !file.size) return { ok: false, error: "اختر صورة" };
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > AD_MAX_BYTES) return { ok: false, error: "صورة jpg أو png أو webp حتى 15 م.ب" };
  if (!name) return { ok: false, error: "اكتب الوجهة (مثل: تركيا)" };
  try {
    const original = Buffer.from(await file.arrayBuffer());
    const screenCopy = await sharp(original).rotate().resize(AD_WIDTH, AD_HEIGHT, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 82, mozjpeg: true }).toBuffer();
    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const store = db().storage.from(SCREENS_BUCKET);
    if ((await db().storage.getBucket(SCREENS_BUCKET)).error) await db().storage.createBucket(SCREENS_BUCKET, { public: false });
    const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
    const a = await store.upload(`${id}/original.${ext}`, original, { contentType: file.type });
    const b = await store.upload(`${id}/1080.jpg`, screenCopy, { contentType: "image/jpeg" });
    if (a.error || b.error) return { ok: false, error: "تعذّر رفع الصورة" };
    const cfg = await readScreensConfig();
    cfg.ads.push({ id, name, active: true });
    return write(cfg, `ad added: ${name}`);
  } catch {
    return { ok: false, error: "تعذّر قراءة الصورة" };
  }
}

export async function deleteScreenAd(id: string): Promise<Result> {
  if (!(await allowed())) return { ok: false, error: "لا صلاحية" };
  const cfg = await readScreensConfig();
  const ad = cfg.ads.find((a) => a.id === id);
  if (!ad) return { ok: true };
  const store = db().storage.from(SCREENS_BUCKET);
  const { data } = await store.list(id);
  if (data?.length) await store.remove(data.map((f) => `${id}/${f.name}`));
  cfg.ads = cfg.ads.filter((a) => a.id !== id);
  return write(cfg, `ad deleted: ${ad.name}`);
}

/** «جرّب الإشعار»: every screen shows it, marked «تجربة» — never a request, never counted */
export async function sendScreensTest(destination: string): Promise<Result> {
  if (!(await allowed())) return { ok: false, error: "لا صلاحية" };
  const d = destination.trim().slice(0, 60);
  if (!d) return { ok: false, error: "اختر وجهة" };
  return (await insertTestEvent(d)) ? { ok: true } : { ok: false, error: "تعذّر الإرسال" };
}

/**
 * «عميلنا محمد طلب بكج إلى جورجيا» (the user, 2026-10-25): the agent ticked «اعرض على شاشات
 * المكتب» on a file's first step and pressed «التالي». Any agent who can open the file; the
 * name and the country are read from the saved file, once per file; the service from the
 * ticked «البرنامج يشمل» chips — one → that service, more → «بكج».
 */
export async function announceWalkIn(draftId: string, services: string[]): Promise<Result> {
  const draft = await getDraft(draftId);
  if (!draft) return { ok: false, error: "لا صلاحية" };
  const destination = (draft.data.trip.country || draft.data.trip.destination || "").trim().slice(0, 60);
  if (!destination) return { ok: false, error: "اختر الدولة" };
  return (await insertWalkInEvent(draftId, draft.data.customer.customer_name, destination, walkInKind(services))) ? { ok: true } : { ok: false, error: "ظهر على الشاشات من قبل" };
}
