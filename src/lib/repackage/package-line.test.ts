import { describe, expect, it } from "vitest";
import { isPackageLine, packageLine, packageRef } from "./package-line";
import { georgiaData, georgiaPackage, SUPPLIER_COST } from "./fixture";
import { matchSupplier, supplierContact } from "./supplier-match";

describe("the supplier's package line — the one debt a repackaged case holds", () => {
  it("carries the supplier, its cost in ITS currency, and a ref that is one per offer", () => {
    const line = packageLine("offer-1", georgiaData({ source: { ...georgiaData().source, company_supplier_id: "sup-9", supplier_name: " مورّد تجريبي " } }))!;
    expect(line).toMatchObject({
      origin_ref: packageRef("offer-1"),
      kind: "service",
      quoted_net: SUPPLIER_COST,
      currency: "SAR",
      supplier_name: "مورّد تجريبي",
      assignee_supplier_id: "sup-9",
    });
    expect(packageRef("offer-1")).toBe("package:offer-1");
  });

  it("is in the supplier's currency whatever we sell in", () => {
    const usd = georgiaData({ final_currency: "SAR", extracted: georgiaPackage({ supplier_total: 2000, supplier_currency: "usd" }) });
    expect(packageLine("o", usd)).toMatchObject({ quoted_net: 2000, currency: "USD" });
  });

  it("is internal: undated, with a title that names no supplier", () => {
    const line = packageLine("o", georgiaData())!;
    expect([line.start_date, line.end_date]).toEqual([null, null]);
    expect(line.title).toBe("الباقة كاملة — جورجيا");
    expect(line.title).not.toContain("مورّد");
    expect(line.detail).toEqual({});
  });

  it("is left out when there is no supplier cost to owe", () => {
    expect(packageLine("o", georgiaData({ extracted: georgiaPackage({ supplier_total: null }) }))).toBeNull();
    expect(packageLine("o", georgiaData({ extracted: georgiaPackage({ supplier_total: 0 }) }))).toBeNull();
    expect(packageLine("o", georgiaData({ extracted: null }))).toBeNull();
  });

  it("is recognised by its ref, and only by it — the client-facing readers skip exactly this", () => {
    expect(isPackageLine("package:abc")).toBe(true);
    for (const other of ["hotel:abc", "visa:abc", "transport:1", "tour:تبليسي:0", "flight:intl", "", null, undefined]) {
      expect(isPackageLine(other), String(other)).toBe(false);
    }
  });
});

describe("which registered supplier a repackage's supplier is", () => {
  const list = [
    { arabic_name: "المنار للسياحة", english_name: "Almanar Tourism", status: "Active" },
    { arabic_name: "اون تايم جورجيا", english_name: null, status: "Active" },
    { arabic_name: "فندق قديم", english_name: null, status: "Disabled" },
  ];

  it("meets by name as the catalogue folds names: alef forms, ta marbuta, case and spaces", () => {
    expect(matchSupplier(list, "  المنار  للسياحه ")?.arabic_name).toBe("المنار للسياحة");
    expect(matchSupplier(list, "ALMANAR tourism")?.arabic_name).toBe("المنار للسياحة");
    expect(matchSupplier(list, "اون تايم جورجيا")?.english_name).toBeNull();
  });

  it("is exact, never fuzzy: a near name or an empty one matches nobody", () => {
    expect(matchSupplier(list, "المنار")).toBeNull();
    expect(matchSupplier(list, "")).toBeNull();
    expect(matchSupplier(list, "   ")).toBeNull();
  });

  it("offers a disabled supplier only when nothing else carries the name", () => {
    const twins = [
      { arabic_name: "مورد", english_name: null, status: "Disabled" },
      { arabic_name: "مورد", english_name: "Active one", status: "Active" },
    ];
    expect(matchSupplier(twins, "مورد")?.english_name).toBe("Active one");
    expect(matchSupplier([twins[0]], "مورد")?.status).toBe("Disabled");
  });

  it("a contact is reachable by a number or an email, WhatsApp before the mobile", () => {
    const base = { arabic_name: "م", contact_name: " أحمد ", mobile: null, whatsapp: null, email: null };
    expect(supplierContact(base)).toMatchObject({ reachable: false, phone: null, email: null, person: "أحمد", label: "م" });
    expect(supplierContact({ ...base, mobile: "0500000001" })).toMatchObject({ reachable: true, phone: "0500000001" });
    expect(supplierContact({ ...base, mobile: "0500000001", whatsapp: "0500000002" }).phone).toBe("0500000002");
    expect(supplierContact({ ...base, email: "a@example.test" })).toMatchObject({ reachable: true, email: "a@example.test", phone: null });
  });
});
