"use client";

import { MapPin, Building2, Percent, Mail } from "lucide-react";
import { TraveliunShell } from "../TraveliunShell";
import { usePartnerBrand } from "@/lib/partners/PartnerContext";

/**
 * «الملف الشخصي» — the identity printed on everything they issue.
 *
 * Read-only on purpose. The name, the logo and the two colours are what the
 * client sees on the document, and they were set when the company was approved
 * — letting a partner rewrite them here would mean a file could go out under a
 * name nobody approved. Changes go through us, and the screen says so.
 */
export function PartnerProfile({ email, terms }: { email: string; terms: string }) {
  const partner = usePartnerBrand();
  if (!partner) return null;

  const rows: { icon: typeof MapPin; label: string; value: string }[] = [
    { icon: Building2, label: "اسم الشركة", value: partner.name },
    ...(partner.nameLatin ? [{ icon: Building2, label: "الاسم اللاتيني", value: partner.nameLatin }] : []),
    { icon: MapPin, label: "العنوان", value: partner.address || "غير مسجَّل" },
    { icon: Mail, label: "بريد الحساب", value: email },
    { icon: Percent, label: "شروط التعامل", value: terms },
  ];

  return (
    <TraveliunShell title="nav.myProfile">
      <div className="max-w-3xl space-y-4">
        <section className="overflow-hidden rounded-[14px] border border-[#e2ebe7] bg-white dark:border-[#22443b] dark:bg-[#12241f]">
          <div className="flex items-center gap-4 bg-[var(--tv-brand)] p-5">
            {partner.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- Supabase Storage URL, no loader
              <img
                src={partner.logoUrl}
                alt={partner.name}
                className="size-16 rounded-[12px] bg-white object-contain p-1.5"
              />
            ) : (
              <span className="flex size-16 items-center justify-center rounded-[12px] bg-white/15 text-2xl font-extrabold text-white">
                {partner.name.trim().charAt(0)}
              </span>
            )}
            <div>
              <div className="text-lg font-extrabold text-white">{partner.name}</div>
              {partner.nameLatin ? (
                <div className="text-[12px] font-semibold text-white/70">{partner.nameLatin}</div>
              ) : null}
            </div>
          </div>

          <dl className="divide-y divide-[#eef4f1] dark:divide-[#22443b]">
            {rows.map((row) => {
              const Icon = row.icon;
              return (
                <div key={row.label} className="flex items-center gap-3 px-5 py-3">
                  <Icon className="size-4 shrink-0 text-[var(--tv-brand)]" />
                  <dt className="w-32 shrink-0 text-[12px] font-bold text-[#93aaa3]">{row.label}</dt>
                  <dd className="text-[13px] font-bold text-[#0f3d38] dark:text-[#d6e5df]">{row.value}</dd>
                </div>
              );
            })}
          </dl>
        </section>

        <section className="rounded-[14px] border border-[#e2ebe7] bg-white p-5 dark:border-[#22443b] dark:bg-[#12241f]">
          <h2 className="text-[14px] font-extrabold text-[var(--tv-brand)]">هويتكم على الملفات</h2>
          <p className="mt-1 text-[12.5px] font-semibold text-[#557d78]">
            هذان اللونان وهذا الشعار يظهران في لوحتكم وفي مستند العميل الذي تصدرونه.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            {[
              { label: "اللون الأساسي", value: partner.brandColor },
              { label: "اللون المساعد", value: partner.accentColor },
            ].map((swatch) => (
              <div
                key={swatch.label}
                className="flex items-center gap-2.5 rounded-[10px] border border-[#e2ebe7] px-3 py-2 dark:border-[#22443b]"
              >
                <span
                  className="size-8 rounded-[8px] border border-black/10"
                  style={{ background: swatch.value }}
                />
                <span>
                  <span className="block text-[11.5px] font-bold text-[#93aaa3]">{swatch.label}</span>
                  <span className="block text-[12px] font-extrabold text-[#0f3d38] uppercase dark:text-[#d6e5df]">
                    {swatch.value}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </section>

        <p className="rounded-[10px] border border-[#f2e2b4] bg-[#fffdf7] px-4 py-3 text-[12px] font-semibold text-[#a86a10]">
          لتعديل الاسم أو العنوان أو الشعار أو الألوان، راسلوا ترافليون — تُعتمد التغييرات من طرفنا
          حتى لا يخرج ملف باسم أو هوية غير معتمدة.
        </p>
      </div>
    </TraveliunShell>
  );
}
