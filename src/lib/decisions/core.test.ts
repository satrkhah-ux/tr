import { describe, expect, it } from "vitest";
import {
  audienceEmpty,
  audienceLabel,
  dueReminders,
  expandAudience,
  filterArchive,
  inventedNumbers,
  letterEntry,
  mayRead,
  officeDecision,
  parseAudience,
  parseSettings,
  splitTitle,
  tally,
  toggleAudience,
  type ArchiveEntry,
  type Person,
  type RecipientState,
} from "./core";

const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";
const C = "33333333-3333-3333-3333-333333333333";
const SALES = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const VISA = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const people: Person[] = [
  { id: A, name: "رهف ", roleId: SALES, agentId: 10 },
  { id: B, name: "أكرم", roleId: SALES, agentId: 11 },
  { id: C, name: "ريموندا", roleId: VISA, agentId: 20 },
];
// Riyadh = UTC+3
const at = (riyadh: string) => Date.parse(`${riyadh}+03:00`);

describe("recipients", () => {
  it("expands everyone, roles, Teletel teams and people — each employee once, by name", () => {
    expect(
      expandAudience({ all: true }, people, new Map()).map((p) => p.id),
    ).toEqual([B, A, C]);
    expect(
      expandAudience({ roles: [SALES] }, people, new Map()).map((p) => p.name),
    ).toEqual(["أكرم", "رهف"]);
    // the visa team holds agent 20 and 10: ريموندا and رهف; رهف picked by name as well comes once
    expect(
      expandAudience(
        { teams: [5], employees: [A] },
        people,
        new Map([[5, [20, 10]]]),
      ).map((p) => p.id),
    ).toEqual([A, C]);
    // a team Teletel did not answer for means nobody, not everybody
    expect(expandAudience({ teams: [9] }, people, new Map())).toEqual([]);
    expect(expandAudience({}, people, new Map())).toEqual([]);
  });

  it("keeps only well-formed picks, and «الجميع» stands alone", () => {
    expect(parseAudience({ all: true, employees: [A] })).toEqual({ all: true });
    expect(
      parseAudience({
        employees: [A, A, "x"],
        roles: [SALES],
        teams: [3, 3, "4"],
      }),
    ).toEqual({ employees: [A], roles: [SALES], teams: [3] });
    expect(audienceEmpty(parseAudience(null))).toBe(true);
    let a = toggleAudience({}, { role: SALES });
    a = toggleAudience(a, { employee: C });
    expect(a).toEqual({ employees: [C], roles: [SALES], teams: [] });
    expect(toggleAudience(a, { all: true })).toEqual({ all: true });
    expect(toggleAudience({ all: true }, { team: 4 })).toEqual({
      employees: [],
      roles: [],
      teams: [4],
    });
    expect(toggleAudience(a, { employee: C }).employees).toEqual([]);
  });

  it("writes the «إلى» line from what was picked", () => {
    const names = {
      roles: [{ id: SALES, name: "مبيعات" }],
      teams: [{ id: 5, name: "قسم التأشيرات" }],
      people: [{ id: C, name: "ريموندا" }],
    };
    expect(
      audienceLabel({ roles: [SALES], teams: [5], employees: [C] }, names),
    ).toBe("قسم مبيعات · قسم التأشيرات · ريموندا");
    expect(audienceLabel({ all: true }, names)).toBe("جميع موظفي ترافليون");
  });
});

describe("the text", () => {
  it("takes a short first line as the title, else the kind", () => {
    expect(
      splitTitle("**تنظيم الدوام**\nيبدأ الدوام الساعة 9", "تعليمات"),
    ).toEqual({ title: "تنظيم الدوام", body: "يبدأ الدوام الساعة 9" });
    expect(splitTitle("يبدأ الدوام الساعة 9 صباحاً", "تعليمات")).toEqual({
      title: "تعليمات",
      body: "يبدأ الدوام الساعة 9 صباحاً",
    });
  });

  it("refuses a wording that brings a number the issuer did not write", () => {
    expect(
      inventedNumbers(
        "الدوام من 9 إلى ٥ مساءً، والغرامة 1,500",
        "يبدأ الدوام 9 وينتهي 5، وغرامة 1500 ريال",
      ),
    ).toEqual([]);
    expect(
      inventedNumbers(
        "الدوام من 9",
        "يبدأ الدوام 9 ويُخصم 200 ريال اعتباراً من 2026",
      ),
    ).toEqual(["200", "2026"]);
  });
});

describe("reminders", () => {
  const issued = new Date(at("2026-10-29T09:00:00")).toISOString();
  const row = (o: Partial<RecipientState>): RecipientState => ({
    employeeId: A,
    chatId: 1,
    deliveredAt: issued,
    acknowledgedAt: null,
    remindedAt: null,
    reminders: 0,
    ...o,
  });
  const s = { remindHour: 10, remindDays: 7 };

  it("once a day from the hour, to whoever has not acknowledged", () => {
    // the same morning: too soon
    expect(
      dueReminders(issued, [row({})], at("2026-10-29T11:00:00"), s),
    ).toHaveLength(0);
    // next day before 10: not yet
    expect(
      dueReminders(issued, [row({})], at("2026-10-30T09:30:00"), s),
    ).toHaveLength(0);
    // next day 10:05: yes; acknowledged: never
    expect(
      dueReminders(
        issued,
        [row({}), row({ employeeId: B, acknowledgedAt: issued })],
        at("2026-10-30T10:05:00"),
        s,
      ).map((r) => r.employeeId),
    ).toEqual([A]);
  });

  it("never twice the same Riyadh day, and stops after the days", () => {
    const reminded = new Date(at("2026-10-30T10:05:00")).toISOString();
    expect(
      dueReminders(
        issued,
        [row({ remindedAt: reminded, reminders: 1 })],
        at("2026-10-30T23:50:00"),
        s,
      ),
    ).toHaveLength(0);
    // 02:00 Riyadh is the next day but before the hour
    expect(
      dueReminders(
        issued,
        [row({ remindedAt: reminded, reminders: 1 })],
        at("2026-10-31T02:00:00"),
        s,
      ),
    ).toHaveLength(0);
    expect(
      dueReminders(
        issued,
        [row({ remindedAt: reminded, reminders: 1 })],
        at("2026-10-31T10:00:00"),
        s,
      ),
    ).toHaveLength(1);
    expect(
      dueReminders(issued, [row({})], at("2026-11-06T10:00:00"), s),
    ).toHaveLength(0);
    expect(
      dueReminders(issued, [row({})], at("2026-10-30T10:05:00"), {
        remindHour: 0,
        remindDays: 7,
      }),
    ).toHaveLength(0);
  });

  it("reads the settings safely", () => {
    expect(parseSettings("nonsense")).toEqual({
      kinds: ["أمر جديد", "إنذار", "تعليمات", "تعميم", "شكر"],
      remindHour: 10,
      remindDays: 7,
    });
    expect(
      parseSettings(
        JSON.stringify({
          kinds: [" شكر ", "شكر", "", 4],
          remindHour: 25,
          remindDays: 3,
        }),
      ),
    ).toEqual({ kinds: ["شكر"], remindHour: 10, remindDays: 3 });
  });
});

describe("the archive", () => {
  const e = (o: Partial<ArchiveEntry>): ArchiveEntry => ({
    ref: "x",
    source: "decision",
    serial: "ق-2026-0001",
    kind: "تعميم",
    title: "t",
    issuedAt: "2026-10-29T08:00:00.000Z",
    issuer: "م",
    employeeId: A,
    name: "رهف",
    deliveredAt: null,
    openedAt: null,
    acknowledgedAt: null,
    ...o,
  });
  const all = [
    e({ ref: "1" }),
    e({
      ref: "2",
      employeeId: B,
      name: "أكرم",
      acknowledgedAt: "2026-10-29T09:00:00.000Z",
    }),
    e({
      ref: "3",
      employeeId: C,
      kind: "إنذار",
      issuedAt: "2026-10-20T08:00:00.000Z",
    }),
  ];

  it("an employee sees their own only, whatever they ask for", () => {
    expect(
      filterArchive(all, { id: A, manager: false }, {}).map((x) => x.ref),
    ).toEqual(["1"]);
    expect(
      filterArchive(all, { id: A, manager: false }, { employeeId: B }),
    ).toHaveLength(1);
    expect(
      filterArchive(all, { id: A, manager: false }, { employeeId: B })[0]
        .employeeId,
    ).toBe(A);
    expect(mayRead({ id: A, manager: false }, [B, C])).toBe(false);
    expect(mayRead({ id: A, manager: false }, [A])).toBe(true);
    expect(mayRead({ id: A, manager: true }, [])).toBe(true);
  });

  it("the administration filters by employee, kind, date and acknowledgement", () => {
    const m = { id: "m", manager: true };
    expect(filterArchive(all, m, {})).toHaveLength(3);
    expect(filterArchive(all, m, { employeeId: C }).map((x) => x.ref)).toEqual([
      "3",
    ]);
    expect(filterArchive(all, m, { kind: "إنذار" }).map((x) => x.ref)).toEqual([
      "3",
    ]);
    expect(
      filterArchive(all, m, { from: "2026-10-25" })
        .map((x) => x.ref)
        .sort(),
    ).toEqual(["1", "2"]);
    expect(filterArchive(all, m, { ack: "yes" }).map((x) => x.ref)).toEqual([
      "2",
    ]);
    expect(
      filterArchive(all, m, { ack: "no" })
        .map((x) => x.ref)
        .sort(),
    ).toEqual(["1", "3"]);
  });

  it("shows the sales letters in the same archive", () => {
    const l = letterEntry(
      {
        id: 7,
        employee_id: A,
        number: 2,
        warned: true,
        issued_at: "2026-10-24T08:00:00.000Z",
        delivered: true,
        signed_at: null,
      },
      "رهف",
    );
    expect(l).toMatchObject({
      ref: "letter-7",
      source: "letter",
      kind: "إنذار",
      deliveredAt: "2026-10-24T08:00:00.000Z",
      acknowledgedAt: null,
    });
    expect(
      tally([
        { deliveredAt: "x", acknowledgedAt: null },
        { deliveredAt: null, acknowledgedAt: null },
        { deliveredAt: "x", acknowledgedAt: "y" },
      ]),
    ).toEqual({
      issued: 3,
      delivered: 2,
      acknowledged: 1,
      pending: 2,
    });
  });

  it("the office screens get the newest decision for everyone, never a warning", () => {
    const now = Date.parse("2026-10-29T12:00:00.000Z");
    const rows = [
      {
        id: 1,
        kind: "تعميم",
        audience: { all: true },
        issuedAt: "2026-10-28T08:00:00.000Z",
      },
      {
        id: 2,
        kind: "إنذار",
        audience: { all: true },
        issuedAt: "2026-10-29T08:00:00.000Z",
      },
      {
        id: 3,
        kind: "شكر",
        audience: { employees: [A] },
        issuedAt: "2026-10-29T09:00:00.000Z",
      },
      {
        id: 4,
        kind: "تعميم",
        audience: { all: true },
        issuedAt: "2026-09-01T08:00:00.000Z",
      },
    ];
    expect(officeDecision(rows, now)?.id).toBe(1);
    expect(officeDecision(rows.slice(1), now)).toBeNull();
  });
});
