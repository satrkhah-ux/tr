"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, ExternalLink, Loader2, Plus, RefreshCw, XCircle } from "lucide-react";
import { checkIntegrationsNow, saveIntegration, type Integration } from "@/lib/data/integrations";
import { INTEGRATION_KINDS, KIND_AR, type IntegrationKind } from "@/lib/developer/integration-kinds";
import { TraveliunShell } from "../TraveliunShell";

/**
 * «الربط الخارجي» (the owner, 2026-10-19): one row for every outside thing the
 * system leans on — and from now on, every new token, API, subscription or
 * server is written here in the same change (AGENTS.md).
 */
type Draft = Partial<Integration> & { name: string; kind: IntegrationKind };
const EMPTY: Draft = { name: "", kind: "api" };
const FIELD = "h-9 w-full rounded-[8px] border border-[#dbe6e1] bg-white px-2.5 text-[12.5px] text-[#0f3d38] outline-none focus-visible:ring-2 focus-visible:ring-tv-action-focus focus:border-[#2aa87a]";
const ERRORS: Record<string, string> = {
  secret_value: "لا تُكتب قيمة السر هنا — اسم المتغير أو مسار الملف فقط",
  duplicate: "يوجد سطر بهذا الاسم",
  name: "الاسم مطلوب",
  date: "تاريخ غير صحيح",
};

const daysLeft = (iso: string | null) => (iso ? Math.floor((Date.parse(iso) - Date.now()) / 86_400_000) : null);
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("ar-SA-u-nu-latn", { timeZone: "Asia/Riyadh", dateStyle: "short", timeStyle: "short" }) : "—");

function problemOf(r: Integration): string | null {
  if (r.unused) return "غير مستعمل — للحذف بقرار المالك";
  if (r.fail_streak >= 2) return `لا يعمل منذ ${when(r.last_error_at)}: ${r.last_error ?? ""}`;
  const d = daysLeft(r.renews_on);
  if (d != null && d <= 14) return `ينتهي خلال ${d} يوماً (${r.renews_on})`;
  if (r.alerted?.startsWith("expiry")) return `ينتهي قريباً — ${r.last_error ?? ""}`;
  return null;
}

function Editor({ value, onDone }: { value: Draft; onDone: () => void }) {
  const router = useRouter();
  const [d, setD] = useState<Draft>(value);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof Draft, v: string | boolean) => setD((x) => ({ ...x, [k]: v }));
  const text = (k: keyof Draft, label: string, type = "text") => (
    <label className="grid gap-1 text-[11.5px] font-bold text-[#185045]">
      {label}
      <input type={type} value={(d[k] as string | null) ?? ""} onChange={(e) => set(k, e.target.value)} className={FIELD} />
    </label>
  );
  return (
    <div className="grid gap-2 rounded-[12px] border border-[#cfe0d9] bg-[#f8fbfa] p-3 sm:grid-cols-2 lg:grid-cols-3">
      {text("name", "الاسم")}
      <label className="grid gap-1 text-[11.5px] font-bold text-[#185045]">
        النوع
        <select value={d.kind} onChange={(e) => set("kind", e.target.value)} className={FIELD}>
          {INTEGRATION_KINDS.map((k) => (
            <option key={k} value={k}>
              {KIND_AR[k]}
            </option>
          ))}
        </select>
      </label>
      {text("used_by", "يستعمله")}
      {text("secret_ref", "مكان السر (اسم المتغير أو مسار الملف — لا القيمة)")}
      {text("account", "الحساب / البريد")}
      {text("plan", "الخطة")}
      {text("cost", "التكلفة")}
      {text("renews_on", "تاريخ التجديد / الانتهاء", "date")}
      {text("notes", "ملاحظات")}
      <label className="flex items-center gap-2 text-[12px] font-bold text-[#185045]">
        <input type="checkbox" checked={Boolean(d.unused)} onChange={(e) => set("unused", e.target.checked)} />
        غير مستعمل — للحذف
      </label>
      <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-3">
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            const r = await saveIntegration(d);
            setBusy(false);
            if (!r.ok) return setError(ERRORS[r.error] ?? "لم يُحفظ");
            router.refresh();
            onDone();
          }}
          className="inline-flex h-9 items-center gap-1.5 rounded-[9px] bg-[#185045] px-4 text-[12.5px] font-extrabold text-white disabled:opacity-60"
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
          حفظ
        </button>
        <button type="button" onClick={onDone} className="h-9 rounded-[9px] border border-[#cfe0d9] px-3 text-[12.5px] font-bold text-[#185045] max-sm:min-h-10">
          إلغاء
        </button>
        {error ? <span className="text-[12px] font-bold text-[#c22850]">{error}</span> : null}
      </div>
    </div>
  );
}

export function IntegrationsAdmin({ rows }: { rows: Integration[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const problems = rows.map((r) => ({ r, p: problemOf(r) })).filter((x) => x.p);

  return (
    <TraveliunShell title="nav.integrations">
      <div className="space-y-4">
        <section className="rounded-[14px] border border-[#cfe0d9] bg-white p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-[15px] font-extrabold text-[#003c3a]">الربط الخارجي</h2>
              <p className="text-[12px] font-semibold text-tv-text-faint">
                كل ما يتصل به النظام من خارجه: الخوادم وقاعدة البيانات والواجهات والبوتات والشيتات والسكربتات والنطاقات والاشتراكات والمهام المجدولة. يُفحص آلياً كل 30 دقيقة، ويصل تنبيه لمرة واحدة عند عطل متكرر أو اقتراب انتهاء.
              </p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={checking}
                onClick={async () => {
                  setChecking(true);
                  const r = await checkIntegrationsNow();
                  setChecking(false);
                  setNote(r.ok ? `فُحص ${r.checked}، تنبيهات جديدة: ${r.alerts}` : "تعذّر الفحص");
                  router.refresh();
                }}
                className="inline-flex h-9 items-center gap-1.5 rounded-[9px] border border-[#cfe0d9] px-3 text-[12.5px] font-bold text-[#185045] disabled:opacity-60"
              >
                {checking ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                افحص الآن
              </button>
              <button type="button" onClick={() => setEditing("new")} className="tv-btn-primary inline-flex h-9 items-center gap-1.5 rounded-[9px] px-3 text-[12.5px] font-extrabold max-sm:min-h-10">
                <Plus className="size-4" />
                إضافة
              </button>
            </div>
          </div>
          {note ? <p className="mt-2 text-[12px] font-bold text-[#0f7a52]">{note}</p> : null}
          {problems.length ? (
            <div role="alert" className="mt-3 rounded-[10px] border border-[#f4c9d4] bg-[#fdeef2] p-3 text-[12.5px] font-bold text-[#a31f43]">
              <p className="mb-1 inline-flex items-center gap-1.5">
                <AlertTriangle className="size-4" /> يحتاج انتباهاً ({problems.length})
              </p>
              <ul className="list-disc ps-5">
                {problems.map(({ r, p }) => (
                  <li key={r.id}>
                    {r.name}: {p}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {editing === "new" ? (
            <div className="mt-3">
              <Editor value={EMPTY} onDone={() => setEditing(null)} />
            </div>
          ) : null}
        </section>

        {INTEGRATION_KINDS.filter((k) => rows.some((r) => r.kind === k)).map((kind) => (
          <section key={kind} className="rounded-[14px] border border-[#cfe0d9] bg-white p-3">
            <h3 className="mb-2 text-[13px] font-extrabold text-[#185045]">{KIND_AR[kind]}</h3>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1040px] text-start text-[12px]">
                <thead className="text-[10.5px] font-extrabold text-tv-text-faint">
                  <tr className="[&>th]:px-2 [&>th]:py-1.5 [&>th]:text-start">
                    <th>الاسم</th><th>الرابط</th><th>يستعمله</th><th>مكان السر</th><th>الحساب</th><th>الخطة / التكلفة</th><th>التجديد</th><th>الحالة</th><th />
                  </tr>
                </thead>
                <tbody>
                  {rows
                    .filter((r) => r.kind === kind)
                    .map((r) =>
                      editing === r.id ? (
                        <tr key={r.id}>
                          <td colSpan={9} className="py-2">
                            <Editor value={r} onDone={() => setEditing(null)} />
                          </td>
                        </tr>
                      ) : (
                        <tr key={r.id} className={`border-t border-[#eef3f1] align-top text-[#185045] [&>td]:px-2 [&>td]:py-1.5 ${r.unused ? "opacity-60" : ""}`}>
                          <td className="font-extrabold">
                            {r.name}
                            {r.notes ? <div className="mt-0.5 text-[11px] font-semibold text-tv-text-faint">{r.notes}</div> : null}
                          </td>
                          <td className="whitespace-nowrap">
                            {r.link ? (
                              <a href={r.link.url} target="_blank" rel="noopener noreferrer" dir="auto" className="inline-flex items-center gap-1 font-bold text-[#1d5f8a] hover:underline">
                                <ExternalLink className="size-3.5" />
                                {r.link.label}
                              </a>
                            ) : (
                              <span className="text-tv-text-faint">—</span>
                            )}
                          </td>
                          <td className="max-w-[16rem]">{r.used_by ?? "—"}</td>
                          <td className="max-w-[14rem] break-words font-mono text-[11px]" dir="ltr">{r.secret_ref ?? "—"}</td>
                          <td>{r.account ?? "—"}</td>
                          <td>{[r.plan, r.cost].filter(Boolean).join(" · ") || "—"}</td>
                          <td className="tv-tnum whitespace-nowrap">{r.renews_on ?? "—"}</td>
                          <td className="whitespace-nowrap">
                            {r.unused ? (
                              <span className="font-bold text-[#a86a10]">غير مستعمل</span>
                            ) : !r.check_key ? (
                              <span className="text-tv-text-faint">بلا فحص آلي</span>
                            ) : r.fail_streak > 0 ? (
                              <span className="inline-flex items-center gap-1 font-bold text-[#c22850]" title={r.last_error ?? ""}>
                                <XCircle className="size-4" /> {when(r.last_error_at)}
                              </span>
                            ) : r.last_ok_at ? (
                              <span className="inline-flex items-center gap-1 font-bold text-[#0f7a52]">
                                <CheckCircle2 className="size-4" /> {when(r.last_ok_at)}
                              </span>
                            ) : (
                              <span className="text-tv-text-faint">لم يُفحص بعد</span>
                            )}
                          </td>
                          <td>
                            <button type="button" onClick={() => setEditing(r.id)} className="text-[12px] font-bold text-[#185045] hover:underline">
                              تعديل
                            </button>
                          </td>
                        </tr>
                      ),
                    )}
                </tbody>
              </table>
            </div>
          </section>
        ))}
      </div>
    </TraveliunShell>
  );
}
