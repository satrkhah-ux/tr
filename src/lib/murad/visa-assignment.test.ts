import { describe, it, expect } from "vitest";
import { chooseVisaAgent } from "./visa-assignment";
const agent = { id: 1, name: "موظف", availability_status: "online", confirmed: true, inbox_ids: [75] };
describe("visa assignment selection", () => {
  it("keeps requests in the team when nobody is online", () => {
    expect(chooseVisaAgent([{ ...agent, availability_status: "offline" }, { ...agent, id: 2, availability_status: "busy" }], 75, new Map())).toBeNull();
  });
  it("chooses the least busy eligible team member", () => {
    expect(chooseVisaAgent([agent, { ...agent, id: 2 }], 75, new Map([[1, 9], [2, 3]]))?.id).toBe(2);
  });
  it("does not assign unknown, unconfirmed or inaccessible members", () => {
    expect(chooseVisaAgent([{ ...agent, inbox_ids: [76] }, { ...agent, id: 2, confirmed: false }, { ...agent, id: 3, availability_status: undefined }], 75, new Map())).toBeNull();
    expect(chooseVisaAgent([agent], null, new Map())).toBeNull();
  });
});
