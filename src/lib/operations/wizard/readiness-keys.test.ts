import { describe, expect, it } from "vitest";
import { ar, en, type TranslationKey } from "@/lib/i18n";
import { readyLabel } from "./index";
import { READINESS_KEYS, WIZARD_STEPS, type ReadinessItem } from "./types";

/**
 * One convention for the readiness keys: short, labelled `wz.ready.<step>.<key>`.
 * The tiles and the morning alerts print these words — a key without them is
 * what showed «تذاكر الطيران — wz.flights.ready» on the gate before 2026-10-18.
 */
describe("every readiness key a step can return has its words", () => {
  const all = WIZARD_STEPS.flatMap((step) => READINESS_KEYS[step].map((key) => ({ step, key, ok: false }) as ReadinessItem));

  it.each(all.map((i) => [readyLabel(i)]))("%s — in Arabic and in English", (label) => {
    const key = label as TranslationKey;
    expect(ar[key]?.trim()).toBeTruthy();
    expect(en[key]?.trim()).toBeTruthy();
    // a label that is its own key is the raw key on the screen
    expect(ar[key]).not.toBe(key);
  });

  it("«مطلوب» says one thing: a mandatory item missing — a red tile, nothing else", () => {
    const said = Object.entries(ar).filter(([, v]) => v === "مطلوب").map(([k]) => k);
    expect(said).toEqual(["wz.tone.red"]);
  });

  it("and every step has its tile's words", () => {
    for (const step of WIZARD_STEPS) expect(ar[`wz.step.${step}` as TranslationKey]).toBeTruthy();
    for (const tone of ["red", "yellow", "green", "grey"]) {
      expect(ar[`wz.tone.${tone}` as TranslationKey]).toBeTruthy();
      expect(en[`wz.tone.${tone}` as TranslationKey]).toBeTruthy();
    }
  });
});
