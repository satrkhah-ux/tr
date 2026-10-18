import { describe, expect, it } from "vitest";
import {
  autoReplyAllowed,
  capFor,
  clientTurn,
  decide,
  DEFAULT_DAILY_CAP,
  HOLDING_REPLY,
  isCandidate,
  maskPhone,
  parseAutoPhones,
  parseMuradOutput,
  toTurnMessage,
  turnKey,
  type TurnMessage,
} from "./core";

const NOW = 1_800_000_000;
const MIN = 60;

let seq = 100;
const msg = (over: Partial<TurnMessage> & { ago: number }): TurnMessage => {
  const { ago, ...rest } = over;
  seq += 1;
  return { id: seq, at: NOW - ago, text: "…", fromClient: false, isPrivate: false, template: false, bot: false, ...rest };
};
const client = (ago: number, id?: number) => msg({ ago, fromClient: true, ...(id ? { id } : {}) });
const none = new Set<number>();

const base = {
  conversationId: 7,
  nowSec: NOW,
  muradIds: none,
  logged: new Set<string>(),
  phone: "+966500000001",
  canReply: true,
  flags: { suggest: true, auto: true },
  clientWhatsapp: "all",
  autoList: ["+966511111111"],
  used: 0,
  cap: 300,
};

describe("the five minutes: the client's latest message, unanswered by a human", () => {
  it("acts five minutes after the client's message, not before", () => {
    expect(clientTurn([client(6 * MIN)], NOW, none)).not.toBeNull();
    expect(clientTurn([client(4 * MIN)], NOW, none)).toBeNull();
  });

  it("measures from the LATEST client message (a client still typing is not late)", () => {
    expect(clientTurn([client(9 * MIN), client(3 * MIN)], NOW, none)).toBeNull();
    const last = client(6 * MIN);
    expect(clientTurn([client(12 * MIN), last], NOW, none)?.messageId).toBe(last.id);
  });

  it("a public reply by an agent answers it", () => {
    expect(clientTurn([client(10 * MIN), msg({ ago: 8 * MIN })], NOW, none)).toBeNull();
  });

  it("a private note does not", () => {
    expect(clientTurn([client(10 * MIN), msg({ ago: 8 * MIN, isPrivate: true })], NOW, none)).not.toBeNull();
  });

  it("a WhatsApp template does not", () => {
    expect(clientTurn([client(10 * MIN), msg({ ago: 8 * MIN, template: true })], NOW, none)).not.toBeNull();
  });

  it("a bot does not", () => {
    expect(clientTurn([client(10 * MIN), msg({ ago: 8 * MIN, bot: true })], NOW, none)).not.toBeNull();
  });

  it("Murad's own reply does not — and the turn it answered is already in the log", () => {
    const asked = client(10 * MIN);
    const murad = msg({ ago: 5 * MIN });
    const ids = new Set([murad.id]);
    expect(clientTurn([asked, murad], NOW, ids)?.messageId).toBe(asked.id);
    const d = decide({ ...base, messages: [asked, murad], muradIds: ids, logged: new Set([turnKey(7, asked.id)]) });
    expect(d).toEqual({ act: false, why: "done" });
  });

  it("a client message after a human answer starts a new turn", () => {
    expect(clientTurn([client(30 * MIN), msg({ ago: 20 * MIN }), client(6 * MIN)], NOW, none)).not.toBeNull();
  });

  it("a turn older than a day is left alone (WhatsApp's window, and stale)", () => {
    expect(clientTurn([client(25 * 3600)], NOW, none)).toBeNull();
  });

  it("reads Teletel's own shapes: templates by their params or type, bots by sender, activity dropped", () => {
    expect(toTurnMessage({ id: 1, message_type: 1, additional_attributes: { template_params: { name: "x" } } })?.template).toBe(true);
    expect(toTurnMessage({ id: 2, message_type: 3 })?.template).toBe(true);
    expect(toTurnMessage({ id: 3, message_type: 1, sender_type: "AgentBot" })?.bot).toBe(true);
    expect(toTurnMessage({ id: 4, message_type: 1, sender_type: "user", private: false })).toMatchObject({ template: false, bot: false, isPrivate: false, fromClient: false });
    expect(toTurnMessage({ id: 5, message_type: 2 })).toBeNull();
    expect(toTurnMessage({ id: 6, message_type: 0, attachments: [{}] })).toMatchObject({ fromClient: true, text: "📎" });
  });
});

describe("candidates off the SLA board's list", () => {
  const conv = (over: Partial<{ waitingSince: number; firstReplyAt: number | null; lastActivityAt: number; createdAt: number }>) => ({
    waitingSince: NOW - 10 * MIN,
    firstReplyAt: NOW - 3600,
    lastActivityAt: NOW - 10 * MIN,
    createdAt: NOW - 7200,
    ...over,
  });
  it("the client waits (SLA «waiting» / «first_reply») and the conversation has been quiet five minutes", () => {
    expect(isCandidate(conv({}), NOW, null)).toBe(true);
    expect(isCandidate(conv({ firstReplyAt: null }), NOW, null)).toBe(true);
    expect(isCandidate(conv({ lastActivityAt: NOW - 2 * MIN }), NOW, null)).toBe(false);
  });
  it("we spoke last (SLA «cold»): nothing to do", () => {
    expect(isCandidate(conv({ waitingSince: 0 }), NOW, null)).toBe(false);
  });
  it("nothing new since Murad wrote there: not read again", () => {
    expect(isCandidate(conv({}), NOW, NOW - 10 * MIN + 5)).toBe(false);
    expect(isCandidate(conv({}), NOW, NOW - 30 * MIN)).toBe(true);
  });
});

describe("dedupe: once per client turn", () => {
  it("a turn already logged is never answered again", () => {
    const m = client(6 * MIN);
    expect(decide({ ...base, messages: [m] })).toMatchObject({ act: true, messageId: m.id });
    expect(decide({ ...base, messages: [m], logged: new Set([turnKey(7, m.id)]) })).toEqual({ act: false, why: "done" });
  });
  it("the key is the conversation and the message: the same id elsewhere is another turn", () => {
    const m = client(6 * MIN);
    expect(decide({ ...base, messages: [m], logged: new Set([turnKey(8, m.id)]) }).act).toBe(true);
  });
  it("the client writing again is a new turn", () => {
    const first = client(20 * MIN);
    const again = client(6 * MIN);
    expect(decide({ ...base, messages: [first, again], logged: new Set([turnKey(7, first.id)]) })).toMatchObject({ act: true, messageId: again.id });
  });
});

describe("the auto list: only listed numbers ever get a reply on WhatsApp", () => {
  const gate = { phone: "+966511111111", canReply: true, autoOn: true, clientWhatsapp: "all", autoList: ["+966511111111"] };
  it("a listed number inside the 24 hours, auto on: Murad replies", () => {
    expect(autoReplyAllowed(gate)).toBe(true);
    // however the number was typed
    expect(autoReplyAllowed({ ...gate, phone: "0511111111" })).toBe(true);
    expect(autoReplyAllowed({ ...gate, autoList: ["511111111"] })).toBe(true);
  });
  it("outside the 24 hours, auto off, or client WhatsApp off: no", () => {
    expect(autoReplyAllowed({ ...gate, canReply: false })).toBe(false);
    expect(autoReplyAllowed({ ...gate, autoOn: false })).toBe(false);
    expect(autoReplyAllowed({ ...gate, clientWhatsapp: "off" })).toBe(false);
  });
  it("a number NOT on the list can never receive an auto-reply, whatever else holds", () => {
    const strangers = ["+971511111111", "+966500000001", "0500000002", "+201001234567", "+9715511111111", "", "abc", "111111111"];
    for (const phone of strangers) {
      expect(autoReplyAllowed({ ...gate, phone })).toBe(false);
      const d = decide({ ...base, phone, messages: [client(6 * MIN)], autoList: ["+966511111111"] });
      expect(d.act && d.mode).not.toBe("auto");
    }
    // (the first one shares the listed number's last nine digits: the match is the whole number)
    // an empty list answers nobody
    expect(autoReplyAllowed({ ...gate, autoList: [] })).toBe(false);
  });
  it("everyone else gets a suggestion note — or nothing, with suggestions off", () => {
    expect(decide({ ...base, messages: [client(6 * MIN)] })).toMatchObject({ act: true, mode: "suggest" });
    expect(decide({ ...base, messages: [client(6 * MIN)], flags: { suggest: false, auto: true } })).toEqual({ act: false, why: "off" });
    expect(decide({ ...base, phone: "+966511111111", messages: [client(6 * MIN)] })).toMatchObject({ act: true, mode: "auto" });
    expect(decide({ ...base, phone: "+966511111111", canReply: false, messages: [client(6 * MIN)] })).toMatchObject({ act: true, mode: "suggest" });
  });
  it("the stored list keeps only real numbers, once each", () => {
    expect(parseAutoPhones('["0511111111", "+966511111111", "x", 5]')).toEqual(["+966511111111"]);
    expect(parseAutoPhones("not json")).toEqual([]);
    expect(parseAutoPhones(null)).toEqual([]);
  });
});

describe("the daily cap", () => {
  it("stops at the cap, before the model is asked", () => {
    expect(decide({ ...base, messages: [client(6 * MIN)], used: 299 }).act).toBe(true);
    expect(decide({ ...base, messages: [client(6 * MIN)], used: 300 })).toEqual({ act: false, why: "cap" });
    expect(decide({ ...base, messages: [client(6 * MIN)], used: 0, cap: 0 })).toEqual({ act: false, why: "cap" });
  });
  it("reads murad_daily_cap, the default when unset or unreadable", () => {
    expect(capFor(null)).toBe(DEFAULT_DAILY_CAP);
    expect(capFor("")).toBe(DEFAULT_DAILY_CAP);
    expect(capFor("abc")).toBe(DEFAULT_DAILY_CAP);
    expect(capFor("-5")).toBe(DEFAULT_DAILY_CAP);
    expect(capFor("50")).toBe(50);
    expect(capFor("0")).toBe(0);
  });
});

describe("the model's answer, validated", () => {
  const good = { reply: "هلا والله، وش الوجهة اللي ببالك؟", needs_staff: false, reason: "استفسار جديد", intake: { destination: "جورجيا", dates: "", adults: "2", children: "" } };
  it("a well-formed answer passes, markdown taken out", () => {
    const { result, ok } = parseMuradOutput(JSON.stringify({ ...good, reply: "**هلا** والله\n\n\n\n# وش الوجهة؟" }));
    expect(ok).toBe(true);
    expect(result.reply).toBe("هلا والله\n\nوش الوجهة؟");
    expect(result.intake).toEqual({ destination: "جورجيا", dates: "", adults: "2", children: "" });
  });
  it("an empty intake is left out", () => {
    const { result } = parseMuradOutput(JSON.stringify({ ...good, intake: { destination: "", dates: "", adults: "", children: "" } }));
    expect(result.intake).toBeUndefined();
  });
  it("anything else becomes the holding reply and a hand to staff", () => {
    for (const raw of [null, "", "not json", "[]", JSON.stringify({ ...good, reply: "" }), JSON.stringify({ ...good, reply: 5 }), JSON.stringify({ ...good, needs_staff: "no" }), JSON.stringify({ ...good, reply: "ا".repeat(1300) })]) {
      const { result, ok } = parseMuradOutput(raw);
      expect(ok).toBe(false);
      expect(result).toMatchObject({ reply: HOLDING_REPLY, needsStaff: true });
    }
  });
});

it("masks a phone to its last four digits", () => {
  expect(maskPhone("+966551235050")).toBe("•••• 5050");
  expect(maskPhone(null)).toBe("—");
});
