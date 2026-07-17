import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { extractPdfText } from "./pdf-text";
import { parseSupplierPackage } from "./parse";

/**
 * Integration smoke: run the REAL pdf pipeline (unpdf text layer → parser) on a
 * genuine Arabic supplier PDF. The fixture is generated locally with
 * `node scripts/make-test-supplier-pdf.mjs <dir>`; set TEST_SUPPLIER_PDF to its
 * path. Skipped when the fixture is absent (e.g. CI).
 */
const PDF_PATH = process.env.TEST_SUPPLIER_PDF ?? "";
const available = PDF_PATH !== "" && existsSync(PDF_PATH);
const GARBLED_PATH = PDF_PATH.replace(/\.pdf$/i, "-garbled.pdf");
const garbledAvailable = available && existsSync(GARBLED_PATH);

describe.skipIf(!garbledAvailable)("extraction pipeline — browser-printed (garbled) PDF", () => {
  it("flags a presentation-form visual text layer as unreliable", async () => {
    const layer = await extractPdfText(readFileSync(GARBLED_PATH));
    // shaped visual-order Arabic must be routed to OCR/review, never parsed silently
    expect(layer.likelyScanned).toBe(true);
  });
});

describe.skipIf(!available)("extraction pipeline — real Arabic text PDF", () => {
  it("detects a text PDF and extracts the critical fields", async () => {
    const pdf = readFileSync(PDF_PATH);
    const layer = await extractPdfText(pdf);

    expect(layer.likelyScanned).toBe(false);
    expect(layer.pages).toBeGreaterThan(0);

    const { extracted, confidence } = parseSupplierPackage(layer.text);
    // Log the real output so parser regressions are easy to diagnose.
    console.log("[smoke] text length:", layer.text.length);
    console.log("[smoke] extracted:", JSON.stringify(extracted, null, 1));
    console.log("[smoke] confidence:", JSON.stringify(confidence));

    expect(extracted.country).toBe("ماليزيا");
    expect(extracted.cities.map((c) => c.nights)).toEqual([4, 3]);
    expect(extracted.trip_nights).toBe(7);
    expect(extracted.hotels.length).toBe(2);
    expect(extracted.supplier_total).toBe(7500);
    expect(extracted.supplier_currency).toBe("SAR");
    // criticals must be confident enough for the auto-advance path
    expect(confidence.country ?? 0).toBeGreaterThanOrEqual(0.7);
    expect(confidence.cities ?? 0).toBeGreaterThanOrEqual(0.7);
    expect(confidence.supplier_total ?? 0).toBeGreaterThanOrEqual(0.7);
  });
});
