"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { Loader2, X } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { clearMustChangePassword } from "@/lib/data/account-actions";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { useTraveliunUI } from "./TraveliunUIProvider";

/**
 * «تغيير كلمة المرور» — from the account menu, or FORCED: the root layout
 * renders it with `forced` while the session user's app_metadata carries
 * must_change_password (a new account handed over with a temporary password).
 * Forced, it cannot be closed — no ✕, no cancel, no Escape or outside click —
 * and, being modal, leaves the app behind it inert until the change is made.
 */
export function ChangePasswordDialog({
  open = false,
  onOpenChange,
  forced = false,
}: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  forced?: boolean;
}) {
  const { t } = useTraveliunUI();
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const isOpen = forced || open;
  const close = () => {
    // The layout drops the forced dialog once the flag is cleared — a refresh re-reads it.
    if (forced) router.refresh();
    else onOpenChange?.(false);
  };

  // Reset the form whenever the dialog is closed so it opens clean next time.
  useEffect(() => {
    if (!isOpen) {
      setPassword("");
      setConfirm("");
      setError(null);
      setDone(false);
      setLoading(false);
    }
  }, [isOpen]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;
    setError(null);

    if (password.length < 6) {
      setError(t("pwd.tooShort"));
      return;
    }
    if (password !== confirm) {
      setError(t("pwd.mismatch"));
      return;
    }

    setLoading(true);
    try {
      const { error: updateError } = await createSupabaseBrowserClient().auth.updateUser({ password });
      if (updateError) {
        setError(t("pwd.failed"));
        return;
      }
      // The flag is the server's to clear (app_metadata is not user-writable);
      // a no-op for an account without it.
      const cleared = await clearMustChangePassword();
      if (forced && !cleared.ok) {
        setError(t("pwd.failed"));
        return;
      }
      setDone(true);
    } catch {
      setError(t("pwd.connection"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(next) => {
        if (!forced) onOpenChange?.(next);
      }}
      disablePointerDismissal={forced}
    >
      <DialogContent className="max-w-[440px]" showClose={false}>
        <form onSubmit={submit}>
        <div className="mb-5 flex items-center justify-between border-b border-[#e1e9e5] pb-4 dark:border-[#294039]">
          <h2 className="text-lg font-extrabold">{t("pwd.title")}</h2>
          {forced ? null : (
            <button type="button" onClick={close} className="rounded-md p-2 text-[#557d78] hover:bg-[#edf3f0] dark:hover:bg-[#1b2d27]" aria-label={t("close")}>
              <X className="size-5" />
            </button>
          )}
        </div>

        {forced && !done ? (
          <p className="mb-4 rounded-[10px] border border-[#f2e2b4] bg-[#fffdf5] px-4 py-3 text-[13px] font-bold text-[#a86a10]">
            {t("pwd.forced")}
          </p>
        ) : null}

        {done ? (
          <div className="space-y-4 text-center">
            <p className="rounded-[10px] border border-[#bfe5d4] bg-[#e9f7f0] px-4 py-3 text-sm font-bold text-[#0f7a52]">
              {t("pwd.success")}
            </p>
            <button
              type="button"
              onClick={close}
              className="h-11 w-full rounded-[10px] bg-[var(--tv-brand)] text-sm font-bold text-white transition-colors hover:bg-[#0f4439]"
            >
              {t("done")}
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <label className="grid gap-2 text-[13px] font-bold">
              {t("pwd.new")}
              <input
                type="password"
                dir="ltr"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                disabled={loading}
                autoComplete="new-password"
                className="h-11 rounded-[10px] border border-[#d9e3df] bg-white px-3 text-start text-sm font-normal outline-none transition-colors focus:border-[#2aa87a]"
              />
            </label>
            <label className="grid gap-2 text-[13px] font-bold">
              {t("pwd.confirm")}
              <input
                type="password"
                dir="ltr"
                value={confirm}
                onChange={(event) => setConfirm(event.target.value)}
                disabled={loading}
                autoComplete="new-password"
                className="h-11 rounded-[10px] border border-[#d9e3df] bg-white px-3 text-start text-sm font-normal outline-none transition-colors focus:border-[#2aa87a]"
              />
            </label>

            {error ? (
              <p role="alert" className="rounded-[10px] border border-[#f4c9d4] bg-[#fdeef2] px-4 py-2.5 text-[13px] font-semibold text-[#c22850]">
                {error}
              </p>
            ) : null}

            <div className="flex justify-end gap-2 pt-1">
              {forced ? (
                // The only way out of a forced change: if Supabase refuses it
                // (an old session needing re-authentication), sign out and in again.
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await createSupabaseBrowserClient().auth.signOut();
                    } catch {
                      /* leave regardless */
                    }
                    window.location.assign("/sign-in");
                  }}
                  className="h-11 rounded-[10px] border border-[#d8e3de] px-5 text-sm font-bold text-[var(--tv-brand)] transition-colors hover:bg-[#f4f8f6]"
                >
                  {t("signOut")}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={close}
                  className="h-11 rounded-[10px] border border-[#d8e3de] px-5 text-sm font-bold text-[var(--tv-brand)] transition-colors hover:bg-[#f4f8f6]"
                >
                  {t("cancel")}
                </button>
              )}
              <button
                type="submit"
                disabled={loading}
                className="flex h-11 items-center justify-center gap-2 rounded-[10px] bg-[var(--tv-brand)] px-6 text-sm font-bold text-white transition-colors hover:bg-[#0f4439] disabled:opacity-70"
              >
                {loading ? <Loader2 className="size-4 animate-spin" /> : null}
                {loading ? t("saving") : t("save")}
              </button>
            </div>
          </div>
        )}
        </form>
      </DialogContent>
    </Dialog>
  );
}
