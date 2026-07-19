"use client";

import Script from "next/script";
import { useCallback, useState } from "react";
import { CheckCircle2, Link2, Loader2, LogIn, Send } from "lucide-react";
import { linkTelegramAccount, telegramSignIn } from "@/lib/data/telegram-app-actions";
import { useTraveliunUI } from "./TraveliunUIProvider";

/**
 * Telegram Mini App entry (/tg): reads the signed initData Telegram injects
 * into the webview, then —
 *   1) tries the auto sign-in (linked employees land straight on /dashboard);
 *   2) if the Telegram account isn't linked yet but a session cookie exists,
 *      links it silently and proceeds;
 *   3) otherwise asks for ONE normal login (redirected back here to finish).
 * Outside Telegram it degrades to a simple "open the system" card.
 */

type TgWebApp = { initData?: string; expand?: () => void; ready?: () => void };

function getWebApp(): TgWebApp | null {
  const w = window as unknown as { Telegram?: { WebApp?: TgWebApp } };
  return w.Telegram?.WebApp ?? null;
}

type Phase = "boot" | "connecting" | "login_needed" | "not_telegram" | "error";

export function TgEntry() {
  const { t } = useTraveliunUI();
  const [phase, setPhase] = useState<Phase>("boot");
  const [errorKey, setErrorKey] = useState<"tg.errInvalid" | "tg.errNoAuth" | "tg.errUnconfigured" | "tg.errFailed" | "tg.errTaken" | "tg.errNoEmployee">("tg.errFailed");

  const start = useCallback(async () => {
    const tg = getWebApp();
    tg?.ready?.();
    tg?.expand?.();
    const initData = tg?.initData ?? "";
    if (!initData) {
      setPhase("not_telegram");
      return;
    }
    setPhase("connecting");

    const auth = await telegramSignIn(initData);
    if (auth.ok) {
      window.location.replace("/dashboard");
      return;
    }
    if (auth.code === "unconfigured") { setErrorKey("tg.errUnconfigured"); setPhase("error"); return; }
    if (auth.code === "invalid") { setErrorKey("tg.errInvalid"); setPhase("error"); return; }
    if (auth.code === "no_auth_account") { setErrorKey("tg.errNoAuth"); setPhase("error"); return; }

    // not_linked → link silently when a session cookie already exists.
    if (auth.code === "not_linked") {
      const link = await linkTelegramAccount(initData);
      if (link.ok) {
        window.location.replace("/dashboard");
        return;
      }
      if (link.code === "session") { setPhase("login_needed"); return; }
      if (link.code === "taken") { setErrorKey("tg.errTaken"); setPhase("error"); return; }
      if (link.code === "no_employee") { setErrorKey("tg.errNoEmployee"); setPhase("error"); return; }
      setErrorKey("tg.errFailed"); setPhase("error"); return;
    }

    setErrorKey("tg.errFailed");
    setPhase("error");
  }, []);

  return (
    <main dir="rtl" className="flex min-h-dvh items-center justify-center bg-[#eef3f1] p-6 font-sans text-[#0f3d38]">
      <Script src="https://telegram.org/js/telegram-web-app.js" strategy="afterInteractive" onReady={() => void start()} onError={() => void start()} />
      <div className="w-full max-w-[380px] rounded-2xl border border-[#e2ebe7] bg-white p-6 text-center shadow-[0_8px_30px_rgba(0,60,58,0.08)]">
        <span className="mx-auto mb-4 flex size-14 items-center justify-center rounded-2xl bg-[#185045] text-white">
          <Send className="size-6" />
        </span>
        <h1 className="text-lg font-extrabold text-[#003c3a]">{t("tg.title")}</h1>

        {phase === "boot" || phase === "connecting" ? (
          <p className="mt-3 inline-flex items-center gap-2 text-sm font-bold text-[#557d78]">
            <Loader2 className="size-4 animate-spin" /> {t("tg.connecting")}
          </p>
        ) : null}

        {phase === "login_needed" ? (
          <>
            <p className="mt-3 flex items-center justify-center gap-2 text-sm font-bold text-[#557d78]">
              <Link2 className="size-4" /> {t("tg.linkPrompt")}
            </p>
            <a
              href="/sign-in?redirect=/tg"
              className="mt-4 inline-flex h-11 w-full items-center justify-center gap-2 rounded-[11px] bg-[#185045] text-sm font-bold text-white hover:bg-[#0f4439]"
            >
              <LogIn className="size-4" /> {t("tg.linkButton")}
            </a>
            <p className="mt-2 text-[11.5px] font-semibold text-[#93aaa3]">{t("tg.linkOnce")}</p>
          </>
        ) : null}

        {phase === "not_telegram" ? (
          <>
            <p className="mt-3 text-sm font-bold text-[#557d78]">{t("tg.notInTelegram")}</p>
            <a
              href="/dashboard"
              className="mt-4 inline-flex h-11 w-full items-center justify-center gap-2 rounded-[11px] bg-[#185045] text-sm font-bold text-white hover:bg-[#0f4439]"
            >
              <CheckCircle2 className="size-4" /> {t("tg.openSystem")}
            </a>
          </>
        ) : null}

        {phase === "error" ? (
          <>
            <p className="mt-3 rounded-[10px] border border-[#f4c9d4] bg-[#fdeef2] px-3 py-2 text-[13px] font-bold text-[#c22850]">
              {t(errorKey)}
            </p>
            <button
              type="button"
              onClick={() => void start()}
              className="mt-3 inline-flex h-10 items-center justify-center rounded-[10px] border border-[#dbe6e1] px-4 text-sm font-bold text-[#185045] hover:bg-[#f4f8f6]"
            >
              {t("exec.retry")}
            </button>
          </>
        ) : null}
      </div>
    </main>
  );
}
