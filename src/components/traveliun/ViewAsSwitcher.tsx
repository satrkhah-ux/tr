"use client";

import { useEffect, useState, useTransition } from "react";
import { Eye, Loader2 } from "lucide-react";
import { listSwitchableRoles, setViewAsRole } from "@/lib/data/account-actions";
import { useRole } from "@/lib/roles/RoleContext";
import { useTraveliunUI } from "./TraveliunUIProvider";

/**
 * «عرض النظام كـ» — the administration and the developer look at the system as
 * another role sees it (roles.ts viewAsPermissions: it only narrows). The choice
 * is an httpOnly cookie the server reads on every request, so after switching
 * the page is loaded afresh: menus, gates and server-rendered screens all
 * re-read it. /dashboard because the current screen may not exist for that role.
 */
function useSwitch() {
  const [pending, startTransition] = useTransition();
  const go = (roleId: string | null) =>
    startTransition(async () => {
      const res = await setViewAsRole(roleId);
      if (res.ok) window.location.assign("/dashboard");
    });
  return { pending, go };
}

/** The selector inside the account menu — only for an account whose OWN role may switch. */
export function ViewAsSwitcher() {
  const { t } = useTraveliunUI();
  const { canSwitch, viewAs } = useRole();
  const [roles, setRoles] = useState<{ id: string; name: string }[] | null>(null);
  const { pending, go } = useSwitch();

  useEffect(() => {
    if (!canSwitch) return;
    let active = true;
    listSwitchableRoles()
      .then((rows) => active && setRoles(rows))
      .catch(() => active && setRoles([]));
    return () => {
      active = false;
    };
  }, [canSwitch]);

  if (!canSwitch) return null;

  const current = viewAs?.roleId ?? "";
  return (
    <label className="mb-3 grid gap-1.5 text-[11.5px] font-bold text-[#557d78] dark:text-[#9fb3ac]">
      <span className="flex items-center gap-1.5">
        <Eye className="size-3.5" />
        {t("viewAs.label")}
        {pending ? <Loader2 className="size-3.5 animate-spin" /> : null}
      </span>
      <select
        value={current}
        disabled={pending || roles === null}
        onChange={(e) => go(e.target.value || null)}
        className="h-10 rounded-md border border-[#dfe8e4] bg-white px-2 text-sm font-semibold text-[var(--tv-brand)] outline-none focus-visible:ring-2 focus-visible:ring-tv-action-focus focus:border-[#2aa87a] disabled:opacity-60 dark:border-[#294039] dark:bg-[#14231f] dark:text-[#d6e5df]"
      >
        <option value="">{t("viewAs.mine")}</option>
        {/* the role being viewed stays listed even if it vanished from the list since */}
        {viewAs && !roles?.some((r) => r.id === viewAs.roleId) ? <option value={viewAs.roleId}>{viewAs.name}</option> : null}
        {(roles ?? []).map((r) => (
          <option key={r.id} value={r.id}>
            {r.name}
          </option>
        ))}
      </select>
    </label>
  );
}

/** The slim strip on every shell page while looking through another role — one click back. */
export function ViewAsBanner() {
  const { t } = useTraveliunUI();
  const { viewAs } = useRole();
  const { pending, go } = useSwitch();
  if (!viewAs) return null;
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-[10px] border border-[#f2c94c] bg-[#fff8e8] px-3 py-1.5 text-[#8a6a00]">
      <span className="flex items-center gap-1.5 text-[12.5px] font-bold">
        <Eye className="size-4" />
        {t("viewAs.banner", { role: viewAs.name })}
      </span>
      <button
        type="button"
        disabled={pending}
        onClick={() => go(null)}
        className="inline-flex h-8 items-center gap-1.5 rounded-md bg-[#8a6a00] px-3 text-xs font-bold text-white hover:bg-[#6f5500] disabled:opacity-60"
      >
        {pending ? <Loader2 className="size-3.5 animate-spin" /> : null}
        {t("viewAs.back")}
      </button>
    </div>
  );
}
