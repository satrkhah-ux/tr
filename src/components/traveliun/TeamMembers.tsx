"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Check, KeyRound, Loader2, Pencil, Plus, Search, ShieldCheck, UserPlus, X } from "lucide-react";
import { DirText } from "@/components/DirText";
import { EmptyState } from "@/components/ui/EmptyState";
import { saveMember, setMemberRole, suspendMember, type TeamMember, type TeamRole } from "@/lib/data/team";
import { TraveliunShell } from "./TraveliunShell";
import { useTraveliunUI } from "./TraveliunUIProvider";

/**
 * «الموظفين».
 *
 * Bespoke rather than the generic table, for one reason: the section a colleague
 * belongs to IS their permission set, so it cannot be a free-text cell in an
 * editor whose only check is "is signed in". Every write here goes through
 * data/team.ts — `employees.manage`, service role, audit row — and the database
 * refuses the generic path outright (0030).
 */

const card = "rounded-2xl border border-[#e2ebe7] bg-white p-5 shadow-[0_1px_2px_rgba(0,60,58,0.04)]";
const field =
  "h-11 w-full rounded-[10px] border border-[#dbe6e1] bg-white px-3 text-sm text-[#185045] outline-none focus:border-[#2aa87a]";
const label = "grid gap-1.5 text-[12px] font-bold text-[#185045]";

type Draft = {
  id?: string;
  arabic_name: string;
  english_name: string;
  email: string;
  mobile: string;
  role_id: string;
};

function toDraft(m?: TeamMember): Draft {
  return {
    id: m?.id,
    arabic_name: m?.arabic_name ?? "",
    english_name: m?.english_name ?? "",
    email: m?.email ?? "",
    mobile: m?.mobile ?? "",
    role_id: m?.role_id ?? "",
  };
}

export function TeamMembers({
  members,
  roles,
  canManage,
}: {
  members: TeamMember[];
  roles: TeamRole[];
  /** false → the list is readable but every control is gone. */
  canManage: boolean;
}) {
  const { t } = useTraveliunUI();
  const router = useRouter();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);

  const q = query.trim().toLowerCase();
  const rows = q
    ? members.filter((m) =>
        [m.arabic_name, m.english_name, m.email, m.mobile, m.role_name]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q)),
      )
    : members;

  function save() {
    if (!draft) return;
    startTransition(async () => {
      setError(null);
      const res = await saveMember({
        id: draft.id,
        arabic_name: draft.arabic_name,
        english_name: draft.english_name || null,
        email: draft.email || null,
        mobile: draft.mobile || null,
        role_id: draft.role_id || null,
      });
      if (!res.ok) {
        setError(t(res.error));
        return;
      }
      setDraft(null);
      router.refresh();
    });
  }

  async function move(employeeId: string, roleId: string) {
    setBusyId(employeeId);
    await setMemberRole(employeeId, roleId || null);
    setBusyId(null);
    router.refresh();
  }

  async function toggleSuspend(m: TeamMember) {
    setBusyId(m.id);
    await suspendMember(m.id, m.status === "Active");
    setBusyId(null);
    router.refresh();
  }

  return (
    <TraveliunShell title="nav.employees">
      <div className="tv-fade-up space-y-4">
        <section className={card}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-lg font-extrabold text-[#003c3a]">{t("nav.employees")}</h1>
              <p className="mt-1 text-[12.5px] font-semibold text-[#93aaa3]">{t("team.subtitle")}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="absolute end-3 top-1/2 size-4 -translate-y-1/2 text-[#8aa29b]" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t("searchPlaceholder")}
                  className="h-10 w-56 rounded-[10px] border border-[#dbe6e1] bg-white px-3 pe-9 text-sm text-[#185045] outline-none focus:border-[#2aa87a]"
                />
              </div>
              {canManage ? (
                <>
                  <Link
                    href="/employees/roles"
                    className="inline-flex h-10 items-center gap-2 rounded-[10px] border border-[#dbe6e1] px-4 text-[12.5px] font-bold text-[#185045] hover:bg-[#f4f8f6]"
                  >
                    <ShieldCheck className="size-4" />
                    {t("team.roles")}
                  </Link>
                  <button
                    type="button"
                    onClick={() => { setError(null); setDraft(toDraft()); }}
                    className="inline-flex h-10 items-center gap-2 rounded-[10px] bg-[#185045] px-4 text-[12.5px] font-bold text-white hover:bg-[#0f4439]"
                  >
                    <UserPlus className="size-4" />
                    {t("add")}
                  </button>
                </>
              ) : null}
            </div>
          </div>
          {canManage ? (
            <p className="mt-3 flex items-center gap-1.5 text-[11.5px] font-semibold text-[#93aaa3]">
              <KeyRound className="size-3.5" />
              {t("team.auditNote")}
            </p>
          ) : null}
        </section>

        {draft ? (
          <section className={card}>
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="text-sm font-extrabold text-[#185045]">{draft.id ? t("edit") : t("add")}</h2>
              <button
                type="button"
                onClick={() => setDraft(null)}
                className="flex size-9 items-center justify-center rounded-[9px] border border-[#dbe6e1] text-[#557d78] hover:bg-[#f4f8f6]"
                aria-label={t("close")}
              >
                <X className="size-4" />
              </button>
            </div>
            <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(210px,1fr))]">
              <label className={label}>
                {t("col.arabicName")}
                <input className={field} value={draft.arabic_name} onChange={(e) => setDraft({ ...draft, arabic_name: e.target.value })} />
              </label>
              <label className={label}>
                {t("col.englishName")}
                <input dir="ltr" className={field} value={draft.english_name} onChange={(e) => setDraft({ ...draft, english_name: e.target.value })} />
              </label>
              <label className={label}>
                {t("col.email")}
                <input dir="ltr" className={field} value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} />
              </label>
              <label className={label}>
                {t("col.mobile")}
                <input dir="ltr" className={field} value={draft.mobile} onChange={(e) => setDraft({ ...draft, mobile: e.target.value })} />
              </label>
              {/* The section, on the same form as the name: an employee without one
                  can sign in and see nothing, which is confusing to discover later. */}
              <label className={label}>
                {t("team.moveTo")}
                <select className={field} value={draft.role_id} onChange={(e) => setDraft({ ...draft, role_id: e.target.value })}>
                  <option value="">{t("team.noRole")}</option>
                  {roles.map((r) => (
                    <option key={r.id} value={r.id}>{r.arabic_name}</option>
                  ))}
                </select>
              </label>
            </div>

            {draft.role_id ? <RoleSummary role={roles.find((r) => r.id === draft.role_id)} /> : null}

            {error ? (
              <p role="alert" className="mt-3 rounded-[10px] border border-[#f4c9d4] bg-[#fdeef2] px-4 py-2.5 text-[12.5px] font-bold text-[#c22850]">
                {error}
              </p>
            ) : null}

            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={save}
                disabled={pending}
                className="inline-flex h-11 items-center gap-2 rounded-[10px] bg-[#185045] px-5 text-[13px] font-bold text-white hover:bg-[#0f4439] disabled:opacity-60"
              >
                {pending ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                {t("save")}
              </button>
              <button
                type="button"
                onClick={() => setDraft(null)}
                className="inline-flex h-11 items-center rounded-[10px] border border-[#d8e3de] px-5 text-[13px] font-bold text-[#185045] hover:bg-[#f4f8f6]"
              >
                {t("cancel")}
              </button>
            </div>
          </section>
        ) : null}

        {rows.length === 0 ? (
          <section className={card}>
            <EmptyState title={t("noResults")} />
          </section>
        ) : (
          <section className={card}>
            <ul className="space-y-2">
              {rows.map((m) => (
                <li
                  key={m.id}
                  className={`flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[11px] border px-3.5 py-2.5 ${
                    m.status === "Active" ? "border-[#e8efeb]" : "border-[#f0c7c7] bg-[#fdf6f7]"
                  }`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-extrabold text-[#003c3a]">{m.arabic_name}</span>
                    <span className="block truncate text-[11px] font-semibold text-[#93aaa3]">
                      <DirText dir="ltr">{m.email ?? m.mobile ?? "—"}</DirText>
                    </span>
                  </span>

                  {!m.has_login ? (
                    <span className="rounded-full bg-[#eef4f1] px-2.5 py-1 text-[11px] font-bold text-[#557d78]">{t("team.noLogin")}</span>
                  ) : null}
                  {m.status !== "Active" ? (
                    <span className="rounded-full bg-[#fdeef2] px-2.5 py-1 text-[11px] font-bold text-[#c22850]">{t("team.suspended")}</span>
                  ) : null}

                  {canManage ? (
                    <select
                      value={m.role_id ?? ""}
                      disabled={busyId === m.id}
                      onChange={(e) => void move(m.id, e.target.value)}
                      className="h-9 rounded-[9px] border border-[#dbe6e1] bg-white px-2 text-[12px] font-bold text-[#185045] outline-none focus:border-[#2aa87a] disabled:opacity-60"
                    >
                      <option value="">{t("team.noRole")}</option>
                      {roles.map((r) => (
                        <option key={r.id} value={r.id}>{r.arabic_name}</option>
                      ))}
                    </select>
                  ) : (
                    <span className="rounded-full bg-[#eef4f1] px-2.5 py-1 text-[11.5px] font-bold text-[#185045]">
                      {m.role_name ?? t("team.noRole")}
                    </span>
                  )}

                  {canManage ? (
                    <>
                      <button
                        type="button"
                        onClick={() => { setError(null); setDraft(toDraft(m)); }}
                        className="flex size-9 items-center justify-center rounded-[9px] border border-[#dbe6e1] text-[#557d78] hover:bg-[#f4f8f6]"
                        aria-label={t("edit")}
                      >
                        <Pencil className="size-4" />
                      </button>
                      <button
                        type="button"
                        disabled={busyId === m.id}
                        onClick={() => void toggleSuspend(m)}
                        className="inline-flex h-9 items-center rounded-[9px] border border-[#dbe6e1] px-3 text-[11.5px] font-bold text-[#557d78] hover:bg-[#f4f8f6] disabled:opacity-60"
                      >
                        {busyId === m.id ? <Loader2 className="size-3.5 animate-spin" /> : m.status === "Active" ? t("team.suspend") : t("team.reactivate")}
                      </button>
                    </>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </TraveliunShell>
  );
}

/** What the chosen section grants, said out loud on the employee's own form. */
function RoleSummary({ role }: { role?: TeamRole }) {
  const { t } = useTraveliunUI();
  if (!role) return null;
  return (
    <div className="mt-3 rounded-[10px] border border-[#e8efeb] bg-[#f8fbfa] px-3.5 py-2.5">
      <p className="text-[12px] font-extrabold text-[#185045]">{role.arabic_name}</p>
      {role.description ? <p className="mt-0.5 text-[11.5px] font-semibold text-[#557d78]">{role.description}</p> : null}
      <p className="mt-1 text-[11px] font-bold text-[#93aaa3]">
        {role.permission_keys.length === 0
          ? t("team.grantsNone")
          : t("team.grants", { n: String(role.permission_keys.length), total: "13" })}
      </p>
    </div>
  );
}
