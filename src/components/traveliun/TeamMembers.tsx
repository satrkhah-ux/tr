"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Bell, Check, KeyRound, LayoutGrid, Loader2, Pencil, Plus, Search, ShieldCheck, Trash2, UserPlus } from "lucide-react";
import { DirText } from "@/components/DirText";
import { EditSheet } from "@/components/ui/edit-sheet";
import { EmptyState } from "@/components/ui/EmptyState";
import { deleteMember, saveMember, setMemberPermissions, setMemberRole, suspendMember, type PendingRegistration, type TeamMember, type TeamRole } from "@/lib/data/team";
import { ALL_PERMISSIONS, isDeveloperRole, PERMISSION_GROUPS, type Permission } from "@/lib/roles/roles";
import type { TranslationKey } from "@/lib/i18n";
import { useRole } from "@/lib/roles/RoleContext";
import { PendingEmployees } from "./team/PendingEmployees";
import { TelegramLink } from "./team/TelegramLink";
import { TempPassword } from "./EmployeeAccounts";
import { setEmployeePassword } from "@/lib/data/employee-accounts";
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
  "tv-field h-11 w-full rounded-[10px] border px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-tv-action-focus";
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
  registrations,
  canManage,
}: {
  members: TeamMember[];
  roles: TeamRole[];
  /** self-registrations waiting for a decision — empty unless canManage. */
  registrations: PendingRegistration[];
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
  const [extraFor, setExtraFor] = useState<string | null>(null);
  const [tgFor, setTgFor] = useState<string | null>(null);
  // «كلمة مرور جديدة» on a colleague's row: what is typed, and what to tell the administrator after
  const [pw, setPw] = useState<{ id: string; value: string } | null>(null);
  const [pwDone, setPwDone] = useState<{ id: string; text: string; ok: boolean } | null>(null);

  async function savePassword(m: TeamMember, value: string) {
    setBusyId(m.id);
    const r = await setEmployeePassword(m.id, value);
    setBusyId(null);
    if (r.ok) {
      setPw(null);
      setPwDone({ id: m.id, ok: true, text: t("emp.tempPasswordSet", { email: r.email }) });
      router.refresh();
    } else setPwDone({ id: m.id, ok: false, text: r.error ? t(r.error) : r.message });
  }
  // The developer's section, and whoever sits in it, are the developer's to
  // change (team.ts refuses the rest): read-only here for everyone else.
  const { isDeveloper } = useRole();
  const developerRole = (roleId: string | null) => !isDeveloper && isDeveloperRole(roles.find((r) => r.id === roleId)?.permission_keys);

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

  async function remove(m: TeamMember) {
    if (!window.confirm(t("team.deleteConfirm", { name: m.arabic_name }))) return;
    setBusyId(m.id);
    setError(null);
    const res = await deleteMember(m.id);
    setBusyId(null);
    if (!res.ok) window.alert(t(res.error));
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
        {canManage ? <PendingEmployees pending={registrations} roles={roles} /> : null}
        <section className={card}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-lg font-extrabold text-[#003c3a]">{t("nav.employees")}</h1>
              <p className="mt-1 text-[12.5px] font-semibold text-tv-text-faint">{t("team.subtitle")}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="absolute end-3 top-1/2 size-4 -translate-y-1/2 text-tv-text-faint" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t("searchPlaceholder")}
                  className="tv-field h-10 w-56 rounded-[10px] border px-3 pe-9 text-sm outline-none focus-visible:ring-2 focus-visible:ring-tv-action-focus"
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
            <p className="mt-3 flex items-center gap-1.5 text-[11.5px] font-semibold text-tv-text-faint">
              <KeyRound className="size-3.5" />
              {t("team.auditNote")}
            </p>
          ) : null}
        </section>

        <EditSheet open={draft !== null} onClose={() => setDraft(null)} title={draft?.id ? t("edit") : t("add")}>
          {draft ? (
          <section>
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
                    <option key={r.id} value={r.id} disabled={developerRole(r.id)}>{r.arabic_name}</option>
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
        </EditSheet>

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
                    <span className="block truncate text-[11px] font-semibold text-tv-text-faint">
                      <DirText dir="ltr">{m.email ?? m.mobile ?? "—"}</DirText>
                    </span>
                  </span>

                  {!m.has_login ? (
                    // imported colleagues have a row but no sign-in yet: «حسابات الدخول» makes one
                    <Link
                      href="/employees/accounts"
                      title={t("team.noLoginHint")}
                      className="rounded-full bg-[#eef4f1] px-2.5 py-1 text-[11px] font-bold text-[#557d78] hover:underline"
                    >
                      {t("team.noLogin")}
                    </Link>
                  ) : null}
                  {m.status !== "Active" ? (
                    <span className="rounded-full bg-[#fdeef2] px-2.5 py-1 text-[11px] font-bold text-[#c22850]">{t("team.suspended")}</span>
                  ) : null}

                  {/* «تنبيهاتي»: linked or not, for everyone; the ID and the test message for employees.manage */}
                  {canManage && !developerRole(m.role_id) ? (
                    <button
                      type="button"
                      onClick={() => setTgFor(tgFor === m.id ? null : m.id)}
                      aria-expanded={tgFor === m.id}
                      className={`inline-flex h-9 items-center gap-1.5 rounded-[9px] border px-3 text-[11.5px] font-bold hover:bg-[#f4f8f6] ${
                        m.telegram_linked ? "border-[#2aa87a] text-[#0f7a52]" : "border-[#dbe6e1] text-tv-text-faint"
                      }`}
                    >
                      <Bell className="size-3.5" />
                      {m.telegram_linked ? t("team.tg.linked") : t("team.tg.notLinkedShort")}
                    </button>
                  ) : (
                    <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${m.telegram_linked ? "bg-[#e7f6ef] text-[#0f7a52]" : "bg-[#eef4f1] text-tv-text-faint"}`}>
                      {m.telegram_linked ? t("team.tg.linked") : t("team.tg.notLinkedShort")}
                    </span>
                  )}

                  {canManage && !developerRole(m.role_id) ? (
                    <select
                      value={m.role_id ?? ""}
                      disabled={busyId === m.id}
                      onChange={(e) => void move(m.id, e.target.value)}
                      className="tv-field h-9 rounded-[9px] border px-2 text-[12px] font-bold outline-none focus-visible:ring-2 focus-visible:ring-tv-action-focus disabled:opacity-60"
                    >
                      <option value="">{t("team.noRole")}</option>
                      {roles.map((r) => (
                        <option key={r.id} value={r.id} disabled={developerRole(r.id)}>{r.arabic_name}</option>
                      ))}
                    </select>
                  ) : (
                    <span className="rounded-full bg-[#eef4f1] px-2.5 py-1 text-[11.5px] font-bold text-[#185045]">
                      {m.role_name ?? t("team.noRole")}
                    </span>
                  )}

                  {canManage && developerRole(m.role_id) ? (
                    <span className="rounded-full bg-[#fff8e8] px-2.5 py-1 text-[11px] font-bold text-[#a86a10]">{t("team.developerOnly")}</span>
                  ) : canManage ? (
                    <>
                      <button
                        type="button"
                        onClick={() => setExtraFor(extraFor === m.id ? null : m.id)}
                        aria-expanded={extraFor === m.id}
                        className={`inline-flex h-9 items-center gap-1.5 rounded-[9px] border px-3 text-[11.5px] font-bold hover:bg-[#f4f8f6] ${
                          m.extra_permission_keys.length + m.removed_permission_keys.length > 0 ? "border-[#2aa87a] text-[#0f7a52]" : "border-[#dbe6e1] text-[#557d78]"
                        }`}
                      >
                        <LayoutGrid className="size-3.5" />
                        {t("team.extra")}
                        {m.extra_permission_keys.length + m.removed_permission_keys.length > 0
                          ? ` (+${m.extra_permission_keys.length} / −${m.removed_permission_keys.length})`
                          : ""}
                      </button>
                      {m.email ? (
                        <button
                          type="button"
                          onClick={() => { setPwDone(null); setPw(pw?.id === m.id ? null : { id: m.id, value: "" }); }}
                          aria-expanded={pw?.id === m.id}
                          className="inline-flex h-9 items-center gap-1.5 rounded-[9px] border border-[#dbe6e1] px-3 text-[11.5px] font-bold text-[#557d78] hover:bg-[#f4f8f6]"
                        >
                          <KeyRound className="size-3.5" />
                          {t("emp.tempPassword")}
                        </button>
                      ) : null}
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
                      <button
                        type="button"
                        disabled={busyId === m.id}
                        onClick={() => void remove(m)}
                        className="flex size-9 items-center justify-center rounded-[9px] border border-[#f0c4cf] text-[#c22850] hover:bg-[#fdf6f7] disabled:opacity-60"
                        aria-label={t("team.delete")}
                        title={t("team.delete")}
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </>
                  ) : null}
                  {pw?.id === m.id && canManage && !developerRole(m.role_id) ? (
                    <div className="basis-full">
                      <TempPassword
                        email={m.email ?? ""}
                        value={pw.value}
                        busy={busyId === m.id}
                        onChange={(value) => setPw({ id: m.id, value })}
                        onSave={() => void savePassword(m, pw.value)}
                        onCancel={() => setPw(null)}
                      />
                    </div>
                  ) : null}
                  {pwDone?.id === m.id ? (
                    <p className={`basis-full text-end text-[12px] font-bold ${pwDone.ok ? "text-[#0f7a52]" : "text-[#c22850]"}`}>{pwDone.text}</p>
                  ) : null}
                  {tgFor === m.id && canManage && !developerRole(m.role_id) ? <TelegramLink member={m} /> : null}
                  {extraFor === m.id && canManage && !developerRole(m.role_id) ? (
                    <ExtraSections
                      member={m}
                      roleKeys={roles.find((r) => r.id === m.role_id)?.permission_keys ?? []}
                      onDone={() => { setExtraFor(null); router.refresh(); }}
                    />
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
      <p className="mt-1 text-[11px] font-bold text-tv-text-faint">
        {role.permission_keys.length === 0
          ? t("team.grantsNone")
          : t("team.grants", { n: String(role.permission_keys.length), total: String(ALL_PERMISSIONS.length) })}
      </p>
    </div>
  );
}

/**
 * This colleague's sections, by the menu's sections: everything their role gives
 * shows ticked and can be taken (0107), anything else can be given (0106) — the
 * role itself, and their colleagues, stay as they are. What the actor does not
 * hold is shown but fixed (team.ts refuses it anyway).
 */
function ExtraSections({ member, roleKeys, onDone }: { member: TeamMember; roleKeys: Permission[]; onDone: () => void }) {
  const { t } = useTraveliunUI();
  const { can } = useRole();
  const [held, setHeld] = useState(
    () => new Set<Permission>([...roleKeys, ...member.extra_permission_keys].filter((k) => !member.removed_permission_keys.includes(k))),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    const all = PERMISSION_GROUPS.flatMap((g) => g.items.map((i) => i.key));
    const res = await setMemberPermissions(
      member.id,
      all.filter((k) => held.has(k) && !roleKeys.includes(k)),
      all.filter((k) => !held.has(k) && roleKeys.includes(k)),
    );
    setBusy(false);
    if (!res.ok) setError(t(res.error));
    else onDone();
  }

  return (
    <div className="basis-full rounded-[10px] border border-[#e8efeb] bg-[#f8fbfa] p-3">
      <p className="text-[11.5px] font-bold text-[#557d78]">{t("team.extraHint")}</p>
      <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {PERMISSION_GROUPS.filter((g) => g.key !== "perm.group.developer").map((g) => (
          <div key={g.key} className="rounded-[9px] border border-[#e8efeb] bg-white p-2.5">
            <p className="mb-1.5 text-[12px] font-extrabold text-[#103f37]">{t(g.key as TranslationKey)}</p>
            {g.items.map((i) => {
              const fromRole = roleKeys.includes(i.key);
              const on = held.has(i.key);
              return (
                <label key={i.key} className="flex items-center gap-2 py-0.5 text-[12px] font-bold text-[#185045]">
                  <input
                    type="checkbox"
                    checked={on}
                    disabled={busy || !can(i.key)}
                    onChange={(e) => {
                      const next = new Set(held);
                      if (e.target.checked) next.add(i.key);
                      else next.delete(i.key);
                      setHeld(next);
                    }}
                    className="size-4 accent-[#185045]"
                  />
                  {t(`perm.${i.key}` as TranslationKey)}
                  {fromRole && !on ? (
                    <span className="text-[10.5px] font-bold text-[#c22850]">({t("team.removedFromRole")})</span>
                  ) : fromRole ? (
                    <span className="text-[10.5px] font-semibold text-tv-text-faint">({t("team.fromRole")})</span>
                  ) : on ? (
                    <span className="text-[10.5px] font-bold text-[#0f7a52]">({t("team.addedForMember")})</span>
                  ) : null}
                </label>
              );
            })}
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void save()}
          className="inline-flex h-9 items-center gap-1.5 rounded-[9px] bg-[#185045] px-4 text-[12px] font-extrabold text-white hover:bg-[#0f4439] disabled:opacity-60"
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
          {t("save")}
        </button>
        {error ? <span className="text-[12px] font-bold text-[#c22850]">{error}</span> : null}
      </div>
    </div>
  );
}
