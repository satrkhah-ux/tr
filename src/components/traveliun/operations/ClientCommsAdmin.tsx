"use client";

import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { saveDestinationGuide, saveMessageTemplate, type DestinationGuide, type MessageTemplate } from "@/lib/data/destination-guides";
import { CLIENT_MESSAGE_LABEL, WA_TEMPLATES, type WaTemplateKey } from "@/lib/operations/client-messages";
import { TraveliunShell } from "../TraveliunShell";
import { useSafeTransition } from "../useSafeTransition";
import { MuradPolicies } from "./MuradPolicies";

/**
 * What the traveller is told (operations order 11): the WhatsApp message at each
 * stage — nothing goes out until a manager switches it on — and the emergency
 * guide per destination shown on the trip link.
 */

const field =
  "h-9 w-full rounded-[8px] border border-[#dbe6e1] bg-white px-2.5 text-[12.5px] font-semibold text-[#185045] dark:border-[#294039] dark:bg-[#0f1f1b] dark:text-[#d6e5df]";
const card = "rounded-[14px] border border-[#e2ebe7] bg-white p-4 dark:border-[#22443b] dark:bg-[#12241f]";

/**
 * Whether the message can still reach a client after WhatsApp's 24 hours: its
 * Meta template, by the status Teletel synced. Read-only — templates are made
 * and approved in Meta's WhatsApp Manager.
 */
function WaStatus({ k, status }: { k: WaTemplateKey; status: Record<string, string> | null }) {
  const name = WA_TEMPLATES[k].name;
  const s = status?.[name];
  const [tone, text] =
    status === null
      ? ["text-[#93aaa3]", "تعذّر قراءة حالة القالب من تيليتيل"]
      : s === "APPROVED"
        ? ["text-[#0f7a52]", "معتمد ✓ — يصل للعميل حتى بعد 24 ساعة"]
        : s === "PENDING"
          ? ["text-[#a86a10]", "بانتظار اعتماد ميتا — بعد 24 ساعة تُترك ملاحظة للموظف"]
          : s === "REJECTED"
            ? ["text-[#c22850]", "رفضته ميتا — بعد 24 ساعة تُترك ملاحظة للموظف"]
            : ["text-[#a86a10]", "لم يُرفع بعد — بعد 24 ساعة تُترك ملاحظة للموظف"];
  return (
    <p className="mt-2 text-[11.5px] font-semibold text-[#78948f]">
      قالب واتساب <bdi dir="ltr" className="font-mono">{name}</bdi>: <span className={`font-bold ${tone}`}>{text}</span>
    </p>
  );
}

export function ClientCommsAdmin({
  templates,
  guides,
  waStatus,
  muradPolicies,
}: {
  templates: MessageTemplate[];
  guides: DestinationGuide[];
  /** «مُراد»: the policy text he answers from (murad_policies). */
  muradPolicies: string;
  /** Meta template status by name (Teletel's sync); null when Teletel could not be read. */
  waStatus: Record<string, string> | null;
}) {
  return (
    <TraveliunShell title="nav.clientComms">
      <div className="max-w-4xl space-y-4">
        <section className={card}>
          <h1 className="text-lg font-extrabold text-[#003c3a] dark:text-[#eaf3ef]">رسائل العميل في محطات رحلته</h1>
          <p className="mt-1 text-[12.5px] font-semibold text-[#78948f]">
            تُرسل بواتساب إلى محادثة العميل، مرة واحدة لكل محطة، ولا تُرسل لعملاء الشركات الشريكة. المتغيّرات: {"{name} {destination} {serial} {date} {link} {rate_link}"}.
            يُوضع كل رابط في سطر وحده تلقائياً، و*النجمتان* تجعلان النص عريضاً في واتساب. بعد 24 ساعة من آخر رسالة للعميل يُرسل قالب ميتا المعتمد بدل النص.
          </p>
          <div className="mt-3 rounded-[10px] bg-[#f6faf8] px-3 py-2 dark:bg-[#0f1f1b]">
            <p className="text-[12.5px] font-bold text-[#185045] dark:text-[#d6e5df]">عند إصدار العرض: البرنامج مع نسخة PDF</p>
            <WaStatus k="programme" status={waStatus} />
          </div>
        </section>
        {templates.map((t) => (
          <TemplateRow key={t.key} template={t} waStatus={waStatus} />
        ))}
        <GuidesEditor guides={guides} />
        <MuradPolicies initial={muradPolicies} />
      </div>
    </TraveliunShell>
  );
}

function TemplateRow({ template, waStatus }: { template: MessageTemplate; waStatus: Record<string, string> | null }) {
  const [body, setBody] = useState(template.body);
  const [enabled, setEnabled] = useState(template.enabled);
  const [pending, run] = useSafeTransition();
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const save = (next: { body: string; enabled: boolean }) =>
    run(async () => {
      setNote(null);
      const res = await saveMessageTemplate({ key: template.key, ...next });
      setNote(res.ok ? { ok: true, text: "حُفظ." } : { ok: false, text: res.message });
    });
  return (
    <section className={card}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[14px] font-extrabold text-[#003c3a] dark:text-[#eaf3ef]">{CLIENT_MESSAGE_LABEL[template.key]}</h2>
        <label className="flex items-center gap-2 text-[12.5px] font-bold text-[#185045]">
          <input
            id={`tpl-on-${template.key}`}
            type="checkbox"
            checked={enabled}
            onChange={(e) => {
              setEnabled(e.target.checked);
              save({ body, enabled: e.target.checked });
            }}
            className="size-4 accent-[#185045]"
          />
          {enabled ? "مفعّلة" : "متوقفة"}
        </label>
      </div>
      <textarea
        id={`tpl-body-${template.key}`}
        rows={6}
        dir="rtl"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        className="w-full rounded-[10px] border border-[#dbe6e1] bg-white p-3 text-[13px] text-[#185045] dark:border-[#294039] dark:bg-[#0f1f1b] dark:text-[#d6e5df]"
      />
      <div className="mt-2 flex items-center gap-2">
        <button type="button" disabled={pending} onClick={() => save({ body, enabled })} className="inline-flex h-9 items-center gap-1.5 rounded-[9px] bg-[#185045] px-3 text-[12px] font-bold text-white disabled:opacity-60">
          {pending ? <Loader2 className="size-4 animate-spin" /> : null}
          حفظ النص
        </button>
        {note ? <span className={`text-[12px] font-bold ${note.ok ? "text-[#0f7a52]" : "text-[#c22850]"}`}>{note.text}</span> : null}
      </div>
      <WaStatus k={template.key} status={waStatus} />
    </section>
  );
}

const GUIDE_FIELDS: { key: keyof Omit<DestinationGuide, "country_id" | "country">; label: string; ltr?: boolean }[] = [
  { key: "local_agent_name", label: "الوكيل المحلي" },
  { key: "local_agent_phone", label: "جوال الوكيل", ltr: true },
  { key: "embassy_phone", label: "السفارة", ltr: true },
  { key: "ambulance", label: "الإسعاف", ltr: true },
  { key: "police", label: "الشرطة", ltr: true },
  { key: "hospital", label: "مستشفى" },
  { key: "notes", label: "ملاحظات" },
];

function GuidesEditor({ guides }: { guides: DestinationGuide[] }) {
  const [countryId, setCountryId] = useState(guides.find((g) => g.local_agent_phone || g.ambulance)?.country_id ?? guides[0]?.country_id ?? "");
  const current = useMemo(() => guides.find((g) => g.country_id === countryId), [guides, countryId]);
  return (
    <section className={card}>
      <h2 className="text-[14px] font-extrabold text-[#003c3a] dark:text-[#eaf3ef]">دليل الطوارئ لكل وجهة</h2>
      <p className="mb-3 mt-0.5 text-[12px] font-semibold text-[#78948f]">يظهر للمسافر في رابط رحلته بحسب وجهة العرض.</p>
      <select id="guide-country" value={countryId} onChange={(e) => setCountryId(e.target.value)} className={`${field} mb-3 max-w-xs`}>
        {guides.map((g) => (
          <option key={g.country_id} value={g.country_id}>
            {g.country}
            {g.local_agent_phone || g.ambulance ? " ✓" : ""}
          </option>
        ))}
      </select>
      {current ? <GuideForm key={current.country_id} guide={current} /> : null}
    </section>
  );
}

function GuideForm({ guide }: { guide: DestinationGuide }) {
  const [values, setValues] = useState(guide);
  const [pending, run] = useSafeTransition();
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {GUIDE_FIELDS.map((f) => (
        <label key={f.key} className="grid gap-1 text-[11.5px] font-bold text-[#185045]">
          {f.label}
          <input id={`guide-${f.key}`} dir={f.ltr ? "ltr" : undefined} value={values[f.key] ?? ""} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })} className={field} />
        </label>
      ))}
      <div className="flex items-center gap-2 sm:col-span-2">
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            run(async () => {
              setNote(null);
              const { country: _country, ...rest } = values;
              void _country;
              const res = await saveDestinationGuide(rest);
              setNote(res.ok ? { ok: true, text: "حُفظ الدليل." } : { ok: false, text: res.message });
            })
          }
          className="inline-flex h-9 items-center gap-1.5 rounded-[9px] bg-[#185045] px-3 text-[12px] font-bold text-white disabled:opacity-60"
        >
          {pending ? <Loader2 className="size-4 animate-spin" /> : null}
          حفظ
        </button>
        {note ? <span className={`text-[12px] font-bold ${note.ok ? "text-[#0f7a52]" : "text-[#c22850]"}`}>{note.text}</span> : null}
      </div>
    </div>
  );
}
