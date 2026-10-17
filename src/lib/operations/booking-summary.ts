/**
 * One line per kind of service a confirmed file holds — what the files list
 * shows beside the client: done (every booking confirmed), in progress, or a
 * problem (a booking failed). Cancelled bookings do not count. Pure.
 */
export type ServiceKind = "flight" | "hotel" | "transport" | "service" | "visa";
export type ServiceSummary = { kind: ServiceKind; total: number; confirmed: number; state: "done" | "progress" | "problem" };

const ORDER: ServiceKind[] = ["flight", "hotel", "transport", "service", "visa"];

export function summarizeBookings(rows: { kind: string; status: string }[]): ServiceSummary[] {
  return ORDER.flatMap((kind) => {
    const mine = rows.filter((r) => r.kind === kind && r.status !== "cancelled");
    if (mine.length === 0) return [];
    const confirmed = mine.filter((r) => r.status === "confirmed").length;
    const state = mine.some((r) => r.status === "failed") ? "problem" : confirmed === mine.length ? "done" : "progress";
    return [{ kind, total: mine.length, confirmed, state }];
  });
}
