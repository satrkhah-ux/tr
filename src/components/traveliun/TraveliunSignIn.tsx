"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { Loader2 } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { TraveliunLogo } from "./TraveliunLogo";
import { useTraveliunUI } from "./TraveliunUIProvider";

export function TraveliunSignIn() {
  const router = useRouter();
  const { t, dir } = useTraveliunUI();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;
    setError(null);

    if (!email.trim() || !password) {
      setError(t("err.enterCredentials"));
      return;
    }

    setLoading(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (signInError) {
        setError(
          signInError.message.toLowerCase().includes("invalid")
            ? t("err.loginInvalid")
            : t("err.loginFailed"),
        );
        return;
      }

      const params = new URLSearchParams(window.location.search);
      const redirect = params.get("redirect");
      const target = redirect && redirect.startsWith("/") ? redirect : "/dashboard";
      router.replace(target);
      router.refresh();
    } catch {
      setError(t("err.loginConnection"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="grid min-h-screen bg-white text-[#003c3a] lg:grid-cols-2" dir={dir}>
      <section className="flex min-h-screen items-center justify-center px-6 py-10">
        <div className="w-full max-w-[502px]">
          <div className="mb-8 flex justify-center">
            <TraveliunLogo />
          </div>
          <form
            onSubmit={submit}
            className="rounded-md bg-white px-[52px] py-[54px] shadow-[0_0_28px_rgba(0,0,0,0.06)]"
          >
            <label className="mb-7 block">
              <span className="mb-2 block text-[13px] font-medium text-[#003c3a]">
                <span className="text-[#ff3d65]">* </span>{t("auth.email")}
              </span>
              <input
                id="signInEmail"
                dir="ltr"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="h-[48px] w-full rounded-[8px] border border-[#ead8d2] px-4 text-start text-sm outline-none transition-colors focus:border-[#185045]"
                type="email"
                autoComplete="username"
                disabled={loading}
              />
            </label>
            <label className="mb-6 block">
              <span className="mb-2 block text-[13px] font-medium text-[#003c3a]">
                <span className="text-[#ff3d65]">* </span>{t("auth.password")}
              </span>
              <input
                id="signInPassword"
                dir="ltr"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="h-[48px] w-full rounded-[8px] border border-[#ead8d2] px-4 text-start text-sm outline-none transition-colors focus:border-[#185045]"
                type="password"
                autoComplete="current-password"
                disabled={loading}
              />
            </label>

            {error ? (
              <p
                role="alert"
                className="mb-5 rounded-[8px] border border-[#f4c9d4] bg-[#fdeef2] px-4 py-3 text-[13px] font-semibold text-[#c22850]"
              >
                {error}
              </p>
            ) : null}

            <button
              type="submit"
              disabled={loading}
              className="flex h-[50px] w-full items-center justify-center gap-2 rounded-[8px] bg-[#185045] text-[15px] font-semibold text-white transition-colors hover:bg-[#0f4439] disabled:cursor-not-allowed disabled:opacity-70"
            >
              {loading ? (
                <>
                  <Loader2 className="size-5 animate-spin" />
                  {t("auth.loggingIn")}
                </>
              ) : (
                t("auth.login")
              )}
            </button>
          </form>
        </div>
      </section>
      <section className="hidden min-h-screen bg-[url('/traveliun/auth-background.webp')] bg-cover bg-center lg:block" />
    </main>
  );
}
