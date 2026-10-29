/**
 * «البدّالة» — the one place a client is given to a colleague (the owner, 2026-10-29: «محرك لتحويل الطلبات وفق قواعد
 * واضحة: يحوّل إلى الموظف الفارغ وغير المشغول … وينظّم العمل 24 ساعة، ويسلّم لمُراد ويسحب منه»). It replaces the
 * shared-login sweep's own picker (shared.ts pickSeller) and the visa team's (visa-assignment chooseVisaAgent):
 *
 *   who takes it   the colleague already holding it when they can; else the one who met or spoke to this client
 *                  («لدي عميل» / «لدي اتصال»); else the available colleague with the fewest clients waiting, then open
 *   who cannot     on leave, outside their working hours (their own shift, else the office's), on a status button,
 *                  offline, paused («لا ترسل لفلان»), a shared login, or without access to the conversation's inbox
 *   when it moves  a client waiting on nobody (no agent, or a shared login) for `orphanMinutes`; a client waiting on a
 *                  colleague who is away (leave, button, offline) for `awayMinutes`. A colleague whose shift ended keeps
 *                  their clients till it starts again; with nobody on shift, nobody is picked and Murad's reception
 *                  holds the client. Never a conversation with a sale or a confirmed service from the colleague who has it.
 *
 * Pure: the colleagues, the loads and the rules are parameters (switchboard.ts reads them).
 */

import type { AvailabilityReason } from "@/lib/presence/availability";

export type Rules = {
  /** on: moves; dry: reports what it would do; off: nothing */
  mode: "on" | "dry" | "off";
  /** Teletel agents that are shared logins, not people */
  sharedAgents: number[];
  /** teams whose only member is such a login */
  sharedTeams: number[];
  /** where a client of no department goes («قسم المبيعات») */
  salesTeam: number;
  /** a client waiting on nobody this long → a colleague */
  orphanMinutes: number;
  /** a client waiting on a colleague who is away this long → another */
  awayMinutes: number;
  /** a colleague already holding this many waiting clients is given no more (0 = no cap) */
  maxWaiting: number;
};

export const RULES_KEY = "switchboard_rules";
export const DEFAULT_RULES: Rules = { mode: "on", sharedAgents: [68], sharedTeams: [28], salesTeam: 38, orphanMinutes: 5, awayMinutes: 15, maxWaiting: 0 };

/** app_settings switchboard_rules; before it is ever saved, the old routing_shared («لا طلب بلا صاحب») still speaks */
export function parseRules(raw: string | null | undefined, legacyShared?: string | null): Rules {
  const ints = (x: unknown, d: number[]) => (Array.isArray(x) && x.every((n) => Number.isInteger(n)) ? (x as number[]) : d);
  const num = (x: unknown, min: number, max: number, d: number) => (typeof x === "number" && Number.isFinite(x) && x >= min && x <= max ? Math.round(x) : d);
  let v: Record<string, unknown> | null = null;
  try {
    v = raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
  } catch {
    v = null;
  }
  if (!v) {
    const legacy = (legacyShared ?? "").trim();
    if (legacy === "off") return { ...DEFAULT_RULES, mode: "off" };
    if (legacy === "dry") return { ...DEFAULT_RULES, mode: "dry" };
    try {
      const o = legacy.startsWith("{") ? (JSON.parse(legacy) as Record<string, unknown>) : {};
      return {
        ...DEFAULT_RULES,
        mode: o.mode === "dry" ? "dry" : "on",
        sharedAgents: ints(o.agents, DEFAULT_RULES.sharedAgents),
        sharedTeams: ints(o.teams, DEFAULT_RULES.sharedTeams),
        salesTeam: Number.isInteger(o.salesTeam) ? (o.salesTeam as number) : DEFAULT_RULES.salesTeam,
        orphanMinutes: num(o.minutes, 1, 120, DEFAULT_RULES.orphanMinutes),
      };
    } catch {
      return DEFAULT_RULES;
    }
  }
  return {
    mode: v.mode === "off" ? "off" : v.mode === "dry" ? "dry" : "on",
    sharedAgents: ints(v.sharedAgents, DEFAULT_RULES.sharedAgents),
    sharedTeams: ints(v.sharedTeams, DEFAULT_RULES.sharedTeams),
    salesTeam: Number.isInteger(v.salesTeam) ? (v.salesTeam as number) : DEFAULT_RULES.salesTeam,
    orphanMinutes: num(v.orphanMinutes, 1, 240, DEFAULT_RULES.orphanMinutes),
    awayMinutes: num(v.awayMinutes, 1, 480, DEFAULT_RULES.awayMinutes),
    maxWaiting: num(v.maxWaiting, 0, 200, DEFAULT_RULES.maxWaiting),
  };
}

export type Candidate = {
  agentId: number;
  name: string;
  /** the colleague behind the agent; null for an agent that is nobody of ours */
  employeeId: string | null;
  available: boolean;
  reason: AvailabilityReason | null;
  paused: boolean;
  /** may open the conversation's inbox (unknown = yes) */
  inboxOk: boolean;
  waiting: number;
  open: number;
};

export type Choice = { candidate: Candidate; why: "holder" | "hint" | "load" };

const usable = (c: Candidate, r: Pick<Rules, "sharedAgents" | "maxWaiting">) =>
  c.available && !c.paused && c.employeeId !== null && !r.sharedAgents.includes(c.agentId) && c.inboxOk && (!r.maxWaiting || c.waiting < r.maxWaiting);

/** who takes the client now — null: nobody can (the department's queue, or Murad, holds them) */
export function pickCandidate(
  cands: Candidate[],
  o: { holderAgentId?: number | null; hintEmployeeId?: string | null },
  r: Pick<Rules, "sharedAgents" | "maxWaiting">,
): Choice | null {
  const ok = cands.filter((c) => usable(c, r));
  const holder = o.holderAgentId != null ? ok.find((c) => c.agentId === o.holderAgentId) : undefined;
  if (holder) return { candidate: holder, why: "holder" };
  const hint = o.hintEmployeeId ? ok.find((c) => c.employeeId === o.hintEmployeeId) : undefined;
  if (hint) return { candidate: hint, why: "hint" };
  const best = [...ok].sort((a, b) => a.waiting - b.waiting || a.open - b.open || a.agentId - b.agentId)[0];
  return best ? { candidate: best, why: "load" } : null;
}

/**
 * Whom to tell when a registered client («لدي عميل» / «لدي اتصال») writes: the colleague it went to for that reason; or —
 * when the client asked for a colleague who cannot take them now (leave, off shift, a button…) and the normal pick took
 * them — that colleague, with whom it went to (`routedTo`). Nobody when the holder kept it or nobody took it.
 */
export function hintNotify(choice: Choice | null | undefined, hint: { employeeId: string; chosen: boolean } | null | undefined): { to: string; routedTo: string | null } | null {
  if (!choice || !hint) return null;
  if (choice.why === "hint") return choice.candidate.employeeId ? { to: choice.candidate.employeeId, routedTo: null } : null;
  return hint.chosen && choice.why === "load" ? { to: hint.employeeId, routedTo: choice.candidate.name } : null;
}

export type Holder = { employeeId: string | null; available: boolean; reason: AvailabilityReason | null };

/**
 * Should this waiting client go to someone else now? «orphan»: nobody holds them (no agent, a shared login, a shared
 * team); «away»: the colleague holding them is away. Never outside the working hours (Murad's reception holds the
 * office), never when the client is not waiting, never a conversation `protectedSale` (the colleague sold it).
 */
export function moveReason(
  c: { assigneeId: number | null; teamId: number | null; waitingSince: number },
  holder: Holder | null,
  r: Rules,
  i: { nowSec: number; working: boolean; protectedSale: boolean },
): "orphan" | "away" | null {
  if (!c.waitingSince || !i.working || r.mode === "off") return null;
  const waited = (i.nowSec - c.waitingSince) / 60;
  const nobody = c.assigneeId === null ? true : r.sharedAgents.includes(c.assigneeId) || !holder?.employeeId;
  if (nobody) return waited >= r.orphanMinutes ? "orphan" : null;
  if (i.protectedSale) return null;
  // an exempt colleague is available; «off_shift» is the whole office (handled above)
  const away = holder && !holder.available && holder.reason !== "off_shift";
  return away && waited >= r.awayMinutes ? "away" : null;
}

export const WHY_TEXT: Record<Choice["why"] | "orphan" | "away", string> = {
  holder: "صاحب المحادثة متاح",
  hint: "سجّل هذا العميل «لدي عميل/لدي اتصال»",
  load: "المتاح الأقل انتظاراً",
  orphan: "العميل ينتظر بلا موظف",
  away: "الموظف غائب (إجازة/زر حالة/غير متصل)",
};
