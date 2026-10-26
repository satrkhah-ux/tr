import { describe, expect, it } from "vitest";
import { viewAsPermissions, type Permission } from "@/lib/roles/roles";
import { canSee, employeeWorksVisas, visaCaller, visaPeople, type VisaEmployeeRow } from "./access";

const ME = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

describe("visaCaller — who may do what", () => {
  it("visas.work works files only; visas.manage runs the department and works too", () => {
    expect(visaCaller(["visas.work"], ME)).toEqual({ employeeId: ME, work: true, manage: false });
    expect(visaCaller(["visas.manage"], ME)).toEqual({ employeeId: ME, work: true, manage: true });
  });

  it("the management account passes both without anything granted to it", () => {
    expect(visaCaller(["dashboard.admin"], ME)).toMatchObject({ work: true, manage: true });
    expect(visaCaller(["developer.access"], null)).toMatchObject({ work: true, manage: true });
  });

  it("anybody else has no access at all", () => {
    expect(visaCaller(["offers.write", "followups.work"], ME)).toBeNull();
    expect(visaCaller([], ME)).toBeNull();
  });
});

describe("canSee — a file is open to its holder, the pool, and the management", () => {
  const worker = visaCaller(["visas.work"], ME)!;
  const manager = visaCaller(["visas.manage"], OTHER)!;

  it("a worker sees his own and the unassigned, never a colleague's", () => {
    expect(canSee({ assignedTo: ME }, worker)).toBe(true);
    expect(canSee({ assignedTo: null }, worker)).toBe(true);
    expect(canSee({ assignedTo: OTHER }, worker)).toBe(false);
  });

  it("a manager sees every file", () => {
    expect(canSee({ assignedTo: ME }, manager)).toBe(true);
    expect(canSee({ assignedTo: null }, manager)).toBe(true);
  });

  it("a worker without an employee row sees only the pool", () => {
    const orphan = visaCaller(["visas.work"], null)!;
    expect(canSee({ assignedTo: null }, orphan)).toBe(true);
    expect(canSee({ assignedTo: ME }, orphan)).toBe(false);
  });
});

describe("«عرض النظام كـ» (view-as) narrows the department's access too", () => {
  const admin: Permission[] = ["dashboard.admin", "employees.manage", "offers.write", "visas.manage"];
  const developer: Permission[] = [...admin, "developer.access"];

  it("an administrator looking through the sales role gets no visa access, as that role would", () => {
    const asSales = viewAsPermissions(admin, ["dashboard.employee", "offers.write"]) as Permission[];
    expect(visaCaller(asSales, ME)).toBeNull();
  });

  it("looking through a role that only works files, the management becomes a worker — even holding no visa key of its own", () => {
    const asVisaWorker = viewAsPermissions(["dashboard.admin", "employees.manage"], ["visas.work", "offers.write"]) as Permission[];
    expect(asVisaWorker).toEqual(["visas.work"]);
    expect(visaCaller(asVisaWorker, ME)).toEqual({ employeeId: ME, work: true, manage: false });
    expect(canSee({ assignedTo: OTHER }, visaCaller(asVisaWorker, ME)!)).toBe(false);
  });

  it("view-as only narrows: a role's visa keys the real account lacks are not gained", () => {
    const real: Permission[] = ["employees.manage", "offers.write"];
    const asManager = viewAsPermissions(real, ["visas.manage", "offers.write"]) as Permission[];
    expect(visaCaller(asManager, ME)).toBeNull();
    // the implied keys are the management's only: a sales-manager (dashboard.admin without the team) cannot switch at all
    expect(viewAsPermissions(["dashboard.admin", "offers.write"], ["visas.manage"])).toBeNull();
    // the developer, through any role that holds the key
    expect(visaCaller(viewAsPermissions(developer, ["visas.manage"]) as Permission[], ME)).toMatchObject({ manage: true });
  });
});

describe("the people the board lists and the files may be handed to", () => {
  const emp = (id: string, name: string, keys: string[], extra: string[] = [], removed: string[] = [], status = "Active"): VisaEmployeeRow => ({
    id, arabic_name: name, status, extra_permission_keys: extra, removed_permission_keys: removed, roles: { permission_keys: keys },
  });

  it("lists the holders of visas.work/manage, role or extra key, minus a removed one, active only", () => {
    const rows = [
      emp("a", "باء", ["visas.work"]),
      emp("b", "الف", [], ["visas.manage"]),
      emp("c", "جيم", ["visas.work"], [], ["visas.work"]),
      emp("d", "دال", ["visas.work"], [], [], "Suspended"),
      emp("e", "هاء", ["dashboard.admin"]),
    ];
    expect(visaPeople(rows).map((p) => p.id)).toEqual(["b", "a"]);
  });

  it("a file may be handed to anyone who could open it, the management included", () => {
    expect(employeeWorksVisas(emp("e", "هاء", ["dashboard.admin"]))).toBe(true);
    expect(employeeWorksVisas(emp("f", "واو", ["offers.write"]))).toBe(false);
    expect(employeeWorksVisas(emp("g", "زاي", ["visas.work"], [], [], "Suspended"))).toBe(false);
  });
});
