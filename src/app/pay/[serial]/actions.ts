"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { startPayNow } from "@/lib/payments/pay-now";

/** «ادفع الآن» on /pay/<serial>: to MyFatoorah or Tamara, or back to the page with the reason. */
export async function payNow(form: FormData): Promise<void> {
  const serial = String(form.get("serial") ?? "");
  const token = form.get("a") ? String(form.get("a")) : undefined;
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip")?.trim() || "?";
  const tamara = form.get("m") === "tamara";
  const res = await startPayNow(serial, token, ip, tamara ? "tamara" : "myfatoorah");
  if (res.ok) redirect(res.url);
  const back = new URLSearchParams({ e: res.why, ...(token ? { a: token } : {}), ...(tamara ? { m: "tamara" } : {}) });
  redirect(`/pay/${encodeURIComponent(serial)}?${back}`);
}
