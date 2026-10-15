import { describe, expect, it } from "vitest";
import { inferDestinations, intlPhone } from "./teletel";

describe("inferDestinations — from labels", () => {
  it("extracts the destination from «رحلة X»", () => {
    expect(inferDestinations(["رحلة جورجيا"], {})).toEqual(["جورجيا"]);
  });
  it("supports برنامج / بكج / باقة prefixes", () => {
    expect(inferDestinations(["برنامج تركيا", "بكج دبي", "باقة ماليزيا"], {})).toEqual([
      "تركيا",
      "دبي",
      "ماليزيا",
    ]);
  });
  it("ignores non-trip labels (never invents)", () => {
    expect(inferDestinations(["VIP", "متابعة", "عميل مميز"], {})).toEqual([]);
  });
  it("deduplicates", () => {
    expect(inferDestinations(["رحلة جورجيا", "رحلة جورجيا"], {})).toEqual(["جورجيا"]);
  });
});

describe("inferDestinations — from attributes", () => {
  it("reads destination-named fields as-is", () => {
    expect(inferDestinations([], { الوجهة: "جورجيا" })).toEqual(["جورجيا"]);
    expect(inferDestinations([], { destination: "Georgia" })).toEqual(["Georgia"]);
  });
  it("strips the trip prefix inside a classification field", () => {
    expect(inferDestinations([], { التصنيف: "رحلة تركيا" })).toEqual(["تركيا"]);
  });
  it("scans other string fields only for trip-prefixed text", () => {
    expect(inferDestinations([], { note: "رحلة جورجيا" })).toEqual(["جورجيا"]);
    expect(inferDestinations([], { note: "عميل قديم" })).toEqual([]);
  });
  it("caps at 4 suggestions", () => {
    const labels = ["رحلة 1", "رحلة 2", "رحلة 3", "رحلة 4", "رحلة 5"];
    expect(inferDestinations(labels, {})).toHaveLength(4);
  });
});

describe("intlPhone — a number as WhatsApp knows it", () => {
  it("gives a Saudi number its country code, whatever way it was typed", () => {
    for (const typed of ["0541638023", "541638023", "+966541638023", "00966 54 163 8023", "966-541638023"]) {
      expect(intlPhone(typed)).toBe("+966541638023");
    }
  });
  it("keeps another country's number as it is, and refuses what is not a number", () => {
    expect(intlPhone("+60 12 345 6789")).toBe("+60123456789");
    expect(intlPhone("123")).toBeNull();
    expect(intlPhone("")).toBeNull();
  });
});
