import { describe, expect, it } from "vitest";
import { ALL_PERMISSIONS, type Permission } from "@/lib/roles/roles";
import { noticeRecipients, operationOfPath, type StaffMember } from "./notify-recipients";

/**
 * A notice's button must open for whoever receives it: before this, every
 * linked colleague got the partner and staff registrations, and every case's
 * alerts, and a salesperson tapping one landed on the dashboard.
 */

const OP = "0b7e8a52-5d1f-4c43-9f0e-2a1d6c3b9e41";

const member = (id: string, permissions: readonly Permission[]): StaffMember => ({ id, chatId: id.length, permissions });
/** «كل الصلاحيات»: everything except the developer's key and operations.own (as section-access.test). */
const owner = member("owner", ALL_PERMISSIONS.filter((p) => p !== "developer.access" && p !== "operations.own"));
const ops = member("ops", ["dashboard.employee", "operations.write"]);
const sales = member("sales", ["dashboard.employee", "offers.write", "data.write", "operations.own"]);
const colleague = member("colleague", ["dashboard.employee", "offers.write", "data.write", "operations.own"]);
const nobody = member("nobody", []);
const STAFF = [owner, ops, sales, colleague, nobody];

const ids = (href: string, issuer?: string | null) => noticeRecipients(STAFF, href, issuer).map((s) => s.id);

describe("noticeRecipients", () => {
  it("sends the administration's pages only to who opens them — the owner still gets everything", () => {
    expect(ids("/partner-companies")).toEqual(["owner"]);
    expect(ids("/employees")).toEqual(["owner"]);
    expect(ids("/data-quality")).toEqual(["owner", "sales", "colleague"]);
  });

  it("a case: every file for operations.write, the issuer's own file for operations.own", () => {
    expect(ids(`/operations/${OP}`, "sales")).toEqual(["owner", "ops", "sales"]);
    expect(ids(`/operations/${OP}`, "colleague")).toEqual(["owner", "ops", "colleague"]);
    // no issuer (unread, or nobody's offer): own-files holders are left out, never let in
    expect(ids(`/operations/${OP}`, null)).toEqual(["owner", "ops"]);
  });

  it("an unlisted page stays open to everyone", () => {
    expect(ids("/dashboard")).toEqual(STAFF.map((s) => s.id));
  });

  it("finds the case a link opens, and only a case", () => {
    expect(operationOfPath(`/operations/${OP}`)).toBe(OP);
    expect(operationOfPath(`/operations/${OP}?tab=bookings`)).toBe(OP);
    expect(operationOfPath("/operations/cashflow")).toBeNull();
    expect(operationOfPath("/operations")).toBeNull();
    expect(operationOfPath(`/offers/${OP}`)).toBeNull();
  });
});
