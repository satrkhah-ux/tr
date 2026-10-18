import { describe, expect, it } from "vitest";
import type { OperationBooking } from "@/lib/data/operation-bookings";
import { checkNames } from "./flights";
import { hotelDiffs, hotelsReadiness, hotelsState, isFinal, parseHotelConfirmation } from "./hotels";
import type { WizardCase } from "./types";

const booking = (p: Partial<OperationBooking>): OperationBooking =>
  ({ id: "h", kind: "hotel", status: "pending", title: "", detail: {}, confirmation_number: null, ...p }) as OperationBooking;
const wcase = (bookings: OperationBooking[]) => ({ bookings }) as unknown as WizardCase;
const NOW = new Date("2026-10-17T00:00:00Z");

describe("the step's state and «التأكيد النهائي»", () => {
  it("is final only when confirmed AND holding the hotel's number — our company_ref is not it", () => {
    const ours = "AD-2-7287-20261012-H1";
    expect(isFinal({ status: "confirmed", confirmation_number: "554871203", company_ref: ours })).toBe(true);
    expect(isFinal({ status: "confirmed", confirmation_number: " ", company_ref: ours })).toBe(false);
    expect(isFinal({ status: "pending", confirmation_number: "554871203", company_ref: ours })).toBe(false);
    // only our own number typed as the confirmation — still not the hotel's
    expect(isFinal({ status: "confirmed", confirmation_number: ours, company_ref: ours })).toBe(false);
  });

  it("is na without hotels, done when every live hotel is final", () => {
    expect(hotelsState(wcase([booking({ kind: "flight" })]))).toBe("na");
    const done = booking({ id: "a", status: "confirmed", confirmation_number: "X1" });
    const open = booking({ id: "b" });
    expect(hotelsState(wcase([done, booking({ id: "c", status: "cancelled" })]))).toBe("done");
    expect(hotelsState(wcase([done, open]))).toBe("todo");
    expect(hotelsReadiness(wcase([done, open]))).toEqual([{ step: "hotels", key: "final", ok: false }]);
  });
});

/** Every name and number below is invented. */
const EMAIL = `Dear Partner,
Please find below the reservation confirmation.

Hotel: Novotel Bali Nusa Dua
Hotel Address: Kawasan ITDC Lot SW 1, Nusa Dua, Bali 80363, Indonesia
Hotel Phone: +62 361 848 0555
Booking Reference: TRV-88213
Hotel Confirmation No: 554871203

Lead Guest: Mr Fahad Testuser
Guest Names: Mr Fahad Testuser, Mrs Reem Testuser
Check-in: 03 Nov 2026
Check-out: 07 Nov 2026
Room Type: Superior Double Room   Board: Breakfast
Rooms: 1
Agency Tel: +966 11 000 0000`;

const ARABIC = `تأكيد حجز فندقي
اسم الفندق: فندق هيلتون إسطنبول بومونتي
رقم تأكيد الفندق: HB-7731902
تاريخ الوصول: ١٥/١١/٢٠٢٦
تاريخ المغادرة: ٢٠/١١/٢٠٢٦
نوع الغرفة: غرفة ديلوكس مزدوجة مع إفطار
اسم النزيل: السيد فهد تست
العنوان: شارع كازليتشيشمة رقم 4، شيشلي، إسطنبول
هاتف الفندق: 0090 212 375 3000`;

const VOUCHER = `HOTEL VOUCHER
Booking Ref: TBO/2611/447120          Hotel Confirmation No: 88412-BK
Check-in              Check-out             Nights
Fri, 20 Nov 2026      Tue, 24 Nov 2026      4
Room: 2 x Deluxe Room, Twin
Guests: TESTUSER/FAHAD MR, TESTUSER/REEM MRS
Address: Jalan Pinang 1, Kuala Lumpur
Tel: +60 3 2382 7777
Customer Mobile Phone: +966 50 000 0000`;

describe("reading a hotel's confirmation", () => {
  it("an e-mail: the hotel's own number over the agency's reference, the stay, the room, the guests once each", () => {
    expect(parseHotelConfirmation(EMAIL, NOW)).toEqual({
      confirmation: "554871203",
      check_in: "2026-11-03",
      check_out: "2026-11-07",
      room: "Superior Double Room",
      guests: ["Fahad Testuser", "Reem Testuser"],
      address: "Kawasan ITDC Lot SW 1, Nusa Dua, Bali 80363, Indonesia",
      phone: "+62 361 848 0555",
    });
  });

  it("an Arabic one, Arabic-Indic digits and all", () => {
    expect(parseHotelConfirmation(ARABIC, NOW)).toEqual({
      confirmation: "HB-7731902",
      check_in: "2026-11-15",
      check_out: "2026-11-20",
      room: "غرفة ديلوكس مزدوجة مع إفطار",
      guests: ["فهد تست"],
      address: "شارع كازليتشيشمة رقم 4، شيشلي، إسطنبول",
      phone: "0090 212 375 3000",
    });
  });

  it("a supplier's voucher: dates under column headings, and never the client's mobile for the hotel's phone", () => {
    expect(parseHotelConfirmation(VOUCHER, NOW)).toEqual({
      confirmation: "88412-BK",
      check_in: "2026-11-20",
      check_out: "2026-11-24",
      room: "2 x Deluxe Room, Twin",
      guests: ["TESTUSER/FAHAD", "TESTUSER/REEM"],
      address: "Jalan Pinang 1, Kuala Lumpur",
      phone: "+60 3 2382 7777",
    });
    expect(parseHotelConfirmation("Customer Phone: +966 50 000 0000\nArrival time: 14:00\nDeparture: 24 Nov 2026", NOW)).toMatchObject({
      phone: "",
      check_in: "",
      check_out: "2026-11-24",
    });
  });

  it("shows what differs from the booking — the night, the room, a guest no traveller is", () => {
    const read = parseHotelConfirmation(VOUCHER, NOW);
    const { names } = checkNames(read.guests, [{ id: "t1", label: "Fahad Testuser", names: ["Fahad Testuser"] }]);
    const b = { start_date: "2026-11-20", end_date: "2026-11-23", detail: { "الغرفة": "غرفة ديلوكس — شامل الإفطار", المدينة: "كوالالمبور" } };
    expect(hotelDiffs(read, b, names)).toEqual([
      { key: "checkOut", ours: "2026-11-23", theirs: "2026-11-24" },
      { key: "room", ours: "غرفة ديلوكس — شامل الإفطار", theirs: "2 x Deluxe Room, Twin" },
      { key: "guest", ours: "", theirs: "TESTUSER/REEM" },
    ]);
    // the same room written the same way is no difference
    expect(hotelDiffs({ ...read, check_out: "2026-11-23", room: "غرفة ديلوكس" }, b, [])).toEqual([]);
  });
});
