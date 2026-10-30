"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Copy, Loader2, Mail, MessageCircle, Send, Truck, UserPlus } from "lucide-react";
import type { TranslationKey } from "@/lib/i18n";
import {
  prepareSupplierOrder,
  saveSupplierContact,
  sendSupplierOrder,
  type OrderError,
  type SupplierOrderDraft,
} from "@/lib/data/repackage-order";
import { useTraveliunUI } from "../TraveliunUIProvider";
import { addButtonClass, fieldClass, labelClass, sectionClass } from "./stage-props";

const ERROR_KEY: Record<OrderError, TranslationKey> = {
  session: "rp.order.err.session",
  forbidden: "rp.order.err.forbidden",
  notFound: "rp.order.err.failed",
  notIssued: "rp.order.err.failed",
  partner: "rp.order.err.failed",
  cancelled: "rp.confirm.cancelled",
  inOperations: "rp.order.err.failed",
  already: "rp.order.err.failed",
  empty: "rp.order.err.empty",
  failed: "rp.order.err.failed",
  notConfirmed: "rp.order.err.notConfirmed",
  noCost: "rp.order.err.noCost",
};

/**
 * «طلب المورّد» — ONE message for the supplier once the client confirmed: every
 * detail it needs and what we pay it (never the client's price or our profit),
 * PREPARED here and sent only from a button, through the case's own channel
 * (logged on the case). A supplier with no saved contact gets the message to
 * copy, and the contact form once — typed or chosen, kept on the supplier.
 */
export function SupplierOrderPanel({ draftId }: { draftId: string }) {
  const { t, language } = useTraveliunUI();
  const [draft, setDraft] = useState<SupplierOrderDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState<"whatsapp" | "manual" | "contact" | null>(null);
  const [done, setDone] = useState(false);
  const [copied, setCopied] = useState(false);
  const [contact, setContact] = useState({ supplier_id: "", contact_name: "", phone: "", email: "", lang: "ar" as "ar" | "en" });

  const load = useCallback(async () => {
    const res = await prepareSupplierOrder(draftId);
    if (!res.ok) {
      setError(t(ERROR_KEY[res.error]));
      return;
    }
    setError(null);
    setDraft(res);
    setBody(res.body);
  }, [draftId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function send(channel: "whatsapp" | "manual") {
    if (!draft || busy) return;
    // a second send of the same order is asked about, never silent
    if (draft.sentAt && !window.confirm(t("rp.order.sentBefore", { date: draft.sentAt.slice(0, 10) }))) return;
    setBusy(channel);
    setError(null);
    try {
      const res = await sendSupplierOrder(draftId, { channel, to_label: draft.to_label, to_phone: draft.to_phone, body });
      if (!res.ok) return setError(t(ERROR_KEY[res.error]));
      setDone(true);
      await load();
    } catch {
      setError(t("rp.order.err.failed"));
    } finally {
      setBusy(null);
    }
  }

  async function saveContact() {
    if (busy) return;
    setBusy("contact");
    setError(null);
    try {
      const res = await saveSupplierContact(draftId, { ...contact, supplier_id: contact.supplier_id || null });
      if (!res.ok) return setError(t(ERROR_KEY[res.error]));
      await load();
    } catch {
      setError(t("rp.order.err.failed"));
    } finally {
      setBusy(null);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(body);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* the text is selectable in the box */
    }
  }

  const mailto = draft?.to_email ? `mailto:${draft.to_email}?subject=${encodeURIComponent(draft.subject)}&body=${encodeURIComponent(body)}` : null;

  return (
    <section className={sectionClass}>
      <h3 className="flex items-center gap-2 text-[14px] font-extrabold text-[#0f3d38]">
        <Truck className="size-4 text-[#185045]" />
        {t("rp.order.title")}
      </h3>
      <p className="mb-3 mt-0.5 text-[12px] font-semibold text-[#557d78]">{t("rp.order.hint")}</p>

      {error ? <p role="alert" className="mb-2 rounded-[10px] border border-[#f4c9d4] bg-[#fdeef2] px-3 py-2 text-[12.5px] font-bold text-[#c22850]">{error}</p> : null}
      {!draft && !error ? (
        <p className="flex items-center gap-2 text-[12.5px] text-[#557d78]"><Loader2 className="size-4 animate-spin" />{t("rp.order.loading")}</p>
      ) : null}

      {draft ? (
        <div className="space-y-3">
          <p className="text-[12.5px] font-bold text-[#185045]">
            {t("rp.order.supplier")}: <span className="text-[#0f3d38]">{draft.to_label}</span>{" "}
            <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-extrabold ${draft.supplier.registered ? "bg-[#e9f7f0] text-[#0f7a52]" : "bg-[#fff8e8] text-[#a86a10]"}`}>
              {draft.supplier.registered ? t("rp.order.registered") : t("rp.order.unregistered")}
            </span>
          </p>

          {/* no contact on the supplier: said plainly, then typed or chosen ONCE and kept on it */}
          {!draft.supplier.reachable ? (
            <div className="rounded-[12px] border border-[#f2e2b4] bg-[#fff8e8] p-3">
              <p className="text-[12.5px] font-bold text-[#a86a10]">{draft.supplier.registered ? t("rp.order.noContact") : t("rp.order.notRegisteredNote")}</p>
              <div className="mt-2 grid gap-2 md:grid-cols-2">
                {draft.choices.length > 0 ? (
                  <label className={`${labelClass} md:col-span-2`}>
                    {t("rp.order.pick")}
                    <select className={fieldClass} value={contact.supplier_id} onChange={(e) => setContact({ ...contact, supplier_id: e.target.value })}>
                      <option value="">—</option>
                      {draft.choices.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  </label>
                ) : null}
                <label className={labelClass}>
                  {t("rp.order.contactName")}
                  <input className={fieldClass} value={contact.contact_name} onChange={(e) => setContact({ ...contact, contact_name: e.target.value })} />
                </label>
                <label className={labelClass}>
                  {t("rp.order.phone")}
                  <input dir="ltr" inputMode="tel" className={`${fieldClass} tv-tnum text-start`} value={contact.phone} onChange={(e) => setContact({ ...contact, phone: e.target.value })} />
                </label>
                <label className={labelClass}>
                  {t("rp.order.email")}
                  <input dir="ltr" type="email" className={`${fieldClass} text-start`} value={contact.email} onChange={(e) => setContact({ ...contact, email: e.target.value })} />
                </label>
                <label className={labelClass}>
                  {t("rp.order.lang")}
                  <select className={fieldClass} value={contact.lang} onChange={(e) => setContact({ ...contact, lang: e.target.value === "en" ? "en" : "ar" })}>
                    <option value="ar">{language === "ar" ? "العربية" : "Arabic"}</option>
                    <option value="en">{language === "ar" ? "الإنجليزية" : "English"}</option>
                  </select>
                </label>
              </div>
              <button
                type="button"
                onClick={() => void saveContact()}
                disabled={busy !== null || (!contact.supplier_id && !contact.phone.trim() && !contact.email.trim())}
                className={`${addButtonClass} mt-2 disabled:opacity-50`}
              >
                {busy === "contact" ? <Loader2 className="size-4 animate-spin" /> : <UserPlus className="size-4" />}
                {t("rp.order.saveContact")}
              </button>
            </div>
          ) : null}

          <label className={labelClass}>
            {t("rp.order.body")}
            <textarea dir="auto" rows={16} value={body} onChange={(e) => setBody(e.target.value)} className="tv-field block w-full rounded-[10px] border px-3 py-2.5 text-[13px] leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-tv-action-focus" />
          </label>

          {draft.sentAt ? <p className="text-[12px] font-bold text-[#0f7a52]">{t("rp.order.sentOn", { date: draft.sentAt.slice(0, 10) })}</p> : null}
          {done ? <p role="status" className="text-[12.5px] font-extrabold text-[#0f7a52]">{t("rp.order.sent")}</p> : null}

          <div className="flex flex-wrap items-center gap-2">
            {draft.canSendWhatsapp ? (
              <button
                type="button"
                onClick={() => void send("whatsapp")}
                disabled={busy !== null || !body.trim()}
                className="tv-btn-primary inline-flex h-10 items-center gap-2 rounded-[10px] px-4 text-[13px] font-bold disabled:opacity-60"
              >
                {busy === "whatsapp" ? <Loader2 className="size-4 animate-spin" /> : <MessageCircle className="size-4" />}
                {busy === "whatsapp" ? t("rp.order.sending") : t("rp.order.sendWhatsapp")}
              </button>
            ) : null}
            <button type="button" onClick={() => void copy()} className="tv-btn-secondary inline-flex h-10 items-center gap-2 rounded-[10px] border px-4 text-[13px] font-bold">
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
              {copied ? t("rp.order.copied") : t("rp.order.copy")}
            </button>
            {mailto ? (
              <a href={mailto} className="inline-flex h-10 items-center gap-2 rounded-[10px] border border-[#dbe6e1] bg-white px-4 text-[13px] font-bold text-[#185045] hover:bg-[#f4f8f6]">
                <Mail className="size-4" />
                {t("rp.order.mail")}
              </a>
            ) : null}
            <button
              type="button"
              onClick={() => void send("manual")}
              disabled={busy !== null || !body.trim()}
              className="tv-btn-secondary inline-flex h-10 items-center gap-2 rounded-[10px] border px-4 text-[13px] font-bold disabled:opacity-60"
            >
              {busy === "manual" ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              {t("rp.order.manual")}
            </button>
          </div>
          {!draft.canSendWhatsapp ? <p className="text-[11.5px] font-semibold text-tv-text-faint">{t("rp.order.noWhatsapp")}</p> : null}
        </div>
      ) : null}
    </section>
  );
}
