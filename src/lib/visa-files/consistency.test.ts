import { describe, expect, it } from "vitest";
import { TRANSITIONS } from "./rules";
import { NEXT_STATUS } from "./ui";
import { VISA_STATUSES } from "./types";

describe("the screens and the server agree", () => {
  it("every step the screens offer is one the server accepts", () => {
    for (const from of VISA_STATUSES) for (const to of NEXT_STATUS[from]) expect(TRANSITIONS[from], `${from} → ${to}`).toContain(to);
  });
});
