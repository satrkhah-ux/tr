"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ExternalLink, Lightbulb, Loader2, Plus, RefreshCw, Search, Trash2 } from "lucide-react";
import { DirText } from "@/components/DirText";
import { assignFollowup, assignToTeletelHolders, deleteSlaRule, getSlaBoard, saveSlaRule, sendToFollowup, type SlaBoard as Board, type SlaRow } from "@/lib/data/sla";
import { ruleMinutes, SLA_KINDS, SLA_UNITS, waitParts, type SlaKind, type SlaRule, type Suggestion } from "@/lib/sla/classify";
import { useSlaLabels } from "./labels";

type OkBoard = Extract<Board, { ok: true }>;

const CARD = "rounded-[12px] border border-[#e3ece8] bg-white p-4";
const SELECT = "h-8 rounded-[8px] border border-[#cfe0d9] bg-white px-2 text-[12px] font-bold text-[#185045]";
const BTN = "inline-flex h-8 items-center gap-1.5 rounded-[8px] px-3 text-[12px] font-bold disabled:opacity-60";
const KIND_TONE: Record<SlaKind, string> = {
  first_reply: "border-[#d7c8f0] bg-[#f6f1fd] text-[#5b3c9a]",
  waiting: "border-[#f4d9a6] bg-[#fff8e8] text-[#a86a10]",
  cold: "border-[#c9d6ea] bg-[#f2f6fb] text-[#3d5a80]",
};

export function useWaitText() {
  const { unit } = useSlaLabels();
  return (minutes: number) => {
    const w = waitParts(minutes);
    return `${w.n} ${unit(w.unit, w.n)}`;
  };
}

export function useWhen() {
  const { language } = useSlaLabels();
  return (iso: string) =>
    new Date(iso).toLocaleString(language === "ar" ? "ar-SA-u-ca-gregory-nu-latn" : "en-GB", {
      timeZone: "Asia/Riyadh",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
}

/** «SLA» — the conversations by their clock, «المتابعة», and the rules (the owner, 2026-10-17). */
export function SlaBoard({ initial }: { initial: OkBoard }) {
  const { tx } = useSlaLabels();
  const when = useWhen();
  const [board, setBoard] = useState(initial);
  const [tab, setTab] = useState<"conv" | "fu" | "rules">("conv");
  const [loading, setLoading] = useState(false);

  async function reload(fresh: boolean) {
    setLoading(true);
    try {
      const next = await getSlaBoard(fresh);
      if (next.ok) setBoard(next);
    } finally {
      setLoading(false);
    }
  }

  const openFollowups = board.followups.filter((f) => f.status === "open").length;
  const tabs = [
    ["conv", tx("tabConversations"), board.rows?.length ?? 0],
    ["fu", tx("tabFollowups"), openFollowups],
    ["rules", tx("tabRules"), board.rules.length],
  ] as const;

  return (
    <div className="grid gap-4">
      <section className={CARD}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="text-[18px] font-extrabold text-[#103f37]">{tx("title")}</h1>
            <p className="mt-1 text-[12.5px] font-semibold leading-6 text-[#557d78]">{tx("hint")}</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="tv-tnum text-[11.5px] font-semibold text-[#93aaa3]">{tx("updatedAt", { t: when(board.at) })}</span>
            <button type="button" disabled={loading} onClick={() => reload(true)} className={`${BTN} bg-[#185045] text-white hover:bg-[#0f4439]`}>
              {loading ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
              {tx("refresh")}
            </button>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5" role="tablist">
          {tabs.map(([key, label, n]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              className={`inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[12px] font-bold ${tab === key ? "bg-[#185045] text-white" : "border border-[#cfe0d9] bg-white text-[#557d78] hover:bg-[#f4f8f6]"}`}
            >
              {label}
              <span className={`tv-tnum rounded-full px-1.5 text-[10.5px] ${tab === key ? "bg-white/20" : "bg-[#eef4f1]"}`}>{n}</span>
            </button>
          ))}
        </div>
      </section>

      {tab === "conv" ? (
        board.rows === null ? (
          <p className={`${CARD} text-[13px] font-bold text-[#c22850]`}>{tx("unreachable")}</p>
        ) : (
          <Conversations board={board} rows={board.rows} onChanged={() => reload(false)} />
        )
      ) : tab === "fu" ? (
        <Followups board={board} onChanged={() => reload(false)} />
      ) : (
        <Rules rules={board.rules} teams={board.teams} suggestions={board.suggestions} onChanged={() => reload(false)} />
      )}
    </div>
  );
}

// ---------- the conversations ----------

function TierChip({ rule }: { rule: SlaRule | undefined }) {
  const { tx } = useSlaLabels();
  if (!rule) return <span className="inline-flex rounded-full border border-[#bfe5d4] bg-[#e9f7f0] px-2 py-0.5 text-[11px] font-bold text-[#0f7a52]">{tx("onTime")}</span>;
  return (
    <span className="inline-flex rounded-full border px-2 py-0.5 text-[11px] font-bold" style={{ color: rule.color, borderColor: `${rule.color}55`, background: `${rule.color}14` }}>
      {rule.name}
    </span>
  );
}

function Conversations({ board, rows, onChanged }: { board: OkBoard; rows: SlaRow[]; onChanged: () => void }) {
  const { tx, kind: kindText } = useSlaLabels();
  const wait = useWaitText();
  const [kind, setKind] = useState<SlaKind | "all">("all");
  const [tier, setTier] = useState<string>("");
  const [agent, setAgent] = useState("");
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(100);
  const [busy, setBusy] = useState<number | null>(null);
  const ruleOf = useMemo(() => new Map(board.rules.map((r) => [r.id, r])), [board.rules]);

  const ofKind = useMemo(() => rows.filter((r) => kind === "all" || r.kind === kind), [rows, kind]);
  const agents = useMemo(() => [...new Set(rows.map((r) => r.assignee ?? ""))].sort((a, b) => a.localeCompare(b, "ar")), [rows]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return ofKind
      .filter(
        (r) =>
          (!tier || (tier === "ontime" ? !r.tierId : r.tierId === tier)) &&
          (!agent || (r.assignee ?? "") === (agent === "__none" ? "" : agent)) &&
          (!q || r.name.toLowerCase().includes(q) || r.phone.includes(q)),
      )
      .sort((a, b) => b.minutes - a.minutes);
  }, [ofKind, tier, agent, query]);
  const lateByAgent = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of ofKind) if (r.tierId) m.set(r.assignee ?? "", (m.get(r.assignee ?? "") ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  }, [ofKind]);
  const kindRules = kind === "all" ? [] : board.rules.filter((r) => r.kind === kind && r.active).sort((a, b) => ruleMinutes(a) - ruleMinutes(b));

  async function toFollowup(id: number) {
    setBusy(id);
    try {
      await sendToFollowup(id);
      onChanged();
    } finally {
      setBusy(null);
    }
  }

  const pick = (k: SlaKind | "all") => {
    setKind(k);
    setTier("");
    setLimit(100);
  };

  return (
    <section className={CARD}>
      {/* the three clocks, each with how many have reached a rule */}
      <div className="grid gap-2 sm:grid-cols-4">
        {(["all", ...SLA_KINDS] as const).map((k) => {
          const list = k === "all" ? rows : rows.filter((r) => r.kind === k);
          const late = list.filter((r) => r.tierId).length;
          return (
            <button
              key={k}
              type="button"
              onClick={() => pick(k)}
              title={k === "all" ? undefined : tx(`kh_${k}`)}
              className={`rounded-[10px] border p-3 text-start ${kind === k ? "border-[#185045] bg-[#f0f7f4]" : "border-[#e3ece8] bg-white hover:bg-[#f8fbfa]"}`}
            >
              <span className="block text-[12px] font-extrabold text-[#185045]">{k === "all" ? tx("all") : kindText(k)}</span>
              <span className="tv-tnum mt-1 flex items-baseline gap-2">
                <span className="text-[20px] font-extrabold text-[#103f37]">{list.length}</span>
                {late > 0 ? <span className="text-[12px] font-bold text-[#c22850]">{late} ⚑</span> : null}
              </span>
            </button>
          );
        })}
      </div>

      {kind !== "all" ? (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="text-[11.5px] font-semibold text-[#78948f]">{tx(`kh_${kind}`)}</span>
          {[{ id: "ontime", name: tx("onTime"), color: "#0f7a52" }, ...kindRules].map((r) => {
            const n = ofKind.filter((x) => (r.id === "ontime" ? !x.tierId : x.tierId === r.id)).length;
            const on = tier === r.id;
            return (
              <button
                key={r.id}
                type="button"
                onClick={() => setTier(on ? "" : r.id)}
                className="inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[11.5px] font-bold"
                style={{ color: r.color, borderColor: on ? r.color : `${r.color}55`, background: on ? `${r.color}22` : `${r.color}0d` }}
              >
                {r.name}
                <span className="tv-tnum">{n}</span>
              </button>
            );
          })}
        </div>
      ) : null}

      {lateByAgent.length > 0 ? (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="text-[11.5px] font-extrabold text-[#557d78]">{tx("lateByAgent")}:</span>
          {lateByAgent.map(([name, n]) => (
            <button
              key={name || "__none"}
              type="button"
              onClick={() => setAgent(agent === (name || "__none") ? "" : name || "__none")}
              className={`inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-[11.5px] font-bold ${agent === (name || "__none") ? "border-[#c22850] bg-[#fdf3f6] text-[#c22850]" : "border-[#f2c9d4] bg-white text-[#8a1f3c]"}`}
            >
              {name || tx("noAgent")} <span className="tv-tnum">{n}</span>
            </button>
          ))}
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <select value={agent} onChange={(e) => setAgent(e.target.value)} aria-label={tx("allAgents")} className={SELECT}>
          <option value="">{tx("allAgents")}</option>
          {agents.map((a) => (
            <option key={a || "__none"} value={a || "__none"}>{a || tx("noAgent")}</option>
          ))}
        </select>
        <label className="relative min-w-40 flex-1">
          <Search className="pointer-events-none absolute start-2 top-1/2 size-3.5 -translate-y-1/2 text-[#8aa29b]" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={tx("search")} className="h-8 w-full rounded-[8px] border border-[#cfe0d9] bg-white pe-2 ps-7 text-[12px] font-semibold text-[#185045]" />
        </label>
      </div>

      {shown.length === 0 ? (
        <p className="mt-4 text-[12.5px] font-semibold text-[#93aaa3]">{tx("noRows")}</p>
      ) : (
        <ul className="mt-3 divide-y divide-[#e6eeea] rounded-[10px] border border-[#e3ece8]">
          {shown.slice(0, limit).map((r) => {
            const rule = r.tierId ? ruleOf.get(r.tierId) : undefined;
            return (
              <li key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-3 py-2.5" style={rule ? { borderInlineStart: `4px solid ${rule.color}` } : undefined}>
                <span className="min-w-[10rem] flex-1">
                  <span className="block truncate text-[13px] font-bold text-[#103f37]">{r.name}</span>
                  {r.phone ? <DirText className="block text-[11px] font-semibold text-[#78948f]">{r.phone}</DirText> : null}
                </span>
                <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10.5px] font-bold ${KIND_TONE[r.kind]}`}>{kindText(r.kind)}</span>
                <span className="tv-tnum w-20 text-[13px] font-extrabold text-[#185045]">{wait(r.minutes)}</span>
                <TierChip rule={rule} />
                <span className="w-32 truncate text-[11.5px] font-semibold text-[#557d78]">{[r.assignee ?? tx("noAgent"), r.team].filter(Boolean).join(" · ")}</span>
                {r.movedTo ? <span className="inline-flex rounded-full border border-[#c9d6ea] bg-[#f2f6fb] px-2 py-0.5 text-[10.5px] font-bold text-[#3d5a80]">{tx("movedTo", { t: r.movedTo })}</span> : null}
                <span className="min-w-[8rem] flex-1 truncate text-[11.5px] text-[#78948f]" title={r.preview}>{r.preview}</span>
                <span className="ms-auto flex items-center gap-1.5">
                  {r.followupId ? (
                    <Link href={`/followups/${r.followupId}`} className={`${BTN} border border-[#f2c9d4] bg-[#fdf3f6] text-[#8a1f3c]`}>{tx("inFollowup")}</Link>
                  ) : (
                    <button type="button" disabled={busy !== null} onClick={() => toFollowup(r.id)} className={`${BTN} border border-[#cfe0d9] bg-white text-[#185045] hover:bg-[#f4f8f6]`}>
                      {busy === r.id ? <Loader2 className="size-3.5 animate-spin" /> : null}
                      {tx("toFollowup")}
                    </button>
                  )}
                  {board.teletelLink ? (
                    <a href={`${board.teletelLink}${r.id}`} target="_blank" rel="noreferrer" title={tx("openTeletel")} aria-label={tx("openTeletel")} className="inline-flex size-8 items-center justify-center rounded-[8px] border border-[#cfe0d9] bg-white text-[#185045] hover:bg-[#f4f8f6]">
                      <ExternalLink className="size-3.5" />
                    </a>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {shown.length > limit ? (
        <button type="button" onClick={() => setLimit(limit + 100)} className="mt-3 text-[12px] font-bold text-[#2aa87a] hover:underline">
          {tx("showMore", { n: shown.length - limit })}
        </button>
      ) : null}
    </section>
  );
}

// ---------- «المتابعة» ----------

function Followups({ board, onChanged }: { board: OkBoard; onChanged: () => void }) {
  const { tx, kind: kindText } = useSlaLabels();
  const wait = useWaitText();
  const when = useWhen();
  const [status, setStatus] = useState<"open" | "done">("open");
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const list = board.followups.filter((f) => f.status === status);
  const unassigned = board.followups.filter((f) => f.status === "open" && !f.assigned_to).length;

  async function autoAssign() {
    setBusy("auto");
    try {
      const r = await assignToTeletelHolders();
      if (r.ok) setNote(tx("fuAutoAssigned", { n: r.assigned }));
      onChanged();
    } finally {
      setBusy(null);
    }
  }

  async function assign(id: string, employeeId: string) {
    setBusy(id);
    try {
      await assignFollowup(id, employeeId || null);
      onChanged();
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className={CARD}>
      <div className="flex flex-wrap items-center gap-1.5">
        {(["open", "done"] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStatus(s)}
            className={`inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[12px] font-bold ${status === s ? "bg-[#185045] text-white" : "border border-[#cfe0d9] bg-white text-[#557d78]"}`}
          >
            {tx(s === "open" ? "fuOpen" : "fuDone")}
            <span className="tv-tnum">{board.followups.filter((f) => f.status === s).length}</span>
          </button>
        ))}
        {unassigned > 0 ? (
          <button type="button" disabled={busy !== null} onClick={autoAssign} className={`${BTN} ms-auto border border-[#cfe0d9] bg-white text-[#185045] hover:bg-[#f4f8f6]`}>
            {busy === "auto" ? <Loader2 className="size-3.5 animate-spin" /> : null}
            {tx("fuAutoAssign")} <span className="tv-tnum">({unassigned})</span>
          </button>
        ) : null}
      </div>
      {note ? <p className="mt-2 text-[12px] font-bold text-[#557d78]">{note}</p> : null}
      {list.length === 0 ? (
        <p className="mt-4 text-[12.5px] font-semibold text-[#93aaa3]">{tx("fuEmpty")}</p>
      ) : (
        <ul className="mt-3 divide-y divide-[#e6eeea] rounded-[10px] border border-[#e3ece8]">
          {list.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-3 py-2.5">
              <span className="min-w-[10rem] flex-1">
                <span className="block truncate text-[13px] font-bold text-[#103f37]">{f.contact_name ?? `#${f.conversation_id}`}</span>
                {f.contact_phone ? <DirText className="block text-[11px] font-semibold text-[#78948f]">{f.contact_phone}</DirText> : null}
              </span>
              <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10.5px] font-bold ${KIND_TONE[f.kind]}`}>
                {kindText(f.kind)}
                {f.rule_name ? ` · ${f.rule_name}` : ""}
              </span>
              <span className="tv-tnum text-[11.5px] font-semibold text-[#557d78]">
                {f.waited_minutes != null ? tx("fuWaited", { w: wait(f.waited_minutes) }) : null}
                <span className="block text-[#93aaa3]">{tx("fuSince", { t: when(f.created_at) })}</span>
              </span>
              <span className="text-[11.5px] font-semibold text-[#557d78]">{f.teletel_assignee ?? tx("noAgent")}</span>
              {f.status === "open" ? (
                <label className="flex items-center gap-1.5 text-[11.5px] font-bold text-[#557d78]">
                  {tx("fuAssign")}
                  <select value={f.assigned_to ?? ""} disabled={busy === f.id} onChange={(e) => assign(f.id, e.target.value)} className={SELECT}>
                    <option value="">{tx("fuUnassigned")}</option>
                    {board.employees.map((e) => (
                      <option key={e.id} value={e.id}>{e.name}</option>
                    ))}
                  </select>
                </label>
              ) : (
                <span className="text-[11.5px] font-semibold text-[#0f7a52]">
                  {tx("fuDoneBy", { n: f.done_name ?? "—", t: f.done_at ? when(f.done_at) : "" })}
                  {f.note ? <span className="block text-[#557d78]">{f.note}</span> : null}
                </span>
              )}
              {f.replied_at ? <span className="tv-tnum text-[11px] font-bold text-[#0f7a52]">{tx("fuReplied", { t: when(f.replied_at) })}</span> : null}
              <Link href={`/followups/${f.id}`} className={`${BTN} ms-auto bg-[#185045] text-white hover:bg-[#0f4439]`}>{tx("fuOpenThread")}</Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ---------- the rules ----------

type Draft = Omit<SlaRule, "id"> & { id?: string; key: string };

type Team = { id: number; name: string };

function Rules({ rules, teams, suggestions, onChanged }: { rules: SlaRule[]; teams: Team[]; suggestions: Suggestion[]; onChanged: () => void }) {
  const { tx, kind: kindText } = useSlaLabels();
  const [added, setAdded] = useState<Draft[]>([]);
  const add = (kind: SlaKind) =>
    setAdded((a) => [
      ...a,
      { key: `new-${Date.now()}`, kind, name: "", amount: 1, unit: "hour", color: "#d99a00", to_followup: false, teletel_team_id: null, teletel_team_name: null, active: true },
    ]);

  return (
    <section className={CARD}>
      <Suggestions suggestions={suggestions} onChanged={onChanged} />
      <p className="mt-4 text-[12.5px] font-semibold leading-6 text-[#557d78]">{tx("rulesHint")}</p>
      <div className="mt-3 grid gap-4">
        {SLA_KINDS.map((k) => {
          const mine = rules.filter((r) => r.kind === k).sort((a, b) => ruleMinutes(a) - ruleMinutes(b));
          return (
            <div key={k} className="rounded-[10px] border border-[#e3ece8] p-3">
              <h3 className="text-[13px] font-extrabold text-[#185045]">
                {kindText(k)} <span className="text-[11.5px] font-semibold text-[#78948f]">— {tx(`kh_${k}`)}</span>
              </h3>
              <div className="mt-2 grid gap-2">
                {mine.map((r) => (
                  <RuleRow key={r.id} initial={{ ...r, key: r.id }} teams={teams} onChanged={onChanged} />
                ))}
                {added
                  .filter((d) => d.kind === k)
                  .map((d) => (
                    <RuleRow
                      key={d.key}
                      initial={d}
                      teams={teams}
                      onChanged={() => {
                        setAdded((a) => a.filter((x) => x.key !== d.key));
                        onChanged();
                      }}
                      onDiscard={() => setAdded((a) => a.filter((x) => x.key !== d.key))}
                    />
                  ))}
              </div>
              <button type="button" onClick={() => add(k)} className={`${BTN} mt-2 border border-dashed border-[#9fb8b1] bg-white text-[#185045]`}>
                <Plus className="size-3.5" />
                {tx("addRule")}
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** «ينقل إلى»: one place — nowhere, our «المتابعة», or a Teletel team. */
const moveValue = (r: Pick<SlaRule, "to_followup" | "teletel_team_id">) => (r.teletel_team_id ? `team:${r.teletel_team_id}` : r.to_followup ? "system" : "none");

function MoveSelect({ value, teams, onChange }: { value: Pick<SlaRule, "to_followup" | "teletel_team_id" | "teletel_team_name">; teams: Team[]; onChange: (v: Pick<SlaRule, "to_followup" | "teletel_team_id" | "teletel_team_name">) => void }) {
  const { tx } = useSlaLabels();
  // a team the rule names that Teletel no longer lists still shows, so it is never changed silently
  const all = value.teletel_team_id && !teams.some((t) => t.id === value.teletel_team_id) ? [...teams, { id: value.teletel_team_id, name: value.teletel_team_name ?? `#${value.teletel_team_id}` }] : teams;
  return (
    <label className="flex items-center gap-1 text-[11.5px] font-bold text-[#8a1f3c]">
      {tx("moveTo")}
      <select
        value={moveValue(value)}
        onChange={(e) => {
          const v = e.target.value;
          const team = v.startsWith("team:") ? all.find((t) => `team:${t.id}` === v) : undefined;
          onChange({ to_followup: v === "system", teletel_team_id: team?.id ?? null, teletel_team_name: team?.name ?? null });
        }}
        className={SELECT}
      >
        <option value="none">{tx("moveNone")}</option>
        <option value="system">{tx("moveSystem")}</option>
        {all.length > 0 ? (
          <optgroup label={tx("moveTeams")}>
            {all.map((t) => (
              <option key={t.id} value={`team:${t.id}`}>{t.name}</option>
            ))}
          </optgroup>
        ) : null}
      </select>
    </label>
  );
}

/** «قواعد مقترحة بناء على محادثات النظام» — each with what it catches today, added with one press. */
function Suggestions({ suggestions, onChanged }: { suggestions: Suggestion[]; onChanged: () => void }) {
  const { tx, kind: kindText, unit } = useSlaLabels();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  if (suggestions.length === 0) return null;
  const fresh = suggestions.filter((s) => !s.exists);

  async function add(list: Suggestion[], key: string) {
    setBusy(key);
    setMsg(null);
    try {
      for (const s of list) {
        const r = await saveSlaRule(s.replaces ? { ...s.rule, id: s.replaces } : s.rule);
        if (!r.ok) return setMsg(tx("failed"));
      }
      onChanged();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="rounded-[10px] border border-[#f4d9a6] bg-[#fffaf0] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-[13.5px] font-extrabold text-[#7a5a10]">
          <Lightbulb className="size-4" />
          {tx("sgTitle")}
        </h3>
        {fresh.length > 1 ? (
          <button type="button" disabled={busy !== null} onClick={() => add(fresh, "all")} className={`${BTN} bg-[#a86a10] text-white hover:bg-[#8a5608]`}>
            {busy === "all" ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
            {tx("sgAddAll", { n: fresh.length })}
          </button>
        ) : null}
      </div>
      <p className="mt-1 text-[12px] font-semibold leading-6 text-[#8a6a2a]">{tx("sgHint")}</p>
      <ul className="mt-2 grid gap-2 lg:grid-cols-2">
        {suggestions.map((s) => (
          <li key={s.key} className="rounded-[8px] border border-[#f0e2c0] bg-white p-2.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="inline-flex rounded-full border px-2 py-0.5 text-[11.5px] font-bold" style={{ color: s.rule.color, borderColor: `${s.rule.color}55`, background: `${s.rule.color}14` }}>
                {s.rule.name}
              </span>
              <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10.5px] font-bold ${KIND_TONE[s.rule.kind]}`}>{kindText(s.rule.kind)}</span>
              <span className="text-[11.5px] font-bold text-[#557d78]">
                {tx("ruleAfter")} {s.rule.amount} {unit(s.rule.unit, s.rule.amount)} ·{" "}
                {s.rule.teletel_team_name ? tx("sgToTeam", { t: s.rule.teletel_team_name }) : s.rule.to_followup ? tx("moveSystem") : tx("moveNone")}
              </span>
              {s.exists ? (
                <span className="ms-auto text-[11.5px] font-bold text-[#0f7a52]">{tx("sgExists")}</span>
              ) : (
                <button type="button" disabled={busy !== null} onClick={() => add([s], s.key)} className={`${BTN} ms-auto border border-[#e0c48a] bg-white text-[#7a5a10] hover:bg-[#fff7e6]`}>
                  {busy === s.key ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
                  {tx(s.replaces ? "sgReplace" : "sgAdd")}
                </button>
              )}
            </div>
            <p className="mt-1.5 text-[12px] font-semibold leading-6 text-[#557d78]">
              {tx(`sg_${s.key}`, { n: s.hits })} <span className="text-[#93aaa3]">{tx("sgOfKind", { total: s.ofKind })}</span>
            </p>
          </li>
        ))}
      </ul>
      {msg ? <p className="mt-2 text-[12px] font-bold text-[#c22850]">{msg}</p> : null}
    </div>
  );
}

function RuleRow({ initial, teams, onChanged, onDiscard }: { initial: Draft; teams: Team[]; onChanged: () => void; onDiscard?: () => void }) {
  const { tx, unit } = useSlaLabels();
  const [r, setR] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const set = (patch: Partial<Draft>) => {
    setR((x) => ({ ...x, ...patch }));
    setMsg(null);
  };

  async function save() {
    setBusy(true);
    try {
      const res = await saveSlaRule({
        id: r.id,
        kind: r.kind,
        name: r.name,
        amount: Number(r.amount),
        unit: r.unit,
        color: r.color,
        to_followup: r.to_followup,
        teletel_team_id: r.teletel_team_id,
        teletel_team_name: r.teletel_team_name,
        active: r.active,
      });
      if (!res.ok) return setMsg(tx(res.error === "invalid" ? "invalid" : "failed"));
      setMsg(tx("saved"));
      onChanged();
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!r.id) return onDiscard?.();
    if (!window.confirm(tx("confirmDelete", { n: r.name }))) return;
    setBusy(true);
    try {
      const res = await deleteSlaRule(r.id);
      if (res.ok) onChanged();
      else setMsg(tx("failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-[8px] bg-[#f8fbfa] p-2">
      <input value={r.name} onChange={(e) => set({ name: e.target.value })} placeholder={tx("ruleName")} aria-label={tx("ruleName")} className="h-8 min-w-36 flex-1 rounded-[8px] border border-[#cfe0d9] bg-white px-2 text-[12.5px] font-bold text-[#103f37]" />
      <span className="text-[12px] font-bold text-[#557d78]">{tx("ruleAfter")}</span>
      <input type="number" min={1} value={r.amount} onChange={(e) => set({ amount: Number(e.target.value) })} className="tv-tnum h-8 w-20 rounded-[8px] border border-[#cfe0d9] bg-white px-2 text-[12.5px] font-bold" dir="ltr" />
      <select value={r.unit} onChange={(e) => set({ unit: e.target.value as SlaRule["unit"] })} className={SELECT}>
        {SLA_UNITS.map((u) => (
          <option key={u} value={u}>{unit(u, Number(r.amount) || 1)}</option>
        ))}
      </select>
      <label className="flex items-center gap-1 text-[11.5px] font-bold text-[#557d78]">
        {tx("ruleColor")}
        <input type="color" value={r.color} onChange={(e) => set({ color: e.target.value })} className="h-7 w-9 cursor-pointer rounded border border-[#cfe0d9] bg-white" />
      </label>
      <MoveSelect value={r} teams={teams} onChange={(v) => set(v)} />
      <label className="flex items-center gap-1 text-[11.5px] font-bold text-[#557d78]">
        <input type="checkbox" checked={r.active} onChange={(e) => set({ active: e.target.checked })} className="size-4 accent-[#185045]" />
        {tx("ruleActive")}
      </label>
      <button type="button" disabled={busy} onClick={save} className={`${BTN} bg-[#185045] text-white hover:bg-[#0f4439]`}>
        {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
        {tx("save")}
      </button>
      <button type="button" disabled={busy} onClick={remove} title={tx("delete")} aria-label={tx("delete")} className="inline-flex size-8 items-center justify-center rounded-[8px] border border-[#f2c9d4] bg-white text-[#c22850] hover:bg-[#fdf3f6]">
        <Trash2 className="size-3.5" />
      </button>
      {msg ? <span className="text-[11.5px] font-bold text-[#557d78]">{msg}</span> : null}
    </div>
  );
}
