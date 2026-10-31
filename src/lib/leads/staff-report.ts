import { fold } from "./sheet";
import { resolvePlace } from "./places";
import type { Place } from "./auto";
import { holderOf, type BucketKey, type Report, type ReportRequest } from "./daily-report";

/**
 * «مطابقة تقريري» (the owner, 2026-10-31): the follow-up employee pastes the daily report she wrote by hand, and each of its
 * figures is set beside the system's for the same day with where the difference comes from — the clients back that day,
 * the requests the system could not classify, the ones that are in one report and not the other — so both she and the
 * system learn until one way of counting is agreed. Pure: reads her text and the system's report, writes nothing.
 */

export type StaffReport = {
  total: number | null;
  counts: Partial<Record<BucketKey, number>>;
  /** «البكجات المستلمة حسب الموظف»: name → count */
  employees: { name: string; count: number }[];
  /** «توزيع البكجات حسب الوجهة»: name as she wrote it → count */
  destinations: { name: string; count: number }[];
};

// the words of each line of her summary, as the staff write them (folded: no hamzas, ة→ه)
const LABELS: [BucketKey, RegExp][] = [
  ["package", /بكج|باقات/],
  ["flight", /طيران/],
  ["visa", /تاشير/],
  ["inquiry", /استفسار/],
  ["hotel", /فندق|فنادق/],
  ["transport", /مواصلات/],
  ["incomplete", /غيرالمكتمل|غيرمكتمل/],
  ["other", /اخرى|اخري/],
];

const clean = (s: string) => s.replace(/[‎‏‪-‮]/g, "");
/** the words of a line without its symbols, folded */
const words = (s: string) => fold(clean(s).replace(/[^\p{L}\s]/gu, " ").trim());
const name = (s: string) => clean(s).replace(/[^\p{L}\s]/gu, " ").replace(/\s+/g, " ").trim();
const num = (s: string) => {
  const m = clean(s).replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).match(/\d+/);
  return m ? Number(m[0]) : null;
};

export function parseStaffReport(text: string): StaffReport {
  const out: StaffReport = { total: null, counts: {}, employees: [], destinations: [] };
  let section: "employees" | "destinations" | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = clean(raw).trim();
    if (!line) continue;
    if (/^[═=\-_─]{3,}$/.test(line.replace(/\s/g, ""))) {
      section = null;
      continue;
    }
    const w = words(line);
    if (w.includes("حسبالموظف")) {
      section = "employees";
      continue;
    }
    if (w.includes("حسبالوجهه")) {
      section = "destinations";
      continue;
    }
    const at = line.indexOf(":");
    if (at < 0) continue;
    const [label, value] = [line.slice(0, at), line.slice(at + 1)];
    const n = num(value);
    if (section === "employees" && /العدد/.test(value) && n !== null) {
      out.employees.push({ name: name(label), count: n });
      continue;
    }
    if (section === "destinations" && n !== null && name(label)) {
      out.destinations.push({ name: name(label), count: n });
      continue;
    }
    if (n === null) continue;
    const lw = words(label);
    if (lw.includes("اجمالي")) out.total = n;
    else {
      const hit = LABELS.find(([, re]) => re.test(lw));
      if (hit && out.counts[hit[0]] === undefined) out.counts[hit[0]] = n;
    }
  }
  return out;
}

export type CompareRow = { label: string; hers: number | null; system: number; reasons: string[] };

const LIST = 8;
const listOf = (rs: ReportRequest[], say: (r: ReportRequest) => string) => {
  const items = rs.slice(0, LIST).map(say);
  return items.join("، ") + (rs.length > LIST ? ` و${rs.length - LIST} غيرها` : "");
};
const where = (r: ReportRequest) => `${r.city?.trim() || r.country?.trim() || r.place?.trim() || "بلا وجهة"} (${holderOf(r)})`;

const BUCKET_LABEL: Record<BucketKey, string> = {
  package: "البكجات",
  flight: "الطيران",
  visa: "التأشيرات",
  inquiry: "الاستفسارات",
  hotel: "الفنادق",
  transport: "المواصلات",
  other: "الطلبات الأخرى",
  incomplete: "غير المكتملة",
};

/** Her figures beside the system's, each with what explains the difference — empty reasons when they agree. */
export function compareReports(hers: StaffReport, report: Report, places: Place[]): CompareRow[] {
  const rows: CompareRow[] = [];
  const all = report.requests;
  const fresh = all.filter((r) => !r.returning);
  const unclear = all.filter((r) => r.bucket === "incomplete");

  // the total: the system adds the clients back that day; her report counts the day's new conversations
  const totalReasons: string[] = [];
  if (hers.total !== null && hers.total !== report.total) {
    if (report.returning > 0) totalReasons.push(`النظام يضيف ${report.returning} عميلاً عاد للمحادثة هذا اليوم — بدونهم الطلبات الجديدة ${fresh.length}.`);
    const gap = hers.total - fresh.length;
    if (gap < 0) totalReasons.push(`حتى بدون العائدين، عند النظام ${-gap} طلباً جديداً أكثر — قد تكون محادثات لم تدخل التقرير اليدوي.`);
    if (gap > 0) totalReasons.push(`التقرير اليدوي فيه ${gap} طلباً أكثر من محادثات النظام الجديدة — ربما طلب عُدّ مرتين أو جاء من غير واتساب.`);
  }
  rows.push({ label: "إجمالي الطلبات", hers: hers.total, system: report.total, reasons: totalReasons });

  for (const key of Object.keys(BUCKET_LABEL) as BucketKey[]) {
    const mine = hers.counts[key];
    if (mine === undefined) continue;
    const of = all.filter((r) => r.bucket === key);
    const reasons: string[] = [];
    if (mine !== of.length) {
      const back = of.filter((r) => r.returning).length;
      if (back > 0) reasons.push(`منها ${back} عملاء عادوا — بدونهم ${of.length - back}.`);
      const newOnes = of.length - back;
      if (mine > newOnes && key !== "incomplete" && unclear.length > 0)
        reasons.push(`لم يصنّف النظام ${unclear.length} طلباً («غير مكتمل») — والأرجح أن ${Math.min(mine - newOnes, unclear.length)} منها ${BUCKET_LABEL[key]} عرفتِها من المحادثة.`);
      if (key === "incomplete" && mine < of.length) reasons.push("النظام لا يقرأ المحادثة كاملة — ما عرفتِ طلبه يُصنّف من «مراجعة وتصحيح».");
      if (mine < newOnes) reasons.push(`عند النظام في هذا القسم: ${listOf(of.filter((r) => !r.returning), where)} — ابحثي عمّا لم يدخل تقريرك.`);
      if (mine > of.length && unclear.length === 0) reasons.push("طلبات في تقريرك ليست في هذا القسم عند النظام — صنّفيها من «مراجعة وتصحيح».");
    }
    rows.push({ label: BUCKET_LABEL[key], hers: mine, system: of.length, reasons });
  }

  // packages by the seller they were given to
  const packages = all.filter((r) => r.bucket === "package");
  const byName = new Map<string, { name: string; hers: number | null; mine: ReportRequest[] }>();
  for (const e of hers.employees) byName.set(fold(e.name), { name: e.name, hers: e.count, mine: [] });
  for (const r of packages) {
    const k = fold(clean(holderOf(r)));
    const g = byName.get(k) ?? { name: holderOf(r), hers: null, mine: [] };
    g.mine.push(r);
    byName.set(k, g);
  }
  for (const g of byName.values()) {
    const reasons: string[] = [];
    if ((g.hers ?? 0) !== g.mine.length) {
      if (g.hers === null) reasons.push("ليس في تقريرك.");
      if (g.mine.length > 0) reasons.push(`عند النظام: ${listOf(g.mine, (r) => `${r.city?.trim() || r.country?.trim() || "بلا وجهة"}${r.returning ? " (عاد)" : ""}`)}.`);
      else reasons.push("النظام لم يُسند له بكجاً هذا اليوم — ربما أُسند الطلب لغيره في تيلي تيل أو صُنّف غير مكتمل.");
    }
    rows.push({ label: `بكجات ${g.name}`, hers: g.hers, system: g.mine.length, reasons });
  }

  // packages by destination — her names understood as the system's countries («صبنجة» → تركيا)
  const country = (n: string) => {
    const p = resolvePlace(n, places);
    return p.kind === "destination" ? p.country : n;
  };
  const byCountry = new Map<string, { name: string; hers: number | null; system: number; written: string[] }>();
  for (const d of hers.destinations) {
    const c = country(d.name);
    const g = byCountry.get(fold(c)) ?? { name: c, hers: 0, system: 0, written: [] };
    g.hers = (g.hers ?? 0) + d.count;
    if (fold(d.name) !== fold(c)) g.written.push(d.name);
    byCountry.set(fold(c), g);
  }
  for (const r of packages) {
    const c = r.country?.trim() || "غير محددة";
    const g = byCountry.get(fold(c)) ?? { name: c, hers: null, system: 0, written: [] };
    g.system += 1;
    byCountry.set(fold(c), g);
  }
  if (hers.destinations.length > 0)
    for (const g of byCountry.values()) {
      const reasons: string[] = [];
      if (g.written.length) reasons.push(`كتبتِ «${g.written.join("، ")}» ويحسبها النظام ${g.name}.`);
      if ((g.hers ?? 0) !== g.system) reasons.push(g.hers === null ? "ليست في تقريرك." : g.system === 0 ? "لا بكج لهذه الوجهة عند النظام — قد يكون الطلب غير مكتمل أو بوجهة أخرى." : "العدد مختلف — قارني بقائمة «حسب القسم».");
      rows.push({ label: `وجهة ${g.name}`, hers: g.hers, system: g.system, reasons });
    }
  return rows;
}
