/**
 * Heuristic supplier-package parser: raw PDF/OCR text → typed ExtractedPackage +
 * per-field confidence. Pure module (no I/O) so it is unit-testable and reusable.
 *
 * DESIGN: it NEVER invents a value — a field it cannot read is left empty and
 * given a LOW confidence, which routes it straight into the confidence-gated
 * review. Critical fields (country, cities, nights, hotel, price) always receive
 * a score (0 when unread) so the gate can block auto-advance. Label matching is
 * bilingual (Arabic + English). This deterministic parser is intentionally
 * behind a single function so it can later be swapped for an LLM extractor
 * without touching the rest of the pipeline.
 */

import {
  emptyExtractedPackage,
  type ConfidenceMap,
  type ExtractedCity,
  type ExtractedHotel,
  type ExtractedPackage,
} from "../repackage-types";
import { detectCurrency, normalizeDigits, parseDate, parseInteger, parseMoney, parseNights, parseNumber } from "./arabic";

export type ParseResult = { extracted: ExtractedPackage; confidence: ConfidenceMap };

const BOARD_MAP: { re: RegExp; code: string }[] = [
  { re: /all\s?inclusive|شامل|الشامل|\bAI\b/i, code: "AI" },
  { re: /full\s?board|إقامة كاملة|\bFB\b/i, code: "FB" },
  { re: /half\s?board|نصف إقامة|\bHB\b/i, code: "HB" },
  { re: /bed\s?(?:&|and)?\s?breakfast|إفطار|مبيت وإفطار|\bBB\b/i, code: "BB" },
  { re: /room\s?only|بدون وجبات|\bRO\b/i, code: "RO" },
];

function detectBoard(line: string): string {
  for (const { re, code } of BOARD_MAP) if (re.test(line)) return code;
  return "";
}

/**
 * value after a label like "الوجهة: X" / "Destination - X".
 * The label must START the line (after an optional bullet) AND be followed by an
 * explicit separator — otherwise a word that merely CONTAINS the label (e.g.
 * "الفندقية" contains "فندق") fabricates a bogus entry. Precision over recall:
 * an unmatched field stays empty and the confidence gate routes it to review.
 */
function labelValue(line: string, labels: RegExp): string | null {
  const m = line.match(new RegExp(`^[\\s\\-•*·◦●–—]*(?:${labels.source})\\s*[:：\\-–—]\\s*(.+)$`, "i"));
  return m ? m[1].trim() : null;
}

function firstMatch(lines: string[], labels: RegExp): string | null {
  for (const l of lines) {
    const v = labelValue(l, labels);
    if (v) return v;
  }
  return null;
}

/** Collect bullet/plain lines under a section header until the next blank/header. */
function sectionItems(lines: string[], header: RegExp, stopHeaders: RegExp): string[] {
  const items: string[] = [];
  let inSection = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (header.test(line)) { inSection = true; continue; }
    if (!inSection) continue;
    if (line === "" || stopHeaders.test(line)) { if (line !== "") break; else continue; }
    items.push(line.replace(/^[-•*·◦●–—•]\s*/, "").trim());
  }
  return items.filter(Boolean);
}

const STOP = /^(?:يشمل|لا يشمل|الشروط|الأحكام|الفنادق|الطيران|السعر|الإجمالي|includes?|excludes?|terms|hotels?|flights?|price|total)/i;

export function parseSupplierPackage(rawText: string): ParseResult {
  const text = normalizeDigits(rawText);
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  const out = emptyExtractedPackage();
  const conf: ConfidenceMap = {};

  // ── destination / country ──────────────────────────────────────────────
  const dest = firstMatch(lines, /الوجهة|الرحلة|البرنامج|destination|program/i);
  const country = firstMatch(lines, /البلد|الدولة|country/i);
  if (dest) { out.destination = dest; conf.destination = 0.8; }
  if (country) { out.country = country; conf.country = 0.85; }
  else if (dest) { out.country = dest; conf.country = 0.5; }
  else { conf.country = 0; }
  if (!out.destination && out.country) out.destination = out.country;

  // ── cities + nights ────────────────────────────────────────────────────
  // "المدينة: اسطنبول - 3 ليالٍ" / "Istanbul – 3 nights"
  const cities: ExtractedCity[] = [];
  for (const l of lines) {
    const cityLabel = labelValue(l, /المدينة|مدينة|city/i);
    const nights = parseNights(l);
    if (cityLabel && nights != null) {
      const name = cityLabel.replace(/[-–—:].*$/, "").trim();
      if (name) cities.push({ city_name: name, nights });
    }
  }
  if (cities.length) { out.cities = cities; conf.cities = 0.75; }
  else { conf.cities = 0; }

  // ── trip nights ────────────────────────────────────────────────────────
  const nightsLine = firstMatch(lines, /عدد الليالي|إجمالي الليالي|مدة|nights|duration/i);
  const cityNightsSum = cities.reduce((s, c) => s + (c.nights ?? 0), 0);
  const explicitNights = nightsLine ? parseNights(nightsLine) ?? parseInteger(nightsLine) : null;
  if (explicitNights != null) { out.trip_nights = explicitNights; conf.trip_nights = 0.85; }
  else if (cityNightsSum > 0) { out.trip_nights = cityNightsSum; conf.trip_nights = 0.6; }
  else { conf.trip_nights = 0; }

  // ── dates ──────────────────────────────────────────────────────────────
  const arrLine = firstMatch(lines, /الوصول|تاريخ الوصول|arrival|check.?in/i);
  const depLine = firstMatch(lines, /المغادرة|العودة|departure|check.?out/i);
  const arr = arrLine ? parseDate(arrLine) : null;
  const dep = depLine ? parseDate(depLine) : null;
  if (arr) out.arrival_date = arr.iso;
  if (dep) out.departure_date = dep.iso;
  if (arr || dep) conf.dates = Math.min(arr?.confidence ?? 1, dep?.confidence ?? 1);

  // ── pax ────────────────────────────────────────────────────────────────
  const paxLine = lines.find((l) => /بالغ|كبار|adult/i.test(l));
  if (paxLine) {
    const adults = matchCount(paxLine, /بالغ|كبار|adults?/i);
    const children = matchCount(paxLine, /طفل|أطفال|child/i);
    const infants = matchCount(paxLine, /رضيع|infant/i);
    if (adults != null) out.adults = adults;
    if (children != null) out.children = children;
    if (infants != null) out.infants = infants;
    conf.pax = adults != null ? 0.8 : 0.4;
  }

  // ── hotels ─────────────────────────────────────────────────────────────
  // "فندق: X | نوع الغرفة | HB | 3 ليالٍ" (one hotel per line)
  const hotels: ExtractedHotel[] = [];
  for (const l of lines) {
    const hv = labelValue(l, /الفندق|فندق|hotel/i);
    if (!hv) continue;
    const parts = hv.split(/[|｜/]/).map((p) => p.trim());
    const name = parts[0]?.replace(/[-–—:].*$/, "").trim() ?? "";
    if (!name) continue;
    hotels.push({
      city_name: "",
      hotel_name: name,
      room_type: parts[1] ?? "",
      board: detectBoard(l),
      nights: parseNights(l),
      check_in: null,
      check_out: null,
    });
  }
  if (hotels.length) { out.hotels = hotels; conf.hotels = 0.7; }
  else { conf.hotels = 0; }

  // ── flights ────────────────────────────────────────────────────────────
  for (const l of lines) {
    const fv = labelValue(l, /الطيران|رحلة|flight/i);
    if (!fv) continue;
    const codes = fv.match(/\b[A-Z]{3}\b/g) ?? [];
    out.flights.push({
      airline: fv.replace(/[-–—:].*$/, "").trim(),
      flight_no: (fv.match(/[A-Z]{2}\s?\d{2,4}/) ?? [""])[0].replace(/\s/g, ""),
      from_airport: codes[0] ?? "",
      to_airport: codes[1] ?? "",
      departure_at: null,
      arrival_at: null,
    });
  }
  if (out.flights.length) conf.flights = 0.6;

  // ── includes / excludes / terms ────────────────────────────────────────
  // NOTE: JS \b is ASCII-only — it NEVER matches after an Arabic letter, so the
  // headers use an explicit (?=\s|[:：]|$) lookahead instead of \b.
  out.includes = sectionItems(lines, /^(?:البرنامج يشمل|يشمل|includes?)(?=\s|[:：]|$)/i, STOP);
  out.excludes = sectionItems(lines, /^(?:لا يشمل|غير شامل|excludes?|not included)(?=\s|[:：]|$)/i, STOP);
  out.terms = sectionItems(lines, /^(?:الشروط والأحكام|الشروط|الأحكام|terms|conditions)(?=\s|[:：]|$)/i, STOP);
  if (out.includes.length) conf.includes = 0.65;
  if (out.excludes.length) conf.excludes = 0.65;
  if (out.terms.length) conf.terms = 0.6;

  // ── visas / transfers ──────────────────────────────────────────────────
  const visaItems = sectionItems(lines, /^(?:التأشيرة|الفيزا|visa)(?=\s|[:：]|$)/i, STOP);
  if (visaItems.length) out.visas = visaItems;
  const transferItems = sectionItems(lines, /^(?:المواصلات|التنقلات|transfers?|transport)(?=\s|[:：]|$)/i, STOP);
  if (transferItems.length) out.transfers = transferItems;

  // ── supplier price (our cost) ──────────────────────────────────────────
  const priceLine = lines.find((l) => /(?:الإجمالي|السعر|إجمالي|total|price)/i.test(l) && parseNumber(l) != null);
  if (priceLine) {
    const money = parseMoney(priceLine, detectCurrency(text) ?? "SAR");
    if (money) {
      out.supplier_total = money.amount;
      out.supplier_currency = money.currency ?? "SAR";
      conf.supplier_total = money.confidence;
    }
  } else {
    conf.supplier_total = 0;
  }

  return { extracted: out, confidence: conf };
}

function matchCount(line: string, label: RegExp): number | null {
  // "2 بالغين" or "بالغين 2" or "adults: 2"
  const re = new RegExp(`(?:(\\d+)\\s*(?:${label.source})|(?:${label.source})\\s*[:：]?\\s*(\\d+))`, "i");
  const m = normalizeDigits(line).match(re);
  if (!m) return null;
  const n = m[1] ?? m[2];
  return n ? parseInt(n, 10) : null;
}
