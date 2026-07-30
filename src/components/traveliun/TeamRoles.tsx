"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  AlertTriangle,
  Check,
  Eye,
  KeyRound,
  Loader2,
  Pencil,
  Plus,
  ShieldAlert,
  Trash2,
  UserCog,
  Users,
  X,
  Zap,
} from "lucide-react";
import { DirText } from "@/components/DirText";
import { PERMISSION_GROUPS, type Permission } from "@/lib/roles/roles";
import {
  deleteRole,
  saveRole,
  setMemberRole,
  suspendMember,
  type TeamMember,
  type TeamRole,
} from "@/lib/data/team";
import type { TranslationKey } from "@/lib/i18n";
import { TraveliunShell } from "./TraveliunShell";
import { useTraveliunUI } from "./TraveliunUIProvider";

/**
 * «الأقسام والصلاحيات».
 *
 * The screen this replaces let an administrator tick boxes that were never
 * stored: the permission list was a hardcoded mock and saving wrote only the
 * name. Here every tick is a key in `roles.permission_keys`, which is the same
 * column the server reads on every request to decide what the holder may do.
 *
 * It is arranged around the question an administrator actually has — «ماذا يشاهد
 * الموجود في هذا القسم وماذا عليه؟» — so each permission is grouped by the part
 * of the system it opens and split into what is SEEN and what can be DONE, with
 * one sentence of consequence under each.
 */

const card = "rounded-2xl border border-[#e2ebe7] bg-white p-5 shadow-[0_1px_2px_rgba(0,60,58,0.04)]";
const field =
  "h-11 w-full rounded-[10px] border border-[#dbe6e1] bg-white px-3 text-sm text-[#185045] outline-none focus:border-[#2aa87a]";
const label = "grid gap-1.5 text-[12px] font-bold text-[#185045]";

const PERM_LABEL = (key: Permission) => `perm.${key}` as TranslationKey;
const PERM_HINT = (key: Permission) => `perm.${key}.hint` as TranslationKey;

const TOTAL_PERMISSIONS = PERMISSION_GROUPS.reduce((n, g) => n + g.items.length, 0);

type Draft = {
  id?: string;
  arabic_name: string;
  english_name: string;
  description: string;
  keys: Set<Permission>;
};

function toDraft(role?: TeamRole): Draft {
  return {
    id: role?.id,
    arabic_name: role?.arabic_name ?? "",
    english_name: role?.english_name ?? "",
    description: role?.description ?? "",
    keys: new Set(role?.permission_keys ?? []),
  };
}

export function TeamRoles({ roles, members }: { roles: TeamRole[]; members: TeamMember[] }) {
  const { t } = useTraveliunUI();
  const router = useRouter();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    if (!draft) return;
    startTransition(async () => {
      setError(null);
      const res = await saveRole({
        id: draft.id,
        arabic_name: draft.arabic_name,
        english_name: draft.english_name || null,
        description: draft.description || null,
        permission_keys: [...draft.keys],
      });
      if (!res.ok) {
        setError(t(res.error));
        return;
      }
      setDraft(null);
      router.refresh();
    });
  }

  return (
    <TraveliunShell title="nav.roles">
      <div className="tv-fade-up space-y-4">
        <section className={card}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-lg font-extrabold text-[#003c3a]">{t("team.title")}</h1>
              <p className="mt-1 text-[12.5px] font-semibold text-[#93aaa3]">{t("team.subtitle")}</p>
            </div>
            <button
              type="button"
              onClick={() => { setError(null); setDraft(toDraft()); }}
              className="inline-flex h-10 items-center gap-2 rounded-[10px] bg-[#185045] px-4 text-[12.5px] font-bold text-white hover:bg-[#0f4439]"
            >
              <Plus className="size-4" />
              {t("team.addRole")}
            </button>
          </div>
          <p className="mt-3 flex items-center gap-1.5 text-[11.5px] font-semibold text-[#93aaa3]">
            <KeyRound className="size-3.5" />
            {t("team.auditNote")}
          </p>
        </section>

        {draft ? (
          <RoleForm
            draft={draft}
            setDraft={setDraft}
            onSave={save}
            onCancel={() => setDraft(null)}
            pending={pending}
            error={error}
          />
        ) : null}

        <div className="grid gap-3 2xl:grid-cols-2">
          {roles.map((role) => (
            <RoleCard
              key={role.id}
              role={role}
              members={members.filter((m) => m.role_id === role.id)}
              onEdit={() => { setError(null); setDraft(toDraft(role)); }}
            />
          ))}
        </div>

        <MembersTable roles={roles} members={members} />
      </div>
    </TraveliunShell>
  );
}

/** One section: what it is for, what it grants, and who is in it. */
function RoleCard({ role, members, onEdit }: { role: TeamRole; members: TeamMember[]; onEdit: () => void }) {
  const { t } = useTraveliunUI();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const held = new Set(role.permission_keys);
  const sees = PERMISSION_GROUPS.flatMap((g) => g.items).filter((i) => i.kind === "view" && held.has(i.key));
  const does = PERMISSION_GROUPS.flatMap((g) => g.items).filter((i) => i.kind === "do" && held.has(i.key));
  const sensitive = PERMISSION_GROUPS.flatMap((g) => g.items).filter((i) => i.sensitive && held.has(i.key));

  return (
    <article className={card}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[15px] font-extrabold text-[#003c3a]">{role.arabic_name}</h2>
          {role.description ? (
            <p className="mt-1 text-[12px] font-semibold text-[#557d78]">{role.description}</p>
          ) : null}
          <p className="mt-1.5 text-[11.5px] font-bold text-[#93aaa3]">
            {held.size === 0
              ? t("team.grantsNone")
              : t("team.grants", { n: String(held.size), total: String(TOTAL_PERMISSIONS) })}
          </p>
        </div>
        <div className="flex shrink-0 gap-1.5">
          <button
            type="button"
            onClick={onEdit}
            className="flex size-9 items-center justify-center rounded-[9px] border border-[#dbe6e1] text-[#557d78] hover:bg-[#f4f8f6]"
            aria-label={t("edit")}
          >
            <Pencil className="size-4" />
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                setError(null);
                const res = await deleteRole(role.id);
                if (!res.ok) setError(t(res.error));
                else router.refresh();
              })
            }
            className="flex size-9 items-center justify-center rounded-[9px] border border-[#f0c7c7] text-[#c22850] hover:bg-[#fdeef2] disabled:opacity-60"
            aria-label={t("team.deleteRole")}
          >
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
          </button>
        </div>
      </div>

      {error ? <p className="mt-2 text-[11.5px] font-bold text-[#c22850]">{error}</p> : null}

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <PermList title={t("team.sees")} icon={Eye} items={sees.map((i) => t(PERM_LABEL(i.key)))} />
        <PermList title={t("team.does")} icon={Zap} items={does.map((i) => t(PERM_LABEL(i.key)))} />
      </div>

      {sensitive.length > 0 ? (
        <p className="mt-3 flex items-start gap-1.5 rounded-[9px] bg-[#fff8e8] px-3 py-2 text-[11.5px] font-bold text-[#a86a10]">
          <ShieldAlert className="mt-0.5 size-3.5 shrink-0" />
          <span>
            {t("team.sensitive")}: {sensitive.map((i) => t(PERM_LABEL(i.key))).join(" · ")}
          </span>
        </p>
      ) : null}

      <div className="mt-3 border-t border-[#f0f4f2] pt-3">
        <p className="mb-2 flex items-center gap-1.5 text-[11.5px] font-extrabold text-[#557d78]">
          <Users className="size-3.5" />
          {t("team.membersCount", { n: String(members.length) })}
        </p>
        {members.length === 0 ? (
          <p className="text-[11.5px] font-semibold text-[#93aaa3]">{t("team.noMembers")}</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {members.map((m) => (
              <span
                key={m.id}
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-bold ${
                  m.status === "Active" ? "bg-[#eef4f1] text-[#185045]" : "bg-[#fdeef2] text-[#c22850]"
                }`}
              >
                {m.arabic_name}
                {!m.has_login ? <span className="text-[10px] font-semibold opacity-70">{t("team.noLogin")}</span> : null}
              </span>
            ))}
          </div>
        )}
      </div>
    </article>
  );
}

function PermList({
  title,
  icon: Icon,
  items,
}: {
  title: string;
  icon: typeof Eye;
  items: string[];
}) {
  return (
    <div className="rounded-[11px] border border-[#e8efeb] p-3">
      <p className="mb-1.5 flex items-center gap-1.5 text-[11.5px] font-extrabold text-[#185045]">
        <Icon className="size-3.5" />
        {title}
      </p>
      {items.length === 0 ? (
        <p className="text-[11.5px] font-semibold text-[#b6c4bf]">—</p>
      ) : (
        <ul className="space-y-1">
          {items.map((item) => (
            <li key={item} className="flex items-start gap-1.5 text-[12px] font-semibold text-[#557d78]">
              <Check className="mt-0.5 size-3 shrink-0 text-[#2aa87a]" />
              {item}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The editor: every key in the vocabulary, grouped, with its consequence. */
function RoleForm({
  draft,
  setDraft,
  onSave,
  onCancel,
  pending,
  error,
}: {
  draft: Draft;
  setDraft: (d: Draft) => void;
  onSave: () => void;
  onCancel: () => void;
  pending: boolean;
  error: string | null;
}) {
  const { t } = useTraveliunUI();

  const toggle = (key: Permission) => {
    const keys = new Set(draft.keys);
    if (keys.has(key)) keys.delete(key);
    else keys.add(key);
    setDraft({ ...draft, keys });
  };

  return (
    <section className={card}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-sm font-extrabold text-[#185045]">{draft.id ? draft.arabic_name || t("edit") : t("team.addRole")}</h2>
        <button
          type="button"
          onClick={onCancel}
          className="flex size-9 items-center justify-center rounded-[9px] border border-[#dbe6e1] text-[#557d78] hover:bg-[#f4f8f6]"
          aria-label={t("close")}
        >
          <X className="size-4" />
        </button>
      </div>

      <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(220px,1fr))]">
        <label className={label}>
          {t("team.roleName")}
          <input className={field} value={draft.arabic_name} onChange={(e) => setDraft({ ...draft, arabic_name: e.target.value })} />
        </label>
        <label className={label}>
          {t("team.roleNameLatin")}
          <input dir="ltr" className={field} value={draft.english_name} onChange={(e) => setDraft({ ...draft, english_name: e.target.value })} />
        </label>
        <label className={`${label} sm:col-span-2`}>
          {t("team.roleDescription")}
          <input className={field} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
        </label>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span className="text-[11.5px] font-extrabold text-[#557d78]">
          {t("team.grants", { n: String(draft.keys.size), total: String(TOTAL_PERMISSIONS) })}
        </span>
        <button
          type="button"
          onClick={() => setDraft({ ...draft, keys: new Set(PERMISSION_GROUPS.flatMap((g) => g.items.map((i) => i.key))) })}
          className="rounded-full border border-[#dbe6e1] px-3 py-1 text-[11.5px] font-bold text-[#185045] hover:bg-[#f0f7f4]"
        >
          {t("team.pickAll")}
        </button>
        <button
          type="button"
          onClick={() => setDraft({ ...draft, keys: new Set() })}
          className="rounded-full border border-[#dbe6e1] px-3 py-1 text-[11.5px] font-bold text-[#557d78] hover:bg-[#f4f8f6]"
        >
          {t("team.pickNone")}
        </button>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        {PERMISSION_GROUPS.map((group) => (
          <div key={group.key} className="rounded-[12px] border border-[#e8efeb] p-3">
            <p className="mb-2 text-[12px] font-extrabold text-[#185045]">{t(group.key as TranslationKey)}</p>
            <div className="space-y-1.5">
              {group.items.map((item) => {
                const on = draft.keys.has(item.key);
                return (
                  <label
                    key={item.key}
                    className={`flex cursor-pointer items-start gap-2 rounded-[9px] border p-2.5 transition-colors ${
                      on ? "border-[#bfe5d4] bg-[#f4fbf7]" : "border-[#eef2f0] hover:bg-[#f8fbfa]"
                    }`}
                  >
                    <input type="checkbox" checked={on} onChange={() => toggle(item.key)} className="mt-0.5 size-4 accent-[#185045]" />
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[12.5px] font-bold text-[#185045]">{t(PERM_LABEL(item.key))}</span>
                        <span className={`rounded-full px-1.5 py-px text-[10px] font-bold ${item.kind === "view" ? "bg-[#eef4f1] text-[#557d78]" : "bg-[#e9f7f0] text-[#0f7a52]"}`}>
                          {item.kind === "view" ? t("team.sees") : t("team.does")}
                        </span>
                        {item.sensitive ? (
                          <span className="rounded-full bg-[#fff8e8] px-1.5 py-px text-[10px] font-bold text-[#a86a10]">
                            {t("team.sensitive")}
                          </span>
                        ) : null}
                      </span>
                      <span className="mt-0.5 block text-[11px] font-semibold text-[#93aaa3]">{t(PERM_HINT(item.key))}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <p className="mt-3 flex items-start gap-1.5 text-[11px] font-semibold text-[#a86a10]">
        <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
        {t("team.sensitiveHint")}
      </p>

      {error ? (
        <p role="alert" className="mt-3 rounded-[10px] border border-[#f4c9d4] bg-[#fdeef2] px-4 py-2.5 text-[12.5px] font-bold text-[#c22850]">
          {error}
        </p>
      ) : null}

      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={onSave}
          disabled={pending}
          className="inline-flex h-11 items-center gap-2 rounded-[10px] bg-[#185045] px-5 text-[13px] font-bold text-white hover:bg-[#0f4439] disabled:opacity-60"
        >
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
          {t("save")}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex h-11 items-center rounded-[10px] border border-[#d8e3de] px-5 text-[13px] font-bold text-[#185045] hover:bg-[#f4f8f6]"
        >
          {t("cancel")}
        </button>
      </div>
    </section>
  );
}

/** Everyone, and the one field that decides what they can do. */
function MembersTable({ roles, members }: { roles: TeamRole[]; members: TeamMember[] }) {
  const { t } = useTraveliunUI();
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);

  async function move(employeeId: string, roleId: string) {
    setPendingId(employeeId);
    await setMemberRole(employeeId, roleId || null);
    setPendingId(null);
    router.refresh();
  }

  async function toggleSuspend(m: TeamMember) {
    setPendingId(m.id);
    await suspendMember(m.id, m.status === "Active");
    setPendingId(null);
    router.refresh();
  }

  return (
    <section className={card}>
      <h2 className="mb-1 flex items-center gap-2 text-sm font-extrabold text-[#185045]">
        <UserCog className="size-4" />
        {t("team.members")}
      </h2>
      <p className="mb-3 text-[11.5px] font-semibold text-[#93aaa3]">{t("team.noLoginHint")}</p>

      <ul className="space-y-2">
        {members.map((m) => (
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

            <select
              value={m.role_id ?? ""}
              disabled={pendingId === m.id}
              onChange={(e) => void move(m.id, e.target.value)}
              className="h-9 rounded-[9px] border border-[#dbe6e1] bg-white px-2 text-[12px] font-bold text-[#185045] outline-none focus:border-[#2aa87a] disabled:opacity-60"
            >
              <option value="">{t("team.noRole")}</option>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>{r.arabic_name}</option>
              ))}
            </select>

            <button
              type="button"
              disabled={pendingId === m.id}
              onClick={() => void toggleSuspend(m)}
              className="inline-flex h-9 items-center rounded-[9px] border border-[#dbe6e1] px-3 text-[11.5px] font-bold text-[#557d78] hover:bg-[#f4f8f6] disabled:opacity-60"
            >
              {pendingId === m.id ? <Loader2 className="size-3.5 animate-spin" /> : m.status === "Active" ? t("team.suspend") : t("team.reactivate")}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
