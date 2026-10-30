"use client";

import { useState } from "react";
import { setMuradPolicies, type MuradTextKey } from "@/lib/data/app-settings";
import { useTraveliunUI } from "../TraveliunUIProvider";

/**
 * «سياسات الشركة لمُراد» — the only text Murad answers a policy question from
 * (cancellation, refund, payment); «أسئلة وأجوبة التأشيرات» (setting
 * murad_visa_faq) — the only text he answers a visa question beyond the list
 * from. Empty: he hands those to staff.
 */
export function MuradPolicies({ initial, setting = "murad_policies" }: { initial: string; setting?: MuradTextKey }) {
  const { t } = useTraveliunUI();
  const k = setting === "murad_visa_faq" ? "murad.visaFaq" : "murad.policies";
  const [text, setText] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<"saved" | "failed" | null>(null);

  async function save() {
    setSaving(true);
    setNote(null);
    let ok = false;
    try {
      ok = (await setMuradPolicies(text, setting)).ok;
    } catch {
      ok = false;
    }
    setSaving(false);
    setNote(ok ? "saved" : "failed");
  }

  return (
    <section className="rounded-[14px] border border-[#e2ebe7] bg-white p-4 dark:border-[#22443b] dark:bg-[#12241f]">
      <h2 className="text-[15px] font-extrabold text-[#003c3a] dark:text-[#eaf3ef]">{t(`${k}.title`)}</h2>
      <p className="mt-1 text-[12.5px] font-semibold text-tv-text-faint">{t(`${k}.hint`)}</p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={setting === "murad_visa_faq" ? 20000 : 4000}
        rows={setting === "murad_visa_faq" ? 14 : 8}
        aria-label={t(`${k}.title`)}
        className="mt-3 w-full rounded-[8px] border border-[#dbe6e1] bg-white px-2.5 py-2 text-[12.5px] font-semibold leading-6 text-[#185045] dark:border-[#294039] dark:bg-[#0f1f1b] dark:text-[#d6e5df]"
      />
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className="tv-btn-primary inline-flex h-9 items-center rounded-[9px] px-4 text-[12.5px] font-extrabold disabled:opacity-60 max-sm:min-h-10"
        >
          {t("murad.policies.save")}
        </button>
        {note ? (
          <span role="status" className={`text-[12px] font-bold ${note === "saved" ? "text-[#0f7a52]" : "text-[#c22850]"}`}>
            {t(note === "saved" ? "murad.policies.saved" : "murad.policies.failed")}
          </span>
        ) : null}
      </div>
    </section>
  );
}
