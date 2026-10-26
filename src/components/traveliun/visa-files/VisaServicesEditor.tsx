"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import { VISA_SERVICE_KEYS, VISA_SERVICE_LABEL } from "@/lib/visa-files/types";
import { addCustomService, toggleService, type ServiceDraft } from "@/lib/visa-files/ui";
import { btn, field } from "./visa-ui";

/**
 * «الخدمات المقدمة»: tick the standard services, add the employee's own line, a price on each if there is one. On a
 * saved file each service also has «تمت». The list is the parent's; nothing is saved here.
 */
export function VisaServicesEditor({ value, onChange, showDone = false, disabled = false }: { value: ServiceDraft[]; onChange: (next: ServiceDraft[]) => void; showDone?: boolean; disabled?: boolean }) {
  const [custom, setCustom] = useState("");
  const edit = (key: string, patch: Partial<ServiceDraft>) => onChange(value.map((s) => (s.key === key ? { ...s, ...patch } : s)));
  const addLine = () => {
    onChange(addCustomService(value, custom));
    setCustom("");
  };
  return (
    <div className="space-y-3">
      <ul className="grid gap-2 sm:grid-cols-2">
        {VISA_SERVICE_KEYS.map((key) => (
          <li key={key}>
            <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-[10px] border border-[#dbe6e1] bg-white px-3 text-sm font-semibold text-[#185045]">
              <input type="checkbox" className="size-5 accent-[#185045]" checked={value.some((s) => s.key === key)} disabled={disabled} onChange={() => onChange(toggleService(value, key))} />
              {VISA_SERVICE_LABEL[key]}
            </label>
          </li>
        ))}
      </ul>
      {value.length > 0 ? (
        <ul className="space-y-2" aria-label="الخدمات المختارة">
          {value.map((s) => (
            <li key={s.key} className="flex flex-wrap items-center gap-2 rounded-[10px] bg-[#f7faf8] p-2">
              <span className="min-w-0 flex-1 basis-40 text-sm font-bold text-[#185045]">{s.label}</span>
              <input
                inputMode="decimal"
                dir="ltr"
                aria-label={`سعر ${s.label}`}
                placeholder="السعر (اختياري)"
                className={`${field} w-32 shrink-0`}
                value={s.price}
                disabled={disabled}
                onChange={(e) => edit(s.key, { price: e.target.value })}
              />
              {showDone ? (
                <label className="flex min-h-11 items-center gap-2 text-sm font-semibold text-[#185045]">
                  <input type="checkbox" className="size-5 accent-[#185045]" checked={s.done} disabled={disabled} onChange={(e) => edit(s.key, { done: e.target.checked })} /> تمت
                </label>
              ) : null}
              {s.key.startsWith("custom-") ? (
                <button type="button" aria-label={`حذف ${s.label}`} className="inline-flex size-11 items-center justify-center rounded-[10px] text-[#c22850] hover:bg-[#fdecef]" disabled={disabled} onClick={() => onChange(value.filter((x) => x.key !== s.key))}>
                  <X className="size-4" />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex gap-2">
        <input
          className={field}
          aria-label="خدمة أخرى"
          placeholder="خدمة أخرى — اكتبها هنا"
          value={custom}
          disabled={disabled}
          onChange={(e) => setCustom(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addLine();
            }
          }}
        />
        <button type="button" className={btn} disabled={disabled || !custom.trim()} onClick={addLine}>
          <Plus className="size-4" /> أضف
        </button>
      </div>
    </div>
  );
}
