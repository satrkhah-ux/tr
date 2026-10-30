"use client";

import { useEffect, useState } from "react";
import { exclusionStages } from "@/lib/data/discounts-actions";
import type { Exclusions } from "@/lib/data/discounts";

/**
 * «استثنِ من الحملة» (the owner, 2026-10-31): who bought from us, a follow-up closed «غير مهتم» / «حجز مؤكد»,
 * and Teletel's classifications — the «won» ones ticked when they load.
 */
export function ExclusionPicker({ value, onChange }: { value: Exclusions; onChange: (x: Exclusions) => void }) {
  const [stages, setStages] = useState<{ id: number; name: string; won: boolean }[] | null>(null);

  useEffect(() => {
    let live = true;
    void exclusionStages().then((list) => {
      if (!live) return;
      setStages(list);
      onChange({ ...value, stages: list.filter((s) => s.won).map((s) => s.id) });
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once: tick the «won» classifications when they arrive
  }, []);

  const box = (checked: boolean, label: string, toggle: () => void, key: string) => (
    <label key={key} className="flex min-h-9 items-center gap-2 rounded-lg border border-tv-border-default bg-tv-surface-raised px-3 text-[13px] font-bold text-tv-text-strong">
      <input type="checkbox" checked={checked} onChange={toggle} className="size-4 accent-[#135549]" />
      {label}
    </label>
  );

  return (
    <fieldset className="text-[12.5px] font-bold text-tv-text-muted">
      <legend>استثنِ من الحملة</legend>
      <div className="mt-1 flex flex-wrap gap-2">
        {box(value.booked, "من حجز معنا (له ملف)", () => onChange({ ...value, booked: !value.booked }), "booked")}
        {box(value.followups, "مغلق في المتابعة: غير مهتم أو حجز مؤكد", () => onChange({ ...value, followups: !value.followups }), "followups")}
        {stages === null ? (
          <span className="self-center text-[12px] text-tv-text-faint">يقرأ تصنيفات تيلي تيل…</span>
        ) : stages.length === 0 ? (
          <span className="self-center text-[12px] text-tv-text-faint">تعذّر قراءة تصنيفات تيلي تيل الآن</span>
        ) : (
          stages.map((s) =>
            box(
              value.stages.includes(s.id),
              `تصنيف: ${s.name}`,
              () => onChange({ ...value, stages: value.stages.includes(s.id) ? value.stages.filter((x) => x !== s.id) : [...value.stages, s.id] }),
              String(s.id),
            ),
          )
        )}
      </div>
    </fieldset>
  );
}
