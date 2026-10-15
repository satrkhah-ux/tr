import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

let granted: string[] = [];
let partner: { name: string } | null = null;
vi.mock("@/lib/roles/RoleContext", () => ({ useRole: () => ({ can: (p: string) => granted.includes(p) }) }));
vi.mock("@/lib/partners/PartnerContext", () => ({ usePartnerBrand: () => partner }));

const { FlightCardLink } = await import("./FlightCardLink");

describe("«تصميم بطاقة الطيران» beside the flights", () => {
  it("opens the tool in a new tab for staff with repackage.write", () => {
    granted = ["repackage.write"];
    partner = null;
    const html = renderToStaticMarkup(<FlightCardLink />);
    expect(html).toContain('href="/repackage/flight-card"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain("تصميم بطاقة الطيران");
  });

  it("is not there without repackage.write, nor ever for a partner", () => {
    granted = ["offers.write", "pricing.view"];
    partner = null;
    expect(renderToStaticMarkup(<FlightCardLink />)).toBe("");
    granted = ["repackage.write"];
    partner = { name: "شركة شريكة" };
    expect(renderToStaticMarkup(<FlightCardLink />)).toBe("");
  });
});
