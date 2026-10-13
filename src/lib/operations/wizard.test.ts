import { describe, expect, it } from "vitest";
import { currentStep, wizardSteps, type WizardInput } from "./wizard";

const base: WizardInput = { bookings: [], travelers: 0, documents: [], clientToken: null, requests: [] };
const b = (id: string, kind: string, status = "pending", assignee_kind = "ops") => ({ id, kind, status, assignee_kind });

describe("from confirmation to travel", () => {
  it("starts by pulling the bookings", () => {
    expect(currentStep(wizardSteps(base))?.key).toBe("pull");
  });

  it("walks travelers → assign → requests → confirm → documents", () => {
    const pulled = { ...base, bookings: [b("h1", "hotel"), b("t1", "transport")] };
    expect(currentStep(wizardSteps(pulled))?.key).toBe("travelers");
    const people = { ...pulled, travelers: 4 };
    expect(wizardSteps(people).find((s) => s.key === "assign")?.left).toBe(2);
    const assigned = { ...people, bookings: [b("h1", "hotel", "pending", "supplier"), b("t1", "transport", "pending", "partner")] };
    expect(currentStep(wizardSteps(assigned))?.key).toBe("requests");
    const sent = { ...assigned, requests: [{ booking_id: "h1", state: "sent" }, { booking_id: "t1", state: "overdue" }] };
    expect(currentStep(wizardSteps(sent))).toMatchObject({ key: "confirm", left: 2 });
    const confirmed = { ...sent, bookings: [b("h1", "hotel", "confirmed", "supplier"), b("t1", "transport", "confirmed", "partner")] };
    expect(currentStep(wizardSteps(confirmed))).toMatchObject({ key: "documents", left: 2 });
    const done = { ...confirmed, documents: [{ kind: "hotel_voucher" }, { kind: "itinerary" }], clientToken: "tok" };
    expect(currentStep(wizardSteps(done))).toBeNull();
  });

  it("does not hold a confirmed booking back for a request, nor count a cancelled one", () => {
    const steps = wizardSteps({ ...base, travelers: 2, bookings: [b("h1", "hotel", "confirmed"), b("x", "service", "cancelled")] });
    expect(steps.find((s) => s.key === "assign")?.done).toBe(true);
    expect(steps.find((s) => s.key === "requests")?.done).toBe(true);
  });
});
