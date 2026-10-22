import { describe, expect, it } from "vitest";
import type { OperationBooking, OperationDocument } from "@/lib/data/operation-bookings";
import type { OperationCard, OperationPayment } from "@/lib/data/operations";
import type { TravelerListItem } from "@/lib/operations/traveler-dto";
import { clientFlight, flightTicketed } from "@/lib/operations/client-booking-state";
import { derivedExecution } from "@/lib/operations/progress";
import { documentPlan, documentsReadiness, dueDocuments, sameDocument, snapshotKey } from "./documents";
import { followUpOf, readWaits, withoutWaits } from "./followup";
import { bookingStepStates, firstOpenStep, itemTone, ownStates, readiness, readyToTravel, staleWaits, stepStates, stepTone } from "./index";
import { kindOnTrip, matchPassport, passportSummary, passportsReadiness, passportsState } from "./passports";
import { clientStatusUnbacked, paidState, paymentPrefill, paymentReadiness } from "./payment";
import { WIZARD_STEPS, type WizardCase } from "./types";

const TODAY = "2026-10-17";

const op = (over: Partial<OperationCard> = {}): OperationCard => ({
  id: "op1",
  offer_id: "of1",
  render_id: null,
  client_status: "confirmed",
  execution_status: "pending_bookings",
  travel_start: "2026-11-10",
  travel_end: "2026-11-16",
  confirm_channel: "phone",
  confirmed_at: "2026-10-01T09:00:00Z",
  note: null,
  serial: "AD-2-7287",
  destination: "تركيا",
  customer_name: "عميل",
  customer_phone: null,
  total: 10000,
  currency: "SAR",
  paid: 0,
  travelers_count: 2,
  partner_name: null,
  partner_id: null,
  ...over,
});

const traveler = (over: Partial<TravelerListItem> = {}): TravelerListItem => ({
  id: "t1",
  traveler_kind: "adult",
  sort: 0,
  display_name: "",
  passport_expiry: "2030-01-01",
  birth_date: "1990-05-05",
  age: null,
  nationality: "SAU",
  visa_status: "not_required",
  has_passport: true,
  has_scan: true,
  has_visa_file: false,
  ...over,
});

const booking = (over: Partial<OperationBooking>): OperationBooking =>
  ({ id: "b1", kind: "hotel", title: "فندق", status: "pending", confirmation_number: null, ...over }) as OperationBooking;

const doc = (over: Partial<OperationDocument>): OperationDocument => ({ id: "d1", kind: "itinerary", booking_id: null, version: 1, token: "tok", revoked_at: null, created_at: TODAY, ...over });

const pay = (amount: number, kind: OperationPayment["kind"] = "deposit"): OperationPayment => ({
  id: `p${amount}`,
  amount,
  currency: "SAR",
  kind,
  method: "transfer",
  reference: null,
  paid_at: TODAY,
  note: null,
  receipt_no: null,
  receipt_token: null,
  has_proof: false,
});

const wizardCase = (over: Partial<WizardCase> = {}): WizardCase => ({
  operation: op(),
  travelers: [traveler({ id: "t1" }), traveler({ id: "t2", birth_date: "1992-01-01" })],
  bookings: [],
  payments: [],
  installments: [],
  documents: [],
  supplierWork: null,
  clientToken: null,
  waits: {},
  readyExceptions: {},
  hasDays: true,
  today: TODAY,
  sold: { adults: 2, children: 0, infants: 0 },
  guide: null,
  ...over,
});

describe("passports", () => {
  it("ages a traveller on the TRAVEL day, not today", () => {
    // 11 today, 12 by the 10th of November — an adult fare
    expect(kindOnTrip({ birth_date: "2014-11-01", traveler_kind: "child" }, op(), TODAY)).toBe("adult");
    expect(kindOnTrip({ birth_date: null, traveler_kind: "child" }, op(), TODAY)).toBe("child");
  });

  it("says when the offer was priced for other people than the passports show", () => {
    const three = wizardCase({ travelers: [traveler({ id: "a" }), traveler({ id: "b" }), traveler({ id: "c", birth_date: "2020-01-01" })] });
    const s = passportSummary(three);
    expect(s.sold).toEqual({ adult: 2, child: 0, infant: 0 });
    expect(s.actual).toEqual({ adult: 2, child: 1, infant: 0 });
    expect(s.mismatch).toBe(true);
    expect(passportsReadiness(three).find((i) => i.key === "count")).toMatchObject({ ok: false, optional: true });
    expect(passportSummary(wizardCase()).mismatch).toBe(false);
  });

  it("flags a passport expiring within six months of the return, and blocks the gate on it", () => {
    const short = wizardCase({ travelers: [traveler({ passport_expiry: "2027-03-01" })], sold: { adults: 1, children: 0, infants: 0 } });
    expect(passportSummary(short).short).toBe(1);
    expect(passportsState(short)).toBe("todo");
    expect(passportsReadiness(short).find((i) => i.key === "passports")?.ok).toBe(false);
  });

  it("is done only with every passport valid and every visa settled", () => {
    expect(passportsState(wizardCase())).toBe("done");
    const visa = wizardCase({ travelers: [traveler({ visa_status: "check" })] });
    expect(passportsState(visa)).toBe("todo");
    expect(passportsReadiness(visa).find((i) => i.key === "visas")?.ok).toBe(false);
    expect(passportsState(wizardCase({ travelers: [] }))).toBe("todo");
  });

  it("gives a passport to its traveller: the same person, the name, then a free row of the kind and age", () => {
    const rows = [
      { id: "lead", display_name: "محمد", traveler_kind: "adult" as const, age: null, birth_date: null, nationality: null, has_passport: false },
      { id: "kid9", display_name: "", traveler_kind: "child" as const, age: 9, birth_date: null, nationality: null, has_passport: false },
      { id: "kid5", display_name: "", traveler_kind: "child" as const, age: 5, birth_date: null, nationality: null, has_passport: false },
      { id: "sara", display_name: "SARA ALI", traveler_kind: "adult" as const, age: null, birth_date: null, nationality: null, has_passport: false },
    ];
    const none = new Set<string>();
    // 5 on the 10th of November
    expect(matchPassport(rows, { full_name: "OMAR ALI", birth_date: "2021-06-01", nationality: "SAU" }, op(), TODAY, none)?.id).toBe("kid5");
    expect(matchPassport(rows, { full_name: "SARA AHMED ALI", birth_date: "1991-01-01", nationality: "SAU" }, op(), TODAY, none)?.id).toBe("sara");
    // an adult with no row of its own takes the first free one — the lead
    expect(matchPassport(rows, { full_name: "X Y", birth_date: "1980-01-01", nationality: "SAU" }, op(), TODAY, new Set(["sara"]))?.id).toBe("lead");
    // the same passport again finds the row it filled, not a new traveller
    const filled = [{ ...rows[0], birth_date: "1980-01-01", nationality: "SAU", has_passport: true }];
    expect(matchPassport(filled, { full_name: "", birth_date: "1980-01-01", nationality: "SAU" }, op(), TODAY, none)?.id).toBe("lead");
    // nobody left: a new traveller
    expect(matchPassport(filled, { full_name: "", birth_date: "1985-01-01", nationality: "SAU" }, op(), TODAY, none)).toBeNull();
  });
});

describe("payment", () => {
  it("prefills the deposit, then the next installment, then the rest as final", () => {
    // house terms: half at confirmation, the rest 14 days before travel
    expect(paymentPrefill(wizardCase())).toMatchObject({ amount: 5000, kind: "deposit", due_date: "2026-10-01" });
    expect(paymentPrefill(wizardCase({ payments: [pay(5000)] }))).toMatchObject({ amount: 5000, kind: "final", due_date: "2026-10-27" });
    expect(paymentPrefill(wizardCase({ payments: [pay(2000)] }))).toMatchObject({ amount: 3000, kind: "installment" });
    expect(paymentPrefill(wizardCase({ payments: [pay(10000)] }))).toBeNull();
    expect(paymentPrefill(wizardCase({ operation: op({ total: null }) }))).toBeNull();
  });

  it("follows the agreed schedule when there is one", () => {
    const installments = [
      { id: "i1", due_date: "2026-10-05", amount: 3000, note: null },
      { id: "i2", due_date: "2026-10-20", amount: 3000, note: null },
      { id: "i3", due_date: "2026-11-01", amount: 4000, note: null },
    ];
    expect(paymentPrefill(wizardCase({ installments, payments: [pay(3000)] }))).toMatchObject({ amount: 3000, kind: "installment", due_date: "2026-10-20" });
  });

  it("reads paid / partly / unpaid from the recorded payments, not the client track", () => {
    expect(paidState(10000, 0)).toBe("unpaid");
    expect(paidState(10000, 4000)).toBe("partial");
    expect(paidState(10000, 10000)).toBe("paid");
    // «مسدّد جزئياً» by hand on 0 SAR recorded (2026-10-17)
    expect(clientStatusUnbacked("paid_partial", 10000, 0)).toBe(true);
    expect(clientStatusUnbacked("paid_full", 10000, 4000)).toBe(true);
    expect(clientStatusUnbacked("paid_partial", 10000, 4000)).toBe(false);
    expect(clientStatusUnbacked("confirmed", 10000, 0)).toBe(false);
  });

  it("lets a manager's exception through the gate", () => {
    expect(paymentReadiness(wizardCase())[0].ok).toBe(false);
    expect(paymentReadiness(wizardCase({ readyExceptions: { payment: { by: "e1", at: TODAY } } }))[0].ok).toBe(true);
    expect(paymentReadiness(wizardCase({ payments: [pay(10000)] }))[0].ok).toBe(true);
  });
});

describe("documents", () => {
  it("issues ONE hotel voucher, once every hotel holds its FINAL confirmation — confirmed and its number (2026-10-22)", () => {
    const bookings = [
      booking({ id: "h1", status: "confirmed", confirmation_number: "HX-1" }),
      booking({ id: "h2", status: "confirmed", confirmation_number: " " }),
      booking({ id: "h3", status: "pending" }),
      booking({ id: "h4", status: "cancelled", confirmation_number: "C" }),
    ];
    const vouchers = (b: typeof bookings, documents: ReturnType<typeof doc>[] = []) =>
      documentPlan(wizardCase({ bookings: b, documents })).filter((l) => l.kind === "hotel_voucher").map((l) => [l.booking_id, l.state, l.token]);
    expect(vouchers(bookings)).toEqual([[null, "waiting", undefined]]);
    const final = bookings.map((b) => (b.id === "h4" ? b : { ...b, status: "confirmed" as const, confirmation_number: `HX-${b.id}` }));
    expect(vouchers(final)).toEqual([[null, "due", undefined]]);
    // an older single-hotel voucher is not the file's voucher
    expect(vouchers(final, [doc({ kind: "hotel_voucher", booking_id: "h1", token: "v1" })])).toEqual([[null, "due", undefined]]);
    expect(vouchers(final, [doc({ kind: "hotel_voucher", token: "v2" })])).toEqual([[null, "issued", "v2"]]);
  });

  it("issues the ticket once every flight is confirmed, the itinerary with its days, the sign with a transfer", () => {
    const flights = [booking({ id: "f1", kind: "flight", status: "confirmed", pnr: "ABC123" }), booking({ id: "f2", kind: "flight", status: "pending" })];
    expect(dueDocuments(wizardCase({ bookings: flights })).map((l) => l.kind)).toEqual(["itinerary"]);
    // confirmed is not enough without the ticket's numbers
    const unticketed = flights.map((f) => ({ ...f, status: "confirmed" as const }));
    expect(dueDocuments(wizardCase({ bookings: unticketed })).map((l) => l.kind)).toEqual(["itinerary"]);
    const all = [...unticketed.map((f) => ({ ...f, ticket_numbers: ["065-1234567890"] })), booking({ id: "tr", kind: "transport", status: "pending" })];
    const lead = [traveler({ display_name: "محمد" })];
    expect(dueDocuments(wizardCase({ bookings: all, travelers: lead })).map((l) => l.kind)).toEqual(["flight_ticket", "itinerary", "welcome_board"]);
    expect(dueDocuments(wizardCase({ hasDays: false })).map((l) => l.kind)).toEqual([]);
  });

  it("keeps a hotel voucher waiting while the only number is OURS — the rule issueDocument enforces", () => {
    const ours = booking({ id: "h1", status: "confirmed", confirmation_number: "AD-2-7287-H1", company_ref: "AD-2-7287-H1" });
    expect(documentPlan(wizardCase({ bookings: [ours] }))[0]).toMatchObject({ kind: "hotel_voucher", state: "waiting", why: "hotel_final" });
  });

  it("hands back the paper already out instead of issuing an identical version", () => {
    const snap = { kind: "itinerary", serial: "AD-2-7287", issued_at: "2026-10-16", customer: { name: "عميل", phone: null }, days: [{ day_number: 1, title: "وصول" }] };
    const issued = { id: "d1", booking_id: null, revoked_at: null, created_at: "2026-10-16T08:00:00+00:00", snapshot_json: snap };
    // the same paper: keys in jsonb's order, issued again on another day
    const again = { days: [{ title: "وصول", day_number: 1 }], customer: { phone: null, name: "عميل" }, issued_at: TODAY, serial: "AD-2-7287", kind: "itinerary" };
    expect(snapshotKey(again)).toBe(snapshotKey(snap));
    expect(sameDocument([issued], null, again)?.id).toBe("d1");
    // something it prints changed: a new version
    expect(sameDocument([issued], null, { ...again, days: [{ day_number: 1, title: "وصول وجولة" }] })).toBeNull();
    // revoked, or another hotel's voucher, is not the paper out
    expect(sameDocument([{ ...issued, revoked_at: TODAY }], null, again)).toBeNull();
    expect(sameDocument([{ ...issued, booking_id: "h2" }], "h1", again)).toBeNull();
    // only the latest counts: changed and changed back is a new version
    const later = { ...issued, id: "d2", created_at: "2026-10-17T08:00:00+00:00", snapshot_json: { ...snap, days: [] } };
    expect(sameDocument([issued, later], null, again)).toBeNull();
    expect(sameDocument([later, { ...issued, id: "d3", created_at: "2026-10-17T09:00:00+00:00" }], null, again)?.id).toBe("d3");
  });

  it("counts the documents out only with the one voucher printing every hotel", () => {
    const bookings = [booking({ id: "h1", status: "confirmed", confirmation_number: "1" }), booking({ id: "h2", status: "confirmed", confirmation_number: "2" })];
    const perHotel = [doc({ kind: "hotel_voucher", booking_id: "h1" }), doc({ id: "d3", kind: "hotel_voucher", booking_id: "h2" }), doc({ id: "d2", kind: "itinerary" })];
    expect(documentsReadiness(wizardCase({ bookings, documents: perHotel }))[0].ok).toBe(false);
    const whole = [doc({ kind: "hotel_voucher" }), doc({ id: "d2", kind: "itinerary" })];
    expect(documentsReadiness(wizardCase({ bookings, documents: whole }))[0].ok).toBe(true);
  });
});

describe("the shell", () => {
  it("shows a step waiting until it is done, and lands on the first step with work", () => {
    const data = wizardCase({ waits: { payment: { from: "client", until: "2026-10-18", at: TODAY } } });
    const states = stepStates(data);
    expect(states.passports).toBe("done");
    expect(states.payment).toBe("waiting");
    // this case has no flight, hotel or transport booking — those steps are «na» — so the
    // first step with work is the documents
    expect(firstOpenStep(data)).toBe("documents");
    expect(stepStates(wizardCase({ payments: [pay(10000)], waits: { payment: { from: "client", until: TODAY, at: TODAY } } })).payment).toBe("done");
  });

  it("drops the wait of a step done on any screen — and only that step's", () => {
    const wait = { from: "supplier" as const, until: TODAY, at: TODAY };
    // hotels confirmed on «عرض الكل», flights none on the file, payment still owed
    const data = wizardCase({
      bookings: [booking({ id: "h1", status: "confirmed", confirmation_number: "HX-1" })],
      waits: { hotels: wait, flights: wait, payment: { ...wait, from: "client" } },
    });
    expect(staleWaits(data.waits, ownStates(data))).toEqual(["flights", "hotels"]);
    expect(withoutWaits(data.waits, ["flights", "hotels"])).toEqual({ payment: { ...wait, from: "client" } });
    expect(withoutWaits({ payment: wait }, ["hotels"])).toBeNull();
    // the server after a confirmation: the bookings' steps only — the payment is not its to judge
    const fromBookings = bookingStepStates(data);
    expect(fromBookings.payment).toBeUndefined();
    expect(staleWaits({ ...data.waits, passports: wait }, fromBookings)).toEqual(["flights", "hotels"]);
    // a step still open keeps its wait
    expect(staleWaits({ hotels: wait }, ownStates(wizardCase({ bookings: [booking({ id: "h1", status: "pending" })] })))).toEqual([]);
  });

  it("opens «جاهز للسفر» only on every mandatory item", () => {
    expect(readyToTravel([{ step: "payment", key: "settled", ok: true }, { step: "documents", key: "link", ok: false, optional: true }])).toBe(true);
    expect(readyToTravel(readiness(wizardCase()))).toBe(false);
  });
});

describe("the tiles (2026-10-18): each step coloured by its own readiness", () => {
  const tones = (data: WizardCase) => {
    const states = stepStates(data);
    const items = readiness(data);
    return Object.fromEntries(WIZARD_STEPS.map((s) => [s, stepTone(states[s], items.filter((i) => i.step === s))]));
  };

  it("red for a mandatory item missing, yellow for an optional one or a warning, green when complete, grey with none of it", () => {
    expect(stepTone("todo", [{ step: "hotels", key: "final", ok: false }])).toBe("red");
    // a wait does not soften a blocker — the tile stays the colour of the error
    expect(stepTone("waiting", [{ step: "hotels", key: "final", ok: false }])).toBe("red");
    expect(stepTone("done", [{ step: "documents", key: "documents", ok: true }, { step: "documents", key: "link", ok: false, optional: true }])).toBe("yellow");
    // nothing blocks, the work is not done: travelling unpaid on a manager's exception
    expect(stepTone("todo", [{ step: "payment", key: "settled", ok: true }])).toBe("yellow");
    expect(stepTone("done", [{ step: "payment", key: "settled", ok: true }])).toBe("green");
    expect(stepTone("na", [])).toBe("grey");
  });

  it("colours a whole case — and «جاهز للسفر» opens exactly when no tile is red", () => {
    const open = wizardCase({ bookings: [booking({ id: "h1", status: "confirmed", confirmation_number: "AD-1", company_ref: "AD-1" })] });
    expect(tones(open)).toEqual({ passports: "green", flights: "grey", hotels: "red", transport: "grey", payment: "red", documents: "red" });

    const hotel = booking({ id: "h1", status: "confirmed", confirmation_number: "HX-1" });
    const done = wizardCase({
      bookings: [hotel],
      payments: [pay(10000)],
      documents: [doc({ kind: "hotel_voucher" }), doc({ id: "d2", kind: "itinerary" })],
    });
    // the documents are out; the link, the sign and the guide are optional — yellow, not red
    expect(tones(done)).toEqual({ passports: "green", flights: "grey", hotels: "green", transport: "grey", payment: "green", documents: "yellow" });

    for (const data of [open, done, wizardCase(), wizardCase({ travelers: [] })]) {
      expect(readyToTravel(readiness(data))).toBe(!Object.values(tones(data)).includes("red"));
    }
  });

  it("colours each item by its own state, not its tile's: a done link stays green under a red documents tile", () => {
    const items = readiness(wizardCase({ clientToken: "tok" })).filter((i) => i.step === "documents");
    expect(stepTone("todo", items)).toBe("red");
    expect(Object.fromEntries(items.map((i) => [i.key, itemTone(i)]))).toMatchObject({ documents: "red", link: "green" });
    expect(itemTone({ step: "documents", key: "guide", ok: false, optional: true })).toBe("yellow");
    expect(itemTone({ step: "hotels", key: "overlap", ok: false, optional: true, warning: true })).toBe("yellow");
    expect(itemTone({ step: "hotels", key: "final", ok: true })).toBe("green");
    // a warning alone never turns a tile red, nor blocks «جاهز للسفر»
    expect(stepTone("done", [{ step: "hotels", key: "final", ok: true }, { step: "hotels", key: "overlap", ok: false, optional: true, warning: true }])).toBe("yellow");
    expect(readyToTravel([{ step: "transport", key: "tour_times", ok: false, optional: true, warning: true }])).toBe(true);
  });
});

describe("one flight-done rule (2026-10-18)", () => {
  it("a flight confirmed by hand with its number in «عرض الكل» is done everywhere — the step, the ticket, the link, the ladder", () => {
    const byHand = booking({ id: "f1", kind: "flight", status: "confirmed", confirmation_number: "6XK2QZ", is_paid: true, title: "الرياض → إسطنبول" });
    const data = wizardCase({ bookings: [byHand] });
    expect(flightTicketed(byHand)).toBe(true);
    expect(stepStates(data).flights).toBe("done");
    expect(readiness(data).find((i) => i.step === "flights")?.ok).toBe(true);
    expect(documentPlan(data).find((l) => l.kind === "flight_ticket")?.state).toBe("due");
    expect(clientFlight({ ...byHand, detail: {} })).toMatchObject({ ticketed: true, pnr: "6XK2QZ" });
    expect(derivedExecution([byHand], [])).not.toBeNull();
  });

  it("and nothing short of it is: not confirmed, or confirmed with no reference", () => {
    expect(flightTicketed({ status: "pending", confirmation_number: null, pnr: "X7K2QZ", ticket_numbers: ["065-1"] })).toBe(false);
    expect(flightTicketed({ status: "confirmed", confirmation_number: " ", pnr: null, ticket_numbers: [] })).toBe(false);
    // a held seat: the airline's number, not marked «صدرت التذكرة»
    expect(flightTicketed({ status: "confirmed", confirmation_number: "6XK2QZ", pnr: null, ticket_numbers: [], is_paid: false })).toBe(false);
    expect(flightTicketed({ status: "confirmed", confirmation_number: null, pnr: null, ticket_numbers: ["065-1"] })).toBe(true);
  });
});

describe("follow-up today", () => {
  const wait = (until: string) => ({ from: "supplier" as const, until, at: TODAY });

  it("lists the waits whose day has come: grey today, yellow past, red with the trip within a day", () => {
    expect(followUpOf({ hotels: wait("2026-10-20") }, "2026-11-10", TODAY)).toBeNull();
    expect(followUpOf({ hotels: wait(TODAY) }, "2026-11-10", TODAY)?.tone).toBe("grey");
    expect(followUpOf({ hotels: wait("2026-10-15"), flights: wait("2026-10-20") }, "2026-11-10", TODAY)).toMatchObject({ tone: "yellow", steps: [{ step: "hotels" }] });
    // travel tomorrow: every wait, red, whatever its date
    expect(followUpOf({ hotels: wait("2026-10-25") }, "2026-10-18", TODAY)).toMatchObject({ tone: "red", steps: [{ step: "hotels" }] });
    expect(followUpOf({}, "2026-10-18", TODAY)).toBeNull();
  });

  it("drops a malformed stored wait instead of trusting it", () => {
    expect(readWaits({ hotels: { from: "boss", until: TODAY }, payment: { from: "client", until: "tomorrow" }, flights: wait(TODAY) })).toEqual({
      flights: { from: "supplier", until: TODAY, note: null, at: TODAY, by: null },
    });
    expect(readWaits(null)).toEqual({});
  });
});
