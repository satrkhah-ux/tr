"use client";

import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { saveDestinationGuide, saveMessageTemplate, type DestinationGuide, type MessageTemplate } from "@/lib/data/destination-guides";
import { CLIENT_MESSAGE_LABEL } from "@/lib/operations/client-messages";
import { TraveliunShell } from "../TraveliunShell";
import { useSafeTransition } from "../useSafeTransition";

/**
 * What the traveller is told (operations order 11): the WhatsApp message at each
 * stage — nothing goes out until a manager switches it on — and the emergency
 * guide per destination shown on the trip link.
 */

const field =
  "h-9 w-full rounded-[8px] border border-[#dbe6e1] bg-white px-2.5 text-[12.5px] font-semibold text-[#185045] dark:border-[#294039] dark:bg-[#0f1f1b] dark:text-[#d6e5df]";
const card = "rounded-[14px] border border-[#e2ebe7] bg-white p-4 dark:border-[#22443b] dark:bg-[#12241f]";

export function ClientCommsAdmin({ templates, guides }: { templates: MessageTemplate[]; guides: DestinationGuide[] }) {
  return (
    <TraveliunShell title="nav.clientComms">
      <div className="max-w-4xl space-y-4">
        <section className={card}>
          <h1 className="text-lg font-extrabold text-[#003c3a] dark:text-[#eaf3ef]">رسائل العميل في محطات رحلته</h1>
          <p className="mt-1 text-[12.5px] font-semibold text-[#78948f]">
            تُرسل بواتساب إلى محادثة العميل القائمة، مرة واحدة لكل محطة، ولا تُرسل لعملاء الشركات الشريكة. المتغيّرات: {"{name} {destination} {serial} {link} {rate_link}"}.
          </p>
        </section>
        {templates.map((t) => (
          <TemplateRow key={t.key} template={t} />
        ))}
        <GuidesEditor guides={guides} />
      </div>
    </TraveliunShell>
  );
}

function TemplateRow({ template }: { template: MessageTemplate }) {
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
        rows={3}
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
