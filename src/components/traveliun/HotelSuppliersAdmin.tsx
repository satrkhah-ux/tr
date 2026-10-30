"use client";

import { useState } from "react";
import Link from "next/link";
import { CheckCircle2, KeyRound, Loader2, PlugZap, Search, XCircle } from "lucide-react";
import { DirText } from "@/components/DirText";
import { setHotelSearchSource } from "@/lib/data/app-settings";
import {
  saveSupplier,
  testSupplierConnection,
  type SupplierView,
} from "@/lib/data/suppliers";
import { useTraveliunUI } from "./TraveliunUIProvider";
import { TraveliunShell } from "./TraveliunShell";

type MarkupOption = { id: string; name: string };

const fieldClass =
  "tv-field h-10 rounded-[9px] border px-3 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-tv-action-focus";
const labelClass = "grid gap-1 text-[12px] font-bold text-[#185045]";

export function HotelSuppliersAdmin({
  suppliers,
  markupRules,
  searchSource,
}: {
  suppliers: SupplierView[];
  markupRules: MarkupOption[];
  /** what the package generator searches — set here, never by the agent. */
  searchSource: string;
}) {
  const { t } = useTraveliunUI();
  return (
    <TraveliunShell title="settings.suppliers.title">
      <div className="tv-fade-up mx-auto max-w-[860px]">
        <h1 className="text-lg font-extrabold text-[#003c3a]">{t("settings.suppliers.title")}</h1>
        <p className="mt-1 mb-5 text-[12.5px] font-semibold text-tv-text-faint">{t("settings.suppliers.subtitle")}</p>

        <SearchSourceCard suppliers={suppliers} initial={searchSource} />

        {suppliers.length === 0 ? (
          <p className="rounded-[12px] border border-dashed border-[#cfe0d9] px-4 py-10 text-center text-sm text-tv-text-faint">
            {t("settings.suppliers.empty")}
          </p>
        ) : (
          <div className="space-y-4">
            {suppliers.map((s) => (
              <SupplierCard key={s.code} supplier={s} markupRules={markupRules} />
            ))}
          </div>
        )}
      </div>
    </TraveliunShell>
  );
}

/**
 * «مصدر البحث عن الفنادق» — one decision for the whole agency.
 *
 * The agent used to choose the booking system in front of every hotel; now
 * the administration decides it here and the hotel popup only asks for a name.
 * A supplier must be enabled to be chosen, or the agents would search nothing.
 */
function SearchSourceCard({ suppliers, initial }: { suppliers: SupplierView[]; initial: string }) {
  const { t } = useTraveliunUI();
  const [value, setValue] = useState(initial);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const options = [
    { code: "internal", label: t("settings.searchSource.internal"), enabled: true },
    ...suppliers.map((s) => ({ code: s.code, label: s.name_ar, enabled: s.enabled })),
  ];

  async function choose(code: string) {
    const previous = value;
    setValue(code);
    setState("saving");
    const result = await setHotelSearchSource(code);
    if (result.ok) {
      setState("saved");
    } else {
      setValue(previous);
      setState("error");
    }
  }

  return (
    <section className="mb-5 rounded-[14px] border border-[#cfe0d9] bg-white p-4">
      <h2 className="text-[14px] font-extrabold text-[#185045]">{t("settings.searchSource.title")}</h2>
      <p className="mt-1 mb-3 text-[12px] font-semibold text-tv-text-faint">{t("settings.searchSource.hint")}</p>
      <div role="radiogroup" aria-label={t("settings.searchSource.title")} className="flex flex-wrap gap-2">
        {options.map((o) => (
          <button
            key={o.code}
            type="button"
            role="radio"
            aria-checked={value === o.code}
            disabled={!o.enabled || state === "saving"}
            onClick={() => void choose(o.code)}
            className={`inline-flex h-10 items-center gap-2 rounded-[10px] border px-3.5 text-[12.5px] font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${
              value === o.code
                ? "border-[#185045] bg-[#185045] text-white"
                : "border-[#dbe6e1] bg-white text-[#185045] hover:bg-[#f4f8f6]"
            }`}
          >
            {value === o.code ? <CheckCircle2 className="size-4" /> : null}
            {o.label}
            {o.enabled ? "" : ` — ${t("settings.searchSource.disabled")}`}
          </button>
        ))}
      </div>
      {state === "saved" ? (
        <p role="status" className="mt-2 text-[11.5px] font-bold text-[#0f7a52]">{t("settings.searchSource.saved")}</p>
      ) : state === "error" ? (
        <p role="alert" className="mt-2 text-[11.5px] font-bold text-[#c22850]">{t("err.db")}</p>
      ) : null}
    </section>
  );
}

function SupplierCard({ supplier, markupRules }: { supplier: SupplierView; markupRules: MarkupOption[] }) {
  const { t } = useTraveliunUI();
  const [enabled, setEnabled] = useState(supplier.enabled);
  const [environment, setEnvironment] = useState(supplier.environment);
  const [baseUrl, setBaseUrl] = useState(supplier.base_url ?? "");
  const [priority, setPriority] = useState(supplier.priority);
  const [markupRule, setMarkupRule] = useState(supplier.default_markup_rule_id ?? "");
  const [hasCreds, setHasCreds] = useState(supplier.has_credentials);

  // Credentials are WRITE-ONLY: the stored secret is never sent here. The admin
  // must click "استبدال" to reveal empty inputs and enter a NEW secret.
  const [replacing, setReplacing] = useState(!supplier.has_credentials);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [test, setTest] = useState<{ state: "idle" | "testing" | "done"; ok?: boolean; message?: string }>({ state: "idle" });

  async function onSave() {
    setSaveState("saving");
    const res = await saveSupplier({
      code: supplier.code,
      enabled,
      environment,
      base_url: baseUrl || null,
      priority,
      default_markup_rule_id: markupRule || null,
      // only send secrets when replacing AND both provided
      ...(replacing && username && password ? { username, password } : {}),
    });
    if (res.ok) {
      setSaveState("saved");
      if (replacing && username && password) {
        setHasCreds(true);
        setReplacing(false);
        setUsername("");
        setPassword("");
      }
      window.setTimeout(() => setSaveState("idle"), 1600);
    } else {
      setSaveState("error");
    }
  }

  async function onTest() {
    setTest({ state: "testing" });
    const res = await testSupplierConnection(supplier.code);
    setTest({ state: "done", ok: res.ok, message: res.message });
  }

  return (
    <section className="rounded-2xl border border-[#e2ebe7] bg-white p-4 shadow-[0_1px_2px_rgba(0,60,58,0.04)]">
      {/* header */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-extrabold text-[#003c3a]">{supplier.name_ar}</h2>
          <p className="tv-tnum text-[11px] font-bold text-tv-text-faint">
            <DirText dir="ltr">{supplier.code.toUpperCase()}</DirText>
          </p>
        </div>
        <label className="inline-flex cursor-pointer items-center gap-2 text-[12.5px] font-bold text-[#185045]">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="size-4 accent-[#185045]" />
          {t("settings.suppliers.enabled")}
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className={labelClass}>
          {t("settings.suppliers.environment")}
          <select value={environment} onChange={(e) => setEnvironment(e.target.value)} className={fieldClass}>
            <option value="sandbox">{t("settings.suppliers.sandbox")}</option>
            <option value="live">{t("settings.suppliers.live")}</option>
          </select>
        </label>
        <label className={labelClass}>
          {t("settings.suppliers.priority")}
          <input type="number" dir="ltr" value={priority} onChange={(e) => setPriority(Number(e.target.value) || 0)} className={`${fieldClass} tv-tnum`} />
        </label>
        <label className={`${labelClass} sm:col-span-2`}>
          {t("settings.suppliers.baseUrl")}
          <input dir="ltr" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api…" className={`${fieldClass} tv-tnum text-start`} />
        </label>
        <label className={`${labelClass} sm:col-span-2`}>
          {t("settings.suppliers.defaultMarkup")}
          <select value={markupRule} onChange={(e) => setMarkupRule(e.target.value)} className={fieldClass}>
            <option value="">{t("settings.suppliers.noRule")}</option>
            {markupRules.map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
        </label>
      </div>

      {/* credentials — write-only */}
      <div className="mt-4 rounded-[12px] border border-[#e7f0ec] bg-[#f8fbf9] p-3">
        <p className="mb-2 flex items-center gap-2 text-[12.5px] font-extrabold text-[#185045]">
          <KeyRound className="size-4" />
          {t("settings.suppliers.credentials")}
        </p>
        {hasCreds && !replacing ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="tv-tnum text-[13px] font-bold text-[#557d78]">•••••• {t("settings.suppliers.credentialsStored")}</span>
            <button
              type="button"
              onClick={() => setReplacing(true)}
              className="inline-flex h-9 items-center gap-1.5 rounded-[9px] border border-[#dbe6e1] bg-white px-3 text-[12px] font-bold text-[#557d78] hover:bg-[#f0f7f4] max-sm:min-h-10"
            >
              {t("settings.suppliers.replace")}
            </button>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={labelClass}>
              {t("settings.suppliers.username")}
              <input dir="ltr" autoComplete="off" value={username} onChange={(e) => setUsername(e.target.value)} className={`${fieldClass} tv-tnum text-start`} />
            </label>
            <label className={labelClass}>
              {t("settings.suppliers.password")}
              <input dir="ltr" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className={`${fieldClass} tv-tnum text-start`} />
            </label>
            {hasCreds ? (
              <button
                type="button"
                onClick={() => { setReplacing(false); setUsername(""); setPassword(""); }}
                className="justify-self-start text-[12px] font-bold text-tv-text-faint hover:text-[#557d78]"
              >
                {t("settings.suppliers.cancel")}
              </button>
            ) : null}
          </div>
        )}
      </div>

      {/* last sync / error */}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] font-semibold text-tv-text-faint">
        <span>
          {t("settings.suppliers.lastSync")}:{" "}
          {supplier.last_sync_at ? <DirText dir="ltr">{supplier.last_sync_at.slice(0, 16).replace("T", " ")}</DirText> : t("settings.suppliers.never")}
        </span>
        {supplier.last_sync_status ? (
          <span className={supplier.last_sync_status === "ok" ? "text-[#0f7a52]" : "text-[#c22850]"}>
            {supplier.last_sync_status === "ok" ? "✓" : "✗"} {supplier.last_sync_status}
          </span>
        ) : null}
        {supplier.last_error ? <span className="text-[#c22850]">{supplier.last_error}</span> : null}
      </div>

      {/* actions */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void onSave()}
          disabled={saveState === "saving"}
          className="tv-btn-primary inline-flex h-9 items-center gap-2 rounded-[9px] px-4 text-[12.5px] font-bold transition-colors disabled:opacity-60 max-sm:min-h-10"
        >
          {saveState === "saving" ? <Loader2 className="size-4 animate-spin" /> : null}
          {saveState === "saved" ? t("settings.suppliers.saved") : t("settings.suppliers.save")}
        </button>
        <button
          type="button"
          onClick={() => void onTest()}
          disabled={test.state === "testing"}
          className="tv-btn-secondary inline-flex h-9 items-center gap-2 rounded-[9px] border px-4 text-[12.5px] font-bold transition-colors disabled:opacity-60 max-sm:min-h-10"
        >
          {test.state === "testing" ? <Loader2 className="size-4 animate-spin" /> : <PlugZap className="size-4" />}
          {t("settings.suppliers.test")}
        </button>
        {supplier.code === "tbo" ? (
          <Link
            href="/settings/suppliers/tbo"
            className="inline-flex h-9 items-center gap-2 rounded-[9px] border border-[#dbe6e1] bg-white px-4 text-[12.5px] font-bold text-[#185045] transition-colors hover:bg-[#f0f7f4]"
          >
            <Search className="size-4" />
            {t("settings.supplierTry.open")}
          </Link>
        ) : null}
        {saveState === "error" ? <span className="text-[12px] font-bold text-[#c22850]">{t("settings.suppliers.saveError")}</span> : null}
        {test.state === "done" ? (
          <span className={`inline-flex items-center gap-1.5 text-[12px] font-bold ${test.ok ? "text-[#0f7a52]" : "text-[#c22850]"}`}>
            {test.ok ? <CheckCircle2 className="size-4" /> : <XCircle className="size-4" />}
            {test.message}
          </span>
        ) : null}
      </div>
    </section>
  );
}
