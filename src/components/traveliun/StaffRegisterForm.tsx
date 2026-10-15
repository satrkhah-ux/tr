"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import type { TranslationKey } from "@/lib/i18n";
import { registerEmployee } from "@/lib/data/staff-registration";
import { TraveliunLogo } from "./TraveliunLogo";
import { useTraveliunUI } from "./TraveliunUIProvider";

/**
 * «تسجيل موظف جديد» — the sign-in page's sibling, same frame.
 *
 * No section field, on purpose: what a colleague may do is decided by whoever
 * approves them, never by the person asking. No password either: approval
 * sends an invitation to the address, and whoever owns that mailbox sets one —
 * so nobody can claim a new hire's email by registering it first.
 */

const field =
  "h-[46px] w-full rounded-[8px] border border-[#ead8d2] px-4 text-sm outline-none transition-colors focus:border-[#185045]";
const label = "block text-[13px] font-medium text-[#003c3a]";

type Form = {
  arabic_name: string;
  english_name: string;
  email: string;
  mobile: string;
  note: string;
  website: string;
};

export function StaffRegisterForm() {
  const { t, dir } = useTraveliunUI();
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState(false);
  const [error, setError] = useState<TranslationKey | null>(null);
  const [form, setForm] = useState<Form>({
    arabic_name: "",
    english_name: "",
    email: "",
    mobile: "",
    note: "",
    website: "",
  });

  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <main className="grid min-h-screen bg-white text-[#003c3a] lg:grid-cols-2" dir={dir}>
      <section className="flex min-h-screen items-center justify-center px-4 py-10 sm:px-6">
        <div className="w-full max-w-[502px]">
          <div className="mb-6 flex justify-center">
            <TraveliunLogo />
          </div>

          {done ? (
            <div className="rounded-md bg-white px-6 py-10 text-center shadow-[0_0_28px_rgba(0,0,0,0.06)] sm:px-[52px]">
              <CheckCircle2 className="mx-auto size-10 text-[#0f7a52]" />
              <h1 className="mt-3 text-lg font-extrabold">{t("reg.doneTitle")}</h1>
              <p className="mt-2 text-[13px] font-semibold leading-6 text-[#557d78]">{t("reg.done")}</p>
            </div>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setError(null);
                startTransition(async () => {
                  const res = await registerEmployee(form);
                  if (res.ok) setDone(true);
                  else setError(res.error);
                });
              }}
              className="grid gap-4 rounded-md bg-white px-6 py-8 shadow-[0_0_28px_rgba(0,0,0,0.06)] sm:px-[52px] sm:py-[44px]"
            >
              <header>
                <h1 className="text-lg font-extrabold">{t("reg.title")}</h1>
                <p className="mt-1 text-[12.5px] font-semibold leading-6 text-[#557d78]">{t("reg.subtitle")}</p>
              </header>

              <label className={label}>
                <span className="mb-2 block"><span className="text-[#ff3d65]">* </span>{t("reg.arabicName")}</span>
                <input required minLength={3} maxLength={80} value={form.arabic_name} onChange={set("arabic_name")} className={field} />
              </label>
              <label className={label}>
                <span className="mb-2 block">{t("reg.englishName")}</span>
                <input dir="ltr" maxLength={80} value={form.english_name} onChange={set("english_name")} className={`${field} text-start`} />
              </label>
              <label className={label}>
                <span className="mb-2 block"><span className="text-[#ff3d65]">* </span>{t("reg.email")}</span>
                <input required type="email" dir="ltr" autoComplete="email" value={form.email} onChange={set("email")} className={`${field} text-start`} />
              </label>
              <label className={label}>
                <span className="mb-2 block"><span className="text-[#ff3d65]">* </span>{t("reg.mobile")}</span>
                <input required type="tel" dir="ltr" autoComplete="tel" value={form.mobile} onChange={set("mobile")} className={`${field} text-start`} />
              </label>
              <label className={label}>
                <span className="mb-2 block">{t("reg.note")}</span>
                <textarea
                  rows={3}
                  maxLength={500}
                  value={form.note}
                  onChange={set("note")}
                  className="w-full rounded-[8px] border border-[#ead8d2] p-3 text-sm outline-none transition-colors focus:border-[#185045]"
                />
              </label>

              {/* Honeypot: invisible to people and to screen readers, irresistible
                  to form-filling bots. Anything in it ends the request quietly. */}
              <input
                type="text"
                name="website"
                tabIndex={-1}
                autoComplete="off"
                aria-hidden="true"
                value={form.website}
                onChange={set("website")}
                className="absolute -start-[9999px] size-px opacity-0"
              />

              {error ? (
                <p role="alert" className="rounded-[8px] border border-[#f4c9d4] bg-[#fdeef2] px-4 py-3 text-[13px] font-semibold text-[#c22850]">
                  {t(error)}
                </p>
              ) : null}

              <button
                type="submit"
                disabled={pending}
                className="flex h-[50px] w-full items-center justify-center gap-2 rounded-[8px] bg-[#185045] text-[15px] font-semibold text-white transition-colors hover:bg-[#0f4439] disabled:cursor-not-allowed disabled:opacity-70"
              >
                {pending ? <Loader2 className="size-5 animate-spin" /> : null}
                {t("reg.submit")}
              </button>
            </form>
          )}

          <p className="mt-6 text-center text-[13px] font-semibold">
            <Link href="/sign-in" className="text-[#185045] underline-offset-4 hover:underline">
              {t("reg.backToLogin")}
            </Link>
          </p>
        </div>
      </section>
      <section className="hidden min-h-screen bg-[url('/traveliun/auth-background.webp')] bg-cover bg-center lg:block" />
    </main>
  );
}
