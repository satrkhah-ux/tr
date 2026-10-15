"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Eye, EyeOff, ExternalLink, Loader2, Lock, Pencil, Plus, ScanLine, ShieldAlert, Trash2, Upload, Users } from "lucide-react";
import { DirText } from "@/components/DirText";
import {
  deleteTraveler,
  getPassportScanUrl,
  getTravelerPassport,
  getVisaFileUrl,
  readPassportMrz,
  seedTravelersFromOffer,
  setTravelerVisa,
  uploadPassportScan,
  uploadVisaFile,
  upsertTraveler,
} from "@/lib/data/operation-travelers";
import { VISA_STATUSES, type PassportRead, type TravelerKind, type TravelerListItem, type VisaStatus } from "@/lib/operations/traveler-dto";
import { ageOn, isLatinName, travelerReadiness } from "@/lib/operations/travelers";
import { trustedFields, type MrzCheckedField, type MrzFormField, type MrzPassport } from "@/lib/operations/mrz";
import type { TranslationKey } from "@/lib/i18n";
import { useTraveliunUI } from "../TraveliunUIProvider";
import { useSafeTransition, useSessionField } from "../useSafeTransition";
import { acceptClientPassport, type PendingClientPassport } from "@/lib/data/client-passports";
import { ClientPassportReview, useClientPassports } from "./ClientPassportReview";

const card = "rounded-2xl border border-[#e2ebe7] bg-white p-5 shadow-[0_1px_2px_rgba(0,60,58,0.04)]";
const field =
  "h-11 w-full rounded-[10px] border border-[#dbe6e1] bg-white px-3 text-sm text-[#185045] outline-none focus:border-[#2aa87a]";
const label = "grid gap-1.5 text-[12px] font-bold text-[#185045]";
const smallBtn =
  "inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-[#dbe6e1] px-2.5 text-[11.5px] font-bold text-[#185045] hover:bg-[#f4f8f6] disabled:opacity-60";
const dashedBtn =
  "inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-[8px] border border-dashed border-[#b7d0c7] px-2.5 text-[11.5px] font-bold text-[#185045] hover:bg-[#f0f7f4]";

const KINDS: TravelerKind[] = ["adult", "child", "infant"];
const KIND_KEY = (k: TravelerKind) => `ops.traveler.${k}` as TranslationKey;
const VISA_KEY = (s: VisaStatus) => `ops.trav.visa.${s}` as TranslationKey;
// the checks with no form field of their own — a failed field's value is left empty instead (trustedFields)
const MRZ_CHECK_KEY: Partial<Record<MrzCheckedField, TranslationKey>> = {
  personal: "ops.trav.mrz.personal",
  composite: "ops.trav.mrz.composite",
};

type Trip = { travel_start: string | null; travel_end: string | null };
type Fail = { ok: false; error: TranslationKey };

export function TravelersPanel({
  operationId,
  trip,
  travelers,
  canReadMrz,
}: {
  operationId: string;
  trip: Trip;
  travelers: TravelerListItem[];
  /** the OpenAI key is set — without it the photo-reading button is not drawn. */
  canReadMrz: boolean;
}) {
  const { t } = useTraveliunUI();
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  // kept in this tab until added — a reload after a deploy used to lose it
  const [name, setName] = useSessionField(`trav:${operationId}`, "");
  const [kind, setKind] = useState<TravelerKind>("adult");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useSafeTransition();
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Riyadh" });
  const clientPassports = useClientPassports(operationId, travelers);

  // «بالغ 2» for a row nobody has named yet — shown, never stored (it would print on a voucher)
  const seen: Partial<Record<TravelerKind, number>> = {};
  const placeholders = travelers.map((tr) => `${t(KIND_KEY(tr.traveler_kind))} ${(seen[tr.traveler_kind] = (seen[tr.traveler_kind] ?? 0) + 1)}`);

  function run(action: () => Promise<{ ok: true } | Fail>, after?: () => void) {
    startTransition(async () => {
      setError(null);
      const res = await action();
      if (!res.ok) setError(t(res.error));
      else {
        after?.();
        router.refresh();
      }
    });
  }

  return (
    <section id="travelers" className={`${card} scroll-mt-24`}>
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-extrabold text-[#185045]">{t("ops.travelers")}</h2>
        <button
          type="button"
          onClick={() => setAdding((v) => !v)}
          className="inline-flex h-9 items-center gap-1.5 rounded-[9px] border border-dashed border-[#b7d0c7] px-3 text-[12px] font-bold text-[#185045] hover:bg-[#f0f7f4]"
        >
          <Plus className="size-3.5" />
          {t("ops.traveler.add")}
        </button>
      </div>
      <p className="mb-3 flex items-center gap-1.5 text-[11.5px] font-semibold text-[#93aaa3]">
        <Lock className="size-3.5" />
        {t("ops.passport.audited")}
      </p>

      {adding ? (
        <div className="mb-3 flex flex-wrap items-end gap-2 rounded-[11px] border border-[#e2ebe7] bg-[#f8fbf9] p-3">
          <label className={`${label} min-w-40 flex-1`}>
            {t("ops.traveler.name")}
            <input value={name} onChange={(e) => setName(e.target.value)} className={field} />
          </label>
          <label className={label}>
            {t("ops.traveler.kind")}
            <select value={kind} onChange={(e) => setKind(e.target.value as TravelerKind)} className={field}>
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(KIND_KEY(k))}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={pending || !name.trim()}
            onClick={() =>
              run(
                () => upsertTraveler({ operation_id: operationId, display_name: name.trim(), traveler_kind: kind, sort: travelers.length }),
                () => {
                  setName("");
                  setAdding(false);
                },
              )
            }
            className="inline-flex h-11 items-center gap-2 rounded-[10px] bg-[#185045] px-4 text-[13px] font-bold text-white hover:bg-[#0f4439] disabled:opacity-60"
          >
            {pending ? <Loader2 className="size-4 animate-spin" /> : null}
            {t("add")}
          </button>
        </div>
      ) : null}

      {error ? <p className="mb-2 text-[11.5px] font-bold text-[#c22850]">{error}</p> : null}

      {travelers.length === 0 ? (
        <div className="rounded-[10px] border border-dashed border-[#cfe0d9] px-4 py-6 text-center">
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => seedTravelersFromOffer(operationId))}
            className="inline-flex h-10 items-center gap-2 rounded-[10px] bg-[#185045] px-4 text-[12.5px] font-bold text-white hover:bg-[#0f4439] disabled:opacity-60"
          >
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Users className="size-4" />}
            {t("ops.trav.seed")}
          </button>
          <p className="mt-2 text-[11.5px] font-semibold text-[#93aaa3]">{t("ops.trav.seedHint")}</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {travelers.map((tr, i) => (
            <TravelerRow key={tr.id} traveler={tr} placeholder={placeholders[i]} trip={trip} today={today} canReadMrz={canReadMrz} clientPassport={clientPassports[tr.id]} />
          ))}
        </ul>
      )}
    </section>
  );
}

type Form = {
  display_name: string;
  traveler_kind: TravelerKind;
  birth_date: string;
  nationality: string;
  full_name: string;
  number: string;
  expiry: string;
  /** a client upload under review — Save then accepts it */
  cpass?: string;
};

function TravelerRow({
  traveler,
  placeholder,
  trip,
  today,
  canReadMrz,
  clientPassport,
}: {
  traveler: TravelerListItem;
  placeholder: string;
  trip: Trip;
  today: string;
  canReadMrz: boolean;
  clientPassport?: PendingClientPassport;
}) {
  const { t } = useTraveliunUI();
  const router = useRouter();
  const [passport, setPassport] = useState<PassportRead | null>(null);
  // never in browser storage: a passport number stays in this component only
  const [form, setForm] = useState<Form | null>(null);
  const [mrz, setMrz] = useState<MrzPassport | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useSafeTransition();

  const gaps = travelerReadiness(traveler, trip, today);
  const travelAge = ageOn(traveler.birth_date, trip.travel_start ?? today);
  const set = (patch: Partial<Form>) => setForm((f) => (f ? { ...f, ...patch } : f));
  // what the read did NOT give — empty, never guessed (owner order 10)
  const missing = mrz ? trustedFields(mrz, today).missing : [];
  const manual = (f: MrzFormField) => (missing.includes(f) && form && !form[f] ? "border-[#e0a33a] bg-[#fffaf0]" : "");
  const fillTag = (f: MrzFormField) =>
    manual(f) ? <span className="text-[10.5px] font-bold text-[#a86a10]">{t("ops.trav.fillManually")}</span> : null;
  const checkFails = (mrz?.failed ?? []).flatMap((f) => {
    const key = MRZ_CHECK_KEY[f];
    return key ? [t(key)] : [];
  });

  function openEdit(prefill: Partial<Form> = {}) {
    const known = passport?.state === "ok" ? passport.passport : null;
    setForm({
      display_name: traveler.display_name,
      traveler_kind: traveler.traveler_kind,
      birth_date: traveler.birth_date ?? "",
      nationality: traveler.nationality ?? known?.nationality ?? "",
      // the name already written, when it is in the passport's alphabet — not typed twice
      full_name: known?.full_name ?? (isLatinName(traveler.display_name) ? traveler.display_name.trim().toUpperCase() : ""),
      number: known?.number ?? "",
      expiry: traveler.passport_expiry ?? "",
      ...prefill,
    });
  }

  function call<R extends { ok: true }>(action: () => Promise<R | Fail>, after: (res: R) => void) {
    startTransition(async () => {
      setError(null);
      const res = await action();
      if (res.ok) after(res);
      else setError(t(res.error));
    });
  }

  function save() {
    if (!form) return;
    const number = form.number.trim();
    const input = {
      // an unnamed companion takes the passport name — written once
      display_name: form.display_name.trim() || form.full_name.trim(),
      traveler_kind: form.traveler_kind,
      birth_date: form.birth_date || null,
      nationality: form.nationality.trim() || null,
      passport_expiry: form.expiry || null,
      // the blob is replaced only when a number is given; fixing a birth date leaves it as it is
      ...(number ? { passport: { full_name: form.full_name.trim(), number, nationality: form.nationality.trim() } } : {}),
    };
    call(
      () => (form.cpass ? acceptClientPassport(form.cpass, input) : upsertTraveler({ ...input, id: traveler.id, operation_id: "" })),
      () => {
        setForm(null);
        setMrz(null);
        setPassport(null);
        router.refresh();
      },
    );
  }

  function readPhoto(file: File) {
    const fd = new FormData();
    fd.append("file", file);
    call(
      () => readPassportMrz(traveler.id, fd),
      (res) => {
        const p = res.passport;
        const { values } = trustedFields(p, today);
        setMrz(p);
        openEdit({ display_name: traveler.display_name || values.full_name, ...values });
        // the photo may have become the scan
        router.refresh();
      },
    );
  }

  function upload(action: typeof uploadPassportScan, file: File) {
    const fd = new FormData();
    fd.append("file", file);
    call(() => action(traveler.id, fd), () => router.refresh());
  }

  function openUrl(action: typeof getPassportScanUrl) {
    call(
      () => action(traveler.id),
      (res) => window.open(res.url, "_blank", "noopener"),
    );
  }

  return (
    <li className="rounded-[11px] border border-[#e2ebe7] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className={`truncate text-[13px] font-extrabold ${traveler.display_name ? "text-[#0f3d38]" : "text-[#93aaa3]"}`}>
            {traveler.display_name || placeholder}
          </p>
          <p className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] font-bold text-[#93aaa3]">
            <span>{t(KIND_KEY(traveler.traveler_kind))}</span>
            {traveler.age != null ? <span>{t("ops.trav.soldAge", { n: traveler.age })}</span> : null}
            {traveler.birth_date ? (
              <span className="tv-tnum">
                {t("ops.trav.birthDate")} <DirText dir="ltr">{traveler.birth_date}</DirText>
              </span>
            ) : null}
            {traveler.nationality ? <span>{traveler.nationality}</span> : null}
            {traveler.passport_expiry ? (
              <span className="tv-tnum">
                {t("ops.passport.expiry")} <DirText dir="ltr">{traveler.passport_expiry}</DirText>
              </span>
            ) : null}
            {traveler.has_passport ? <span className="text-[#0f7a52]">{t("ops.passport.onFile")}</span> : null}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <button type="button" disabled={pending} onClick={() => (form ? setForm(null) : openEdit())} className={smallBtn}>
            <Pencil className="size-3.5" />
            {t("ops.trav.edit")}
          </button>
          {canReadMrz ? (
            <label className={dashedBtn}>
              {pending ? <Loader2 className="size-3.5 animate-spin" /> : <ScanLine className="size-3.5" />}
              {t("ops.trav.readMrz")}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                disabled={pending}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) readPhoto(f);
                }}
              />
            </label>
          ) : null}
          {traveler.has_passport ? (
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                passport
                  ? setPassport(null)
                  : call(
                      async () => {
                        const res = await getTravelerPassport(traveler.id);
                        return "state" in res ? { ok: true as const, read: res } : res;
                      },
                      (res) => setPassport(res.read),
                    )
              }
              className={smallBtn}
            >
              {passport ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
              {passport ? t("ops.passport.hide") : t("ops.passport.reveal")}
            </button>
          ) : null}
          {traveler.has_scan ? (
            <button type="button" disabled={pending} onClick={() => openUrl(getPassportScanUrl)} className={smallBtn}>
              <ExternalLink className="size-3.5" />
              {t("ops.passport.openScan")}
            </button>
          ) : (
            <label className={dashedBtn}>
              <Upload className="size-3.5" />
              {t("ops.passport.upload")}
              <input
                type="file"
                accept="image/*,application/pdf"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) upload(uploadPassportScan, f);
                }}
              />
            </label>
          )}
          <button
            type="button"
            disabled={pending}
            onClick={() => setConfirmDelete(true)}
            aria-label={t("delete")}
            title={t("delete")}
            className="inline-flex size-8 items-center justify-center rounded-[8px] border border-[#f2c7c7] text-[#c43d3d] hover:bg-[#fff1f1] disabled:opacity-60"
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      </div>

      {clientPassport ? (
        <ClientPassportReview
          submission={clientPassport}
          displayName={traveler.display_name}
          onReview={(prefill, read) => {
            setMrz(read);
            openEdit(prefill);
          }}
        />
      ) : null}

      {/* what this traveler still lacks for travel — the per-person half of «جاهز للسفر» */}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {gaps.length === 0 ? (
          <span className="rounded-full bg-[#e9f7f0] px-2 py-0.5 text-[10.5px] font-bold text-[#0f7a52]">{t("ops.trav.ready")}</span>
        ) : (
          gaps.map((g) => (
            <span key={g} className="rounded-full bg-[#fdecef] px-2 py-0.5 text-[10.5px] font-bold text-[#c22850]">
              {t(`ops.trav.gap.${g}` as TranslationKey, { n: travelAge ?? "", nat: traveler.nationality || "—" })}
            </span>
          ))
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] font-bold text-[#93aaa3]">{t("ops.trav.visa")}</span>
        <select
          value={traveler.visa_status}
          disabled={pending}
          onChange={(e) => {
            const status = e.target.value as VisaStatus;
            call(() => setTravelerVisa(traveler.id, status), () => router.refresh());
          }}
          className="h-8 rounded-[8px] border border-[#dbe6e1] bg-white px-2 text-[11.5px] font-bold text-[#185045] outline-none focus:border-[#2aa87a] disabled:opacity-60"
        >
          {VISA_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(VISA_KEY(s))}
            </option>
          ))}
        </select>
        {traveler.has_visa_file ? (
          <button type="button" disabled={pending} onClick={() => openUrl(getVisaFileUrl)} className={smallBtn}>
            <ExternalLink className="size-3.5" />
            {t("ops.trav.visa.open")}
          </button>
        ) : null}
        {traveler.visa_status !== "not_required" ? (
          <label className={dashedBtn}>
            <Upload className="size-3.5" />
            {t("ops.trav.visa.upload")}
            <input
              type="file"
              accept="image/*,application/pdf"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) upload(uploadVisaFile, f);
              }}
            />
          </label>
        ) : null}
      </div>

      {error ? <p className="mt-2 text-[11.5px] font-bold text-[#c22850]">{error}</p> : null}

      {confirmDelete ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-[9px] border border-[#f2c7c7] bg-[#fff6f6] px-3 py-2">
          <span className="text-[12px] font-bold text-[#c43d3d]">{t("ops.trav.deleteConfirm")}</span>
          <button
            type="button"
            disabled={pending}
            onClick={() => call(() => deleteTraveler(traveler.id), () => router.refresh())}
            className="inline-flex h-8 items-center gap-1.5 rounded-[8px] bg-[#c43d3d] px-3 text-[11.5px] font-bold text-white hover:bg-[#a83232] disabled:opacity-60"
          >
            {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
            {t("ops.trav.deleteYes")}
          </button>
          <button type="button" disabled={pending} onClick={() => setConfirmDelete(false)} className={smallBtn}>
            {t("cancel")}
          </button>
        </div>
      ) : null}

      {form ? (
        <div className="mt-2 grid gap-2 rounded-[9px] border border-[#e2ebe7] bg-[#f8fbf9] p-3 sm:grid-cols-2">
          {mrz ? (
            <div className="grid gap-1 rounded-[8px] bg-[#fff8e8] px-3 py-2 text-[11.5px] font-bold text-[#a86a10] sm:col-span-2">
              <span>{t("ops.trav.mrzReview")}</span>
              {missing.length > 0 ? <span>{t("ops.trav.mrzMissing")}</span> : null}
              {checkFails.length > 0 ? <span className="text-[#c22850]">{t("ops.trav.mrzCheck", { fields: checkFails.join(" · ") })}</span> : null}
            </div>
          ) : null}
          <label className={label}>
            {t("ops.traveler.name")}
            <input value={form.display_name} onChange={(e) => set({ display_name: e.target.value })} className={field} />
          </label>
          <label className={label}>
            {t("ops.traveler.kind")}
            <select value={form.traveler_kind} onChange={(e) => set({ traveler_kind: e.target.value as TravelerKind })} className={field}>
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(KIND_KEY(k))}
                </option>
              ))}
            </select>
          </label>
          <label className={label}>
            <span className="flex flex-wrap items-center gap-1.5">
              {t("ops.passport.fullName")}
              {fillTag("full_name")}
            </span>
            <input
              dir="ltr"
              value={form.full_name}
              onChange={(e) => set({ full_name: e.target.value })}
              className={`${field} text-start ${manual("full_name")}`}
              placeholder="AHMED ALI"
            />
          </label>
          <label className={label}>
            <span className="flex flex-wrap items-center gap-1.5">
              {t("ops.passport.number")}
              {fillTag("number")}
            </span>
            <input
              dir="ltr"
              value={form.number}
              onChange={(e) => set({ number: e.target.value })}
              className={`${field} tv-tnum text-start ${manual("number")}`}
            />
          </label>
          <label className={label}>
            <span className="flex flex-wrap items-center gap-1.5">
              {t("ops.passport.nationality")}
              {fillTag("nationality")}
            </span>
            <input value={form.nationality} onChange={(e) => set({ nationality: e.target.value })} className={`${field} ${manual("nationality")}`} />
          </label>
          <label className={label}>
            <span className="flex flex-wrap items-center gap-1.5">
              {t("ops.trav.birthDate")}
              {fillTag("birth_date")}
            </span>
            <input
              type="date"
              dir="ltr"
              value={form.birth_date}
              onChange={(e) => set({ birth_date: e.target.value })}
              className={`${field} tv-tnum ${manual("birth_date")}`}
            />
          </label>
          <label className={label}>
            <span className="flex flex-wrap items-center gap-1.5">
              {t("ops.passport.expiry")}
              {fillTag("expiry")}
            </span>
            <input
              type="date"
              dir="ltr"
              value={form.expiry}
              onChange={(e) => set({ expiry: e.target.value })}
              className={`${field} tv-tnum ${manual("expiry")}`}
            />
          </label>
          <div className="flex flex-wrap items-end gap-2 sm:col-span-2">
            <button
              type="button"
              disabled={pending}
              onClick={save}
              className="inline-flex h-10 items-center gap-2 rounded-[10px] bg-[#185045] px-4 text-[12.5px] font-bold text-white hover:bg-[#0f4439] disabled:opacity-60"
            >
              {pending ? <Loader2 className="size-4 animate-spin" /> : <Lock className="size-4" />}
              {t("save")}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                setForm(null);
                setMrz(null);
              }}
              className="inline-flex h-10 items-center rounded-[10px] border border-[#dbe6e1] px-4 text-[12.5px] font-bold text-[#557d78] hover:bg-[#f4f8f6]"
            >
              {t("cancel")}
            </button>
          </div>
        </div>
      ) : null}

      {passport ? (
        passport.state === "ok" ? (
          <div className="mt-2 grid gap-1 rounded-[9px] bg-[#f4f8f6] px-3 py-2 text-[12px] font-bold text-[#0f3d38] sm:grid-cols-3">
            <span>{passport.passport.full_name}</span>
            <span className="tv-tnum">
              <DirText dir="ltr">{passport.passport.number}</DirText>
            </span>
            <span>{passport.passport.nationality}</span>
          </div>
        ) : passport.state === "unavailable" ? (
          // NOT "no passport on file" — a config error and a missing record are
          // different facts, and conflating them hides a real incident.
          <p className="mt-2 flex items-start gap-1.5 rounded-[9px] bg-[#fff8e8] px-3 py-2 text-[11.5px] font-bold text-[#a86a10]">
            <ShieldAlert className="mt-0.5 size-3.5 shrink-0" />
            {t("ops.passport.unavailable")}
          </p>
        ) : (
          <p className="mt-2 text-[11.5px] font-bold text-[#93aaa3]">{t("ops.passport.none")}</p>
        )
      ) : null}
    </li>
  );
}
