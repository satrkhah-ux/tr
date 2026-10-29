"use client";

import { cleanErrorMessage, cleanRoute, type ErrorReport } from "@/lib/secretary/error-core";

/**
 * «أرسل الخطأ لمُراد» from anywhere in the browser: مُراد's floating panel
 * takes it when it is on the page (SecretaryFab cancels the event); otherwise
 * (an error page outside the shell) it waits in this tab's sessionStorage and
 * /secretary picks it up. Cleaned here AND on the server.
 */
export const MURAD_ERROR_EVENT = "murad:error";
const PENDING_KEY = "murad:pending-error";

export function errorReportFrom(message: string, action?: string | null): ErrorReport {
  return { message: cleanErrorMessage(message), route: cleanRoute(window.location.pathname), action: action ?? null, at: new Date().toISOString() };
}

export function sendErrorToMurad(report: ErrorReport): void {
  const taken = !window.dispatchEvent(new CustomEvent(MURAD_ERROR_EVENT, { detail: report, cancelable: true }));
  if (taken) return;
  try {
    sessionStorage.setItem(PENDING_KEY, JSON.stringify(report));
  } catch { /* storage blocked: /secretary simply opens empty */ }
  window.location.assign("/secretary");
}

/** the error left for /secretary, once */
export function takePendingError(): ErrorReport | null {
  try {
    const raw = sessionStorage.getItem(PENDING_KEY);
    sessionStorage.removeItem(PENDING_KEY);
    return raw ? (JSON.parse(raw) as ErrorReport) : null;
  } catch {
    return null;
  }
}
