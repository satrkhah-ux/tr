"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { AlertTriangle, Building2, Check, ImageUp, Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import { EmptyState } from "@/components/ui/EmptyState";
import { brandVars, isHouseColor, startingBrandColor } from "@/components/offer-doc/brand";
import {
  deletePartnerCompany,
  upsertPartnerCompany,
  uploadPartnerLogo,
  type PartnerCompany,
} from "@/lib/data/partner-companies";
import { TraveliunShell } from "./TraveliunShell";
import { useTraveliunUI } from "./TraveliunUIProvider";

/**
 * «الشركات المتعاونة».
 *
 * One record per agency, carrying both roles: who executes our bookings, and who
 * resells our files under their own name. The colours and the logo here are what
 * the offer document prints — so the row shows a real swatch of the document's
 * palette rather than a hex string nobody can picture.
 */

const card = "rounded-2xl border border-[#e2ebe7] bg-white p-5 shadow-[0_1px_2px_rgba(0,60,58,0.04)]";
const field =
  "h-11 w-full rounded-[10px] border border-[#dbe6e1] bg-white px-3 text-sm text-[#185045] outline-none focus:border-[#2aa87a]";
const label = "grid gap-1.5 text-[12px] font-bold text-[#185045]";

type Draft = {
  id?: string;
  name: string;
  name_latin: string;
  contact_name: string;
  address: string;
  phone: string;
  whatsapp: string;
  website: string;
  email: string;
  brand_color: string;
  accent_color: string;
  resells: boolean;
  show_prices: boolean;
  active: boolean;
  note: string;
};

function toDraft(c?: PartnerCompany): Draft {
  return {
    id: c?.id,
    name: c?.name ?? "",
    name_latin: c?.name_latin ?? "",
    contact_name: c?.contact_name ?? "",
    address: c?.address ?? "",
    phone: c?.phone ?? "",
    whatsapp: c?.whatsapp ?? "",
    website: c?.website ?? "",
    email: c?.email ?? "",
    // a NEW company starts on a colour that is visibly not ours
    brand_color: c?.brand_color ?? startingBrandColor(c?.name ?? String(Date.now())),
    accent_color: c?.accent_color ?? "#f0ad22",
    resells: c?.resells ?? true,
    show_prices: c?.show_prices ?? false,
    active: c?.active ?? true,
    note: c?.note ?? "",
  };
}

export function PartnerCompanies({ companies }: { companies: PartnerCompany[] }) {
  const { t } = useTraveliunUI();
  const router = useRouter();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    if (!draft) return;
    startTransition(async () => {
      setError(null);
      const res = await upsertPartnerCompany({
        id: draft.id,
        name: draft.name,
        name_latin: draft.name_latin || null,
        contact_name: draft.contact_name || null,
        address: draft.address || null,
        phone: draft.phone || null,
        whatsapp: draft.whatsapp || null,
        website: draft.website || null,
        email: draft.email || null,
        brand_color: draft.brand_color,
        accent_color: draft.accent_color,
        resells: draft.resells,
        show_prices: draft.show_prices,
        active: draft.active,
        note: draft.note || null,
      });
      if (!res.ok) {
        setError(t(res.error));
        return;
      }
      // Stay on the record after creating it: the logo can only be uploaded once
      // the row exists (its id is the storage folder).
      setDraft((d) => (d ? { ...d, id: res.id } : d));
      router.refresh();
    });
  }

  return (
    <TraveliunShell title="nav.partnerCompanies">
      <div className="tv-fade-up space-y-4">
        <section className={card}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-lg font-extrabold text-[#003c3a]">{t("partner.title")}</h1>
              <p className="mt-1 text-[12.5px] font-semibold text-[#93aaa3]">{t("partner.subtitle")}</p>
            </div>
            <button
              type="button"
              onClick={() => { setError(null); setDraft(toDraft()); }}
              className="inline-flex h-10 items-center gap-2 rounded-[10px] bg-[#185045] px-4 text-[12.5px] font-bold text-white hover:bg-[#0f4439]"
            >
              <Plus className="size-4" />
              {t("partner.add")}
            </button>
          </div>
        </section>

        {draft ? (
          <section className={card}>
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="text-sm font-extrabold text-[#185045]">
                {draft.id ? t("partner.editing", { name: draft.name || "—" }) : t("partner.add")}
              </h2>
              <button
                type="button"
                onClick={() => setDraft(null)}
                className="flex size-9 items-center justify-center rounded-[9px] border border-[#dbe6e1] text-[#557d78] hover:bg-[#f4f8f6]"
                aria-label={t("close")}
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(220px,1fr))]">
              <label className={label}>
                {t("partner.name")}
                <input className={field} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              </label>
              <label className={label}>
                {t("partner.nameLatin")}
                <input dir="ltr" className={field} value={draft.name_latin} onChange={(e) => setDraft({ ...draft, name_latin: e.target.value })} />
              </label>
              <label className={label}>
                {t("partner.contactName")}
                <input className={field} value={draft.contact_name} onChange={(e) => setDraft({ ...draft, contact_name: e.target.value })} />
              </label>
              <label className={label}>
                {t("partner.address")}
                <input className={field} value={draft.address} onChange={(e) => setDraft({ ...draft, address: e.target.value })} />
              </label>
              <label className={label}>
                {t("partner.phone")}
                <input dir="ltr" className={field} value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} />
              </label>
              <label className={label}>
                {t("partner.whatsapp")}
                <input dir="ltr" className={field} value={draft.whatsapp} onChange={(e) => setDraft({ ...draft, whatsapp: e.target.value })} />
              </label>
              <label className={label}>
                {t("partner.website")}
                <input dir="ltr" className={field} value={draft.website} onChange={(e) => setDraft({ ...draft, website: e.target.value })} />
              </label>
              <label className={label}>
                {t("partner.email")}
                <input dir="ltr" className={field} value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} />
              </label>
            </div>

            {/* native colour inputs: the OS picker is better than anything worth
                writing here, and it needs no library */}
            <div className="mt-4 grid gap-3 sm:grid-cols-[auto_auto_1fr] sm:items-end">
              <label className={label}>
                {t("partner.brandColor")}
                <input
                  type="color"
                  value={draft.brand_color}
                  onChange={(e) => setDraft({ ...draft, brand_color: e.target.value })}
                  className="h-11 w-24 cursor-pointer rounded-[10px] border border-[#dbe6e1] bg-white p-1"
                />
              </label>
              <label className={label}>
                {t("partner.accentColor")}
                <input
                  type="color"
                  value={draft.accent_color}
                  onChange={(e) => setDraft({ ...draft, accent_color: e.target.value })}
                  className="h-11 w-24 cursor-pointer rounded-[10px] border border-[#dbe6e1] bg-white p-1"
                />
              </label>
              <BrandPreview primary={draft.brand_color} accent={draft.accent_color} name={draft.name} />
            </div>
            <p className="mt-1.5 text-[11px] font-semibold text-[#93aaa3]">{t("partner.colorsHint")}</p>
            {isHouseColor(draft.brand_color) ? (
              <p className="mt-1.5 flex items-center gap-1.5 rounded-[9px] bg-[#fff8e8] px-3 py-2 text-[11.5px] font-bold text-[#a86a10]">
                <AlertTriangle className="size-3.5 shrink-0" />
                {t("partner.err.houseColor")}
              </p>
            ) : null}

            <div className="mt-4 flex flex-wrap gap-4">
              <Toggle checked={draft.resells} onChange={(v) => setDraft({ ...draft, resells: v })} text={t("partner.resells")} hint={t("partner.resellsHint")} />
              <Toggle checked={draft.show_prices} onChange={(v) => setDraft({ ...draft, show_prices: v })} text={t("partner.showPrices")} hint={t("partner.showPricesHint")} />
              <Toggle checked={draft.active} onChange={(v) => setDraft({ ...draft, active: v })} text={t("partner.active")} />
            </div>

            <label className={`${label} mt-4`}>
              {t("partner.note")}
              <input className={field} value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} />
            </label>

            {draft.id ? <LogoUpload partnerId={draft.id} /> : null}

            {error ? (
              <p role="alert" className="mt-3 rounded-[10px] border border-[#f4c9d4] bg-[#fdeef2] px-4 py-2.5 text-[12.5px] font-bold text-[#c22850]">
                {error}
              </p>
            ) : null}

            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={save}
                disabled={pending}
                className="inline-flex h-11 items-center gap-2 rounded-[10px] bg-[#185045] px-5 text-[13px] font-bold text-white hover:bg-[#0f4439] disabled:opacity-60"
              >
                {pending ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                {t("save")}
              </button>
              <button
                type="button"
                onClick={() => setDraft(null)}
                className="inline-flex h-11 items-center rounded-[10px] border border-[#d8e3de] px-5 text-[13px] font-bold text-[#185045] hover:bg-[#f4f8f6]"
              >
                {t("cancel")}
              </button>
            </div>
          </section>
        ) : null}

        {companies.length === 0 ? (
          <section className={card}>
            <EmptyState icon={Building2} title={t("partner.none")} description={t("partner.noneHint")} />
          </section>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {companies.map((c) => (
              <CompanyRow key={c.id} company={c} onEdit={() => { setError(null); setDraft(toDraft(c)); }} />
            ))}
          </div>
        )}
      </div>
    </TraveliunShell>
  );
}

/** The document's palette as the document will actually paint it. */
function BrandPreview({ primary, accent, name }: { primary: string; accent: string; name: string }) {
  const vars = brandVars(primary, accent);
  return (
    <div
      className="flex min-h-11 flex-wrap items-center gap-2 rounded-[10px] border p-2"
      style={{ borderColor: vars["--od-line"], background: vars["--od-soft"] }}
    >
      <span className="rounded-[7px] px-2.5 py-1 text-[11.5px] font-extrabold text-white" style={{ background: vars["--od-green"] }}>
        {name || "—"}
      </span>
      <span className="rounded-[7px] px-2 py-1 text-[11px] font-bold" style={{ background: vars["--od-gold"], color: "#3a2a00" }}>
        ★★★★
      </span>
      <span className="rounded-[7px] border px-2 py-1 text-[11px] font-bold" style={{ borderColor: vars["--od-line-2"], color: vars["--od-green-2"] }}>
        الإجمالي
      </span>
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  text,
  hint,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  text: string;
  hint?: string;
}) {
  return (
    <label className="flex max-w-[280px] cursor-pointer items-start gap-2">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 size-4 accent-[#185045]" />
      <span>
        <span className="block text-[12.5px] font-bold text-[#185045]">{text}</span>
        {hint ? <span className="block text-[11px] font-semibold text-[#93aaa3]">{hint}</span> : null}
      </span>
    </label>
  );
}

function LogoUpload({ partnerId }: { partnerId: string }) {
  const { t } = useTraveliunUI();
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pick(file: File) {
    setBusy(true);
    setError(null);
    const form = new FormData();
    form.set("file", file);
    const res = await uploadPartnerLogo(partnerId, form);
    setBusy(false);
    if (!res.ok) setError(t(res.error));
    else router.refresh();
  }

  return (
    <div className="mt-4 rounded-[10px] border border-dashed border-[#cfe0d9] p-3">
      <p className="text-[12px] font-bold text-[#185045]">{t("partner.logo")}</p>
      <p className="mt-0.5 text-[11px] font-semibold text-[#93aaa3]">{t("partner.logoHint")}</p>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/svg+xml"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void pick(file);
          e.target.value = "";
        }}
      />
      <button
        type="button"
        disabled={busy}
        onClick={() => input.current?.click()}
        className="mt-2 inline-flex h-10 items-center gap-2 rounded-[9px] border border-[#dbe6e1] px-3 text-[12.5px] font-bold text-[#185045] hover:bg-[#f4f8f6] disabled:opacity-60"
      >
        {busy ? <Loader2 className="size-4 animate-spin" /> : <ImageUp className="size-4" />}
        {t("partner.uploadLogo")}
      </button>
      {error ? <p className="mt-2 text-[11.5px] font-bold text-[#c22850]">{error}</p> : null}
    </div>
  );
}

function CompanyRow({ company, onEdit }: { company: PartnerCompany; onEdit: () => void }) {
  const { t } = useTraveliunUI();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const vars = brandVars(company.brand_color, company.accent_color);

  return (
    <article className={`${card} ${company.active ? "" : "opacity-70"}`}>
      <div className="flex items-start gap-3">
        <span
          className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-[12px] border"
          style={{ borderColor: vars["--od-line"], background: vars["--od-soft"] }}
        >
          {company.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={company.logo_url} alt={company.name_latin ?? company.name} className="max-h-12 max-w-12 object-contain" />
          ) : (
            <Building2 className="size-6" style={{ color: vars["--od-green"] }} />
          )}
        </span>

        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-extrabold text-[#003c3a]">{company.name}</p>
          <p className="truncate text-[11.5px] font-semibold text-[#93aaa3]">
            {[company.name_latin, company.phone, company.website].filter(Boolean).join(" · ") || "—"}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] font-bold">
            {company.resells ? (
              <span className="rounded-full bg-[#e9f7f0] px-2.5 py-1 text-[#0f7a52]">{t("partner.resells")}</span>
            ) : null}
            <span className={`rounded-full px-2.5 py-1 ${company.show_prices ? "bg-[#fff8e8] text-[#a86a10]" : "bg-[#eef4f1] text-[#557d78]"}`}>
              {company.show_prices ? t("doc.withPrices") : t("doc.withoutPrices")}
            </span>
            {!company.active ? <span className="rounded-full bg-[#fdeef2] px-2.5 py-1 text-[#c22850]">{t("partner.deactivated")}</span> : null}
          </div>
        </div>

        <div className="flex shrink-0 gap-1.5">
          <button
            type="button"
            onClick={onEdit}
            className="flex size-9 items-center justify-center rounded-[9px] border border-[#dbe6e1] text-[#557d78] hover:bg-[#f4f8f6]"
            aria-label={t("edit")}
          >
            <Pencil className="size-4" />
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                if (!window.confirm(t("partner.deleteConfirm"))) return;
                await deletePartnerCompany(company.id);
                router.refresh();
              })
            }
            className="flex size-9 items-center justify-center rounded-[9px] border border-[#f0c7c7] text-[#c22850] hover:bg-[#fdeef2] disabled:opacity-60"
            aria-label={t("delete")}
          >
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
          </button>
        </div>
      </div>

      <div className="mt-3">
        <BrandPreview primary={company.brand_color} accent={company.accent_color} name={company.name} />
      </div>
    </article>
  );
}
