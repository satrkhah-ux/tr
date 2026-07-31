// TBO certification pack — the eight request/response pairs they ask for.
// Usage: node scripts/tbo-certify.mjs [--case 3] [--no-book]
//
// TBO's "Hotels API Certification Process (JSON)" requires samples of our RQ/RS
// JSON for eight occupancy cases, zipped and mailed to apisupport@tboholidays.com,
// before live credentials are issued:
//
//   1  Room1: 1 adult                    5  Room1: 1 adult + 1 child | Room2: 1 adult
//   2  Room1: 1 adult + 1 child          6  Room1: 1 adult + 2 children | Room2: 2 adults
//   3  Room1: 2 adults + 2 children      7  a booking with supplements (any one case)
//   4  Room1: 1 adult | Room2: 1 adult   8  BookingDetail after a successful booking
//
// Each case runs Search → PreBook → Book → BookingDetail and writes both sides
// of every call to tbo-certification/.
//
// ⚠️ These calls are REAL against the integration environment. TBO states that
// bookings made with test credentials are not real reservations — but nothing
// here should ever be pointed at a live base URL. --no-book stops after PreBook.
//
// ⚠️ DRIFT: the payload shapes below are duplicated from
// src/lib/providers/hotel-supplier.ts (a .mjs script cannot import the TS
// adapter). The fields that carry meaning — PaymentMode "Limit", BookingType
// "Voucher", ClientReferenceId/BookingReferenceId — are pinned by
// src/lib/providers/tbo-booking.test.ts. If you change one, change both.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
for (const line of readFileSync(join(root, ".env.local"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
  if (m && process.env[m[1]] === undefined) {
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    process.env[m[1]] = v;
  }
}

const USER = process.env.TBO_TEST_USERNAME;
const PASS = process.env.TBO_TEST_PASSWORD;
const BASE = (process.env.TBO_TEST_BASE_URL ?? "http://api.tbotechnology.in/TBOHolidays_HotelAPI").replace(/\/+$/, "");
if (!USER || !PASS) {
  console.error("TBO_TEST_USERNAME / TBO_TEST_PASSWORD missing from .env.local");
  process.exit(1);
}
const AUTH = `Basic ${Buffer.from(`${USER}:${PASS}`, "utf8").toString("base64")}`;

const outDir = join(root, "tbo-certification");
mkdirSync(outDir, { recursive: true });

const only = process.argv.includes("--case") ? Number(process.argv[process.argv.indexOf("--case") + 1]) : null;
const noBook = process.argv.includes("--no-book");

// Their own Postman collection's test hotels — known to be bookable in the
// integration environment, which a freshly resolved city code may not be.
const HOTEL_CODES = "1345320,1160804,1157709,1247101,1120548,376565,1345318";
const NATIONALITY = "SA";

/** Check-in far enough out that rates are stable while the pack is reviewed. */
function dates(offsetDays = 45, nights = 3) {
  const start = new Date(Date.now() + offsetDays * 86_400_000);
  const end = new Date(start.getTime() + nights * 86_400_000);
  const iso = (d) => d.toISOString().slice(0, 10);
  return { CheckIn: iso(start), CheckOut: iso(end) };
}

const CASES = [
  { n: 1, label: "Room1: 1 adult", rooms: [{ Adults: 1, Children: 0, ChildrenAges: [] }] },
  { n: 2, label: "Room1: 1 adult + 1 child", rooms: [{ Adults: 1, Children: 1, ChildrenAges: [7] }] },
  { n: 3, label: "Room1: 2 adults + 2 children", rooms: [{ Adults: 2, Children: 2, ChildrenAges: [5, 9] }] },
  { n: 4, label: "Room1: 1 adult | Room2: 1 adult", rooms: [{ Adults: 1, Children: 0, ChildrenAges: [] }, { Adults: 1, Children: 0, ChildrenAges: [] }] },
  { n: 5, label: "Room1: 1 adult + 1 child | Room2: 1 adult", rooms: [{ Adults: 1, Children: 1, ChildrenAges: [6] }, { Adults: 1, Children: 0, ChildrenAges: [] }] },
  { n: 6, label: "Room1: 1 adult + 2 children | Room2: 2 adults", rooms: [{ Adults: 1, Children: 2, ChildrenAges: [4, 8] }, { Adults: 2, Children: 0, ChildrenAges: [] }] },
  { n: 7, label: "Booking with supplements", rooms: [{ Adults: 2, Children: 0, ChildrenAges: [] }], preferSupplements: true },
];

let calls = 0;

async function call(method, body) {
  calls += 1;
  const started = Date.now();
  const res = await fetch(`${BASE}/${method}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { authorization: AUTH, "content-type": "application/json", accept: "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(method === "Book" ? 120_000 : 30_000),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = { _unparsed: text.slice(0, 2000) };
  }
  return { json, http: res.status, code: json?.Status?.Code ?? null, ms: Date.now() - started };
}

function write(caseNo, method, request, response) {
  const stem = join(outDir, `case-${caseNo}-${method}`);
  writeFileSync(`${stem}-RQ.json`, JSON.stringify(request ?? {}, null, 2), "utf8");
  writeFileSync(`${stem}-RS.json`, JSON.stringify(response, null, 2), "utf8");
}

async function runCase(c) {
  const { CheckIn, CheckOut } = dates();
  console.log(`\n── Case ${c.n}: ${c.label}`);

  const searchRq = {
    CheckIn,
    CheckOut,
    HotelCodes: HOTEL_CODES,
    GuestNationality: NATIONALITY,
    PaxRooms: c.rooms,
    ResponseTime: 23,
    IsDetailedResponse: true,
    Filters: { Refundable: false, NoOfRooms: 0, MealType: "All" },
  };
  const search = await call("search", searchRq);
  write(c.n, "Search", searchRq, search.json);
  console.log(`   Search       http=${search.http} code=${search.code} ${search.ms}ms`);
  if (search.code !== 200) return console.log("   ↳ stopped: search did not return 200");

  const hotels = search.json?.HotelResult ?? [];
  // Case 7 wants a rate that carries supplements; fall back to the first bookable
  // rate rather than skipping the case, and say so.
  const pick = (() => {
    if (c.preferSupplements) {
      for (const h of hotels) for (const r of h.Rooms ?? []) if ((r.Supplements ?? []).length > 0) return { h, r };
      console.log("   ↳ no rate with supplements in this response — using the first bookable rate");
    }
    for (const h of hotels) for (const r of h.Rooms ?? []) if (r.BookingCode) return { h, r };
    return null;
  })();
  if (!pick) return console.log("   ↳ stopped: no bookable rate in the search response");

  const prebookRq = { BookingCode: pick.r.BookingCode, PaymentMode: "Limit" };
  const prebook = await call("PreBook", prebookRq);
  write(c.n, "PreBook", prebookRq, prebook.json);
  console.log(`   PreBook      http=${prebook.http} code=${prebook.code} ${prebook.ms}ms`);
  if (prebook.code !== 200) return console.log("   ↳ stopped: prebook did not return 200");

  if (noBook) return console.log("   ↳ --no-book: stopping before Book");

  const room = prebook.json?.HotelResult?.[0]?.Rooms?.[0] ?? pick.r;
  const clientReference = `TRV-CERT-${c.n}-${Date.now()}`;
  const bookingReference = `${Date.now()}${String(c.n).padStart(4, "0")}`;

  const bookRq = {
    BookingCode: room.BookingCode,
    // One entry per ROOM — TBO reads the array length as the room count.
    CustomerDetails: c.rooms.map((r, i) => ({
      CustomerNames: [
        ...Array.from({ length: r.Adults }, (_, k) => ({
          Title: "Mr",
          FirstName: "TestGuest",
          LastName: `R${i + 1}A${k + 1}`,
          Type: "Adult",
        })),
        ...Array.from({ length: r.Children }, (_, k) => ({
          Title: "Mr",
          FirstName: "TestChild",
          LastName: `R${i + 1}C${k + 1}`,
          Type: "Child",
        })),
      ],
    })),
    ClientReferenceId: clientReference,
    BookingReferenceId: bookingReference,
    TotalFare: room.TotalFare,
    EmailId: "it@traveliun.com",
    PhoneNumber: "966500000000",
    BookingType: "Voucher",
    PaymentMode: "Limit",
  };
  const book = await call("Book", bookRq);
  write(c.n, "Book", bookRq, book.json);
  console.log(`   Book         http=${book.http} code=${book.code} ${book.ms}ms  conf=${book.json?.ConfirmationNumber ?? "—"}`);
  if (book.code !== 200 || !book.json?.ConfirmationNumber) {
    return console.log("   ↳ stopped: no confirmation number");
  }

  // Case 8 IS this call — TBO asks for BookingDetail on any one successful booking.
  const detailRq = { ConfirmationNumber: book.json.ConfirmationNumber, PaymentMode: "Limit" };
  const detail = await call("BookingDetail", detailRq);
  write(c.n, "BookingDetail", detailRq, detail.json);
  write(8, "BookingDetail", detailRq, detail.json);
  console.log(`   BookingDetail http=${detail.http} code=${detail.code} ${detail.ms}ms`);
}

console.log(`TBO certification pack → ${outDir}`);
console.log(`endpoint: ${BASE}`);

for (const c of CASES) {
  if (only && c.n !== only) continue;
  try {
    await runCase(c);
  } catch (err) {
    console.log(`   ✗ case ${c.n} threw — ${err instanceof Error ? err.message : String(err)}`);
  }
}

console.log(`\n${calls} calls. Read the files before zipping them, then send to apisupport@tboholidays.com.`);
