"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, BadgeCheck, Loader2, XCircle } from "lucide-react";
import { DirText } from "@/components/DirText";
import type { TranslationKey } from "@/lib/i18n";
import {
  approveRegistration,
  rejectRegistration,
  type PendingRegistration,
  type TeamRole,
} from "@/lib/data/team";
import { isDeveloperRole } from "@/lib/roles/roles";
import { useRole } from "@/lib/roles/RoleContext";
import { useTraveliunUI } from "../TraveliunUIProvider";

/**
 * People who asked to join the staff, and the one place that decides.
 *
 * The section is chosen HERE and nowhere else — the public form has no field
 * for it — and has no default: «اعتماد» stays disabled until someone picks one,
 * so nobody is let in with whatever happened to be first in the list.
 */

const field =
  "h-9 w-full rounded-[9px] border border-[#dbe6e1] bg-white px-2.5 text-[12.5px] text-[#185045] outline-none focus:border-[#2aa87a]";

export function PendingEmployees({ pending, roles }: { pending: PendingRegistration[]; roles: TeamRole[] }) {
  const { t } = useTraveliunUI();
  // Survives the refresh that removes the row it is about.
  const [notice, setNotice] = useState<TranslationKey | null>(null);
  if (pending.length === 0 && !notice) return null;

  return (
    <section className="rounded-2xl border border-[#f2e2b4] bg-[#fffdf7] p-5">
      <h2 className="text-sm font-extrabold text-[#a86a10]">{t("team.pending.title", { n: pending.length })}</h2>
      <p className="mb-3 mt-1 text-[11.5px] font-semibold text-tv-text-faint">{t("team.pending.hint")}</p>
      {notice ? <p className="mb-2 text-[12px] font-bold text-[#0f7a52]">{t(notice)}</p> : null}
      <div className="space-y-2.5">
        {pending.map((r) => (
          <PendingRow key={r.id} request={r} roles={roles} onDone={setNotice} />
        ))}
      </div>
    </section>
  );
}

function PendingRow({
  request,
  roles,
  onDone,
}: {
  request: PendingRegistration;
  roles: TeamRole[];
  onDone: (notice: TranslationKey) => void;
}) {
  const { t, language } = useTraveliunUI();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [roleId, setRoleId] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<TranslationKey | null>(null);

  const role = roles.find((r) => r.id === roleId);
  // Only the developer lets someone into the developer's section (team.ts refuses it too).
  const { isDeveloper } = useRole();
  const date = new Intl.DateTimeFormat(language === "ar" ? "ar-SA" : "en-GB", { dateStyle: "medium" }).format(
    new Date(request.created_at),
  );

  function run(action: () => Promise<{ ok: true } | { ok: false; error: TranslationKey }>, done: TranslationKey) {
    setError(null);
    startTransition(async () => {
      const res = await action();
      if (!res.ok) {
        setError(res.error);
        // Someone else decided it meanwhile — the row is stale either way.
        if (res.error === "team.pending.handled") router.refresh();
        return;
      }
      onDone(done);
      router.refresh();
    });
  }

  return (
    <div className="rounded-[12px] border border-[#e2ebe7] bg-white p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13px] font-extrabold text-[#003c3a]">
            {request.arabic_name}
            {request.english_name ? (
              <span className="ms-2 text-[11.5px] font-bold text-tv-text-faint">
                <DirText dir="ltr">{request.english_name}</DirText>
              </span>
            ) : null}
          </p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11.5px] font-bold text-[#557d78]">
            <DirText dir="ltr">{request.email}</DirText>
            <DirText dir="ltr">{request.mobile}</DirText>
            <span className="text-tv-text-faint">{date}</span>
          </p>
          {request.note ? <p className="mt-1 text-[11.5px] text-tv-text-faint">{request.note}</p> : null}
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <label className="grid gap-1 text-[11px] font-bold text-[#185045]">
            {t("team.pending.role")}
            <select value={roleId} onChange={(e) => setRoleId(e.target.value)} className={`${field} min-w-40`}>
              <option value="" disabled>
                {t("team.pending.pickRole")}
              </option>
              {roles.map((r) => (
                <option key={r.id} value={r.id} disabled={!isDeveloper && isDeveloperRole(r.permission_keys)}>
                  {r.arabic_name}
                </option>
              ))}
            </select>
          </label>

          <button
            type="button"
            disabled={pending || !roleId}
            onClick={() => run(() => approveRegistration(request.id, roleId), "team.pending.approved")}
            className="inline-flex h-9 items-center gap-1.5 rounded-[9px] bg-[#185045] px-3 text-[12px] font-bold text-white hover:bg-[#0f4439] disabled:opacity-60"
          >
            {pending ? <Loader2 className="size-3.5 animate-spin" /> : <BadgeCheck className="size-3.5" />}
            {t("team.pending.approve")}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => setRejecting((v) => !v)}
            className="inline-flex h-9 items-center gap-1.5 rounded-[9px] border border-[#f2c7c7] px-3 text-[12px] font-bold text-[#c43d3d] hover:bg-[#fff1f1] disabled:opacity-60"
          >
            <XCircle className="size-3.5" />
            {t("team.pending.reject")}
          </button>
        </div>
      </div>

      {/* Approving anyone but the administration section opens cost data at the
          API level until the cost-data lockdown ships (Gate B). The owner wants
          that said at the moment of the decision, not discovered later. */}
      {role && !role.permission_keys.includes("dashboard.admin") ? (
        <p className="mt-2 flex items-start gap-1.5 rounded-[9px] border border-[#f2e2b4] bg-[#fff8e6] px-2.5 py-2 text-[11.5px] font-bold text-[#a86a10]">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          {t("team.pending.costWarning")}
        </p>
      ) : null}

      {rejecting ? (
        <div className="mt-2 flex flex-wrap items-end gap-2 rounded-[10px] border border-[#f2c7c7] bg-[#fdf6f7] p-2.5">
          <label className="grid flex-1 gap-1 text-[11px] font-bold text-[#185045]">
            {t("team.pending.reason")}
            <input value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} className={field} />
          </label>
          <button
            type="button"
            disabled={pending || reason.trim().length < 3}
            onClick={() => run(() => rejectRegistration(request.id, reason), "team.pending.rejected")}
            className="inline-flex h-9 items-center gap-1.5 rounded-[9px] bg-[#c43d3d] px-3 text-[12px] font-bold text-white hover:bg-[#a83232] disabled:opacity-60"
          >
            {pending ? <Loader2 className="size-3.5 animate-spin" /> : <XCircle className="size-3.5" />}
            {t("team.pending.confirmReject")}
          </button>
          <p className="w-full text-[11px] font-bold text-[#a86a10]">{t("team.pending.rejectNote")}</p>
        </div>
      ) : null}

      {error ? <p className="mt-1 text-[11.5px] font-bold text-[#c22850]">{t(error)}</p> : null}
    </div>
  );
}
