/**
 * The report, said out loud in Saudi Arabic.
 *
 * THE POINT OF THIS FILE: the model does not write this. Templates take the
 * computed numbers and speak them, so «عين الإدارة» cannot invent a figure, round
 * one in its favour, or say "things improved" without arithmetic behind it. The
 * model is used for the free conversation only, and there it is handed this same
 * report as its only source.
 *
 * Numbers are spelled as WORDS for the spoken version: a text-to-speech engine
 * handed «5» in an Arabic sentence will happily say "five" in English, which is
 * exactly the kind of small wrongness that makes a colleague sound like a robot.
 * The written summary keeps digits, because eyes read those faster.
 */

import type { EyeReport, Note } from "./types";

const ONES = [
  "صفر", "واحد", "اثنين", "ثلاثة", "أربعة", "خمسة", "ستة", "سبعة", "ثمانية", "تسعة", "عشرة",
  "أحد عشر", "اثنا عشر", "ثلاثة عشر", "أربعة عشر", "خمسة عشر", "ستة عشر", "سبعة عشر", "ثمانية عشر", "تسعة عشر",
];
const TENS = ["", "", "عشرين", "ثلاثين", "أربعين", "خمسين", "ستين", "سبعين", "ثمانين", "تسعين"];
/**
 * Arabic numerals disagree with their noun on purpose: «خمسة ملفات» but «خمس
 * ساعات». Getting that backwards is the loudest tell that a sentence was made by
 * a machine, so the feminine forms live here rather than being approximated.
 */
const ONES_F = [
  "صفر", "وحدة", "ثنتين", "ثلاث", "أربع", "خمس", "ست", "سبع", "ثمان", "تسع", "عشر",
  "إحدى عشرة", "اثنتا عشرة", "ثلاث عشرة", "أربع عشرة", "خمس عشرة", "ست عشرة", "سبع عشرة", "ثماني عشرة", "تسع عشرة",
];
const HUNDREDS = ["", "مئة", "مئتين", "ثلاثمئة", "أربعمئة", "خمسمئة", "ستمئة", "سبعمئة", "ثمانمئة", "تسعمئة"];

/** 0–999 as Arabic words. Above that we say the digits — nobody counts aloud past it. */
export function say(n: number, feminine = false): string {
  const v = Math.max(0, Math.round(n));
  const ones = feminine ? ONES_F : ONES;
  if (v < 20) return ones[v];
  if (v < 100) {
    const t = TENS[Math.floor(v / 10)];
    const r = v % 10;
    return r === 0 ? t : `${ones[r]} و${t}`;
  }
  if (v < 1000) {
    const h = Math.floor(v / 100);
    // «خمسة مئة» is not a thing anyone says — the hundreds fuse into one word.
    const head = HUNDREDS[h];
    const rest = v % 100;
    return rest === 0 ? head : `${head} و${say(rest, feminine)}`;
  }
  return String(v);
}

/**
 * Arabic counts the noun, not just the number: تذكرة / تذكرتين / تذاكر.
 * Getting this wrong is the difference between a colleague and a form letter.
 */
export function count(n: number, one: string, two: string, many: string, feminine = false): string {
  if (n === 0) return `ما فيه ${many}`;
  if (n === 1) return one;
  if (n === 2) return two;
  if (n <= 10) return `${say(n, feminine)} ${many}`;
  return `${say(n, feminine)} ${one}`;
}

/** «اثنا عشر ألف ريال» — money said the way it is said, not spelled digit by digit. */
export function money(amount: number, currency: string): string {
  const unit = currency === "SAR" ? "ريال" : currency === "USD" ? "دولار" : currency;
  const v = Math.round(amount);
  if (v < 1000) return `${say(v)} ${unit}`;
  const thousands = Math.floor(v / 1000);
  const rest = v % 1000;
  const head =
    thousands === 1 ? "ألف" : thousands === 2 ? "ألفين" : thousands <= 10 ? `${say(thousands)} آلاف` : `${say(thousands)} ألف`;
  return rest === 0 ? `${head} ${unit}` : `${head} و${say(rest)} ${unit}`;
}

function minutesPhrase(minutes: number): string {
  if (minutes < 60) return `${say(minutes, true)} دقيقة`;
  const hours = Math.floor(minutes / 60);
  // Past two days, hours stop meaning anything: «خمسمئة وسبع وأربعين ساعة» is a
  // number people wait out rather than hear. Say it in days.
  if (hours >= 48) return `${count(Math.floor(hours / 24), "يوم", "يومين", "أيام")} تقريباً`;
  const rest = minutes % 60;
  const head = count(hours, "ساعة", "ساعتين", "ساعات", true);
  return rest >= 15 ? `${head} ونص تقريباً` : head;
}

/**
 * «14:30» → «ثنتين ونص بعد الظهر». Nobody says "fourteen thirty" out loud, and a briefing
 * that does is a briefing people stop listening to. Times arrive already in
 * Riyadh hours — see report.ts.
 */
function clock(value: string): string {
  const [rawH, rawM] = value.split(":");
  const h24 = Number(rawH);
  const m = Number(rawM ?? 0);
  const period = h24 < 12 ? "الصبح" : h24 < 16 ? "بعد الظهر" : h24 < 19 ? "العصر" : "بالليل";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const minutes = m === 0 ? "" : m === 30 ? " ونص" : m === 15 ? " وربع" : m === 45 ? " إلا ربع" : ` و${say(m, true)} دقيقة`;
  return `${say(h12, true)}${minutes} ${period}`;
}

/**
 * A note, made sayable.
 *
 * Note titles are written for the eye — digits, and «·» between fields. Read
 * aloud, the digits risk being pronounced in English and the middot lands as an
 * odd silence in the middle of a sentence. Both become words here; the written
 * summary keeps the original.
 */
function spoken(text: string): string {
  return text
    .replace(/\s*·\s*/g, "، ")
    .replace(/\d+/g, (d) => (Number(d) < 1000 ? say(Number(d)) : d));
}

// ---------------------------------------------------------------- spoken ----

export function speechScript(report: EyeReport): string {
  const parts: string[] = [];
  const a = report.attendance;
  const r = report.response;
  const o = report.ops;

  parts.push("هلا والله. معك عين الإدارة، وهذا وضع الشركة اليوم.");

  // ---- attendance ----
  if (a.expected === 0) {
    parts.push("ما عندي بيانات حضور اليوم.");
  } else if (a.absent.length === 0) {
    parts.push(`بالنسبة للحضور، الكل فتح النظام اليوم، ${say(a.present)} من ${say(a.expected)}.`);
  } else if (a.present === 0) {
    // Reading out twelve names to say "nobody" is how a briefing loses its
    // listener in the first sentence.
    parts.push(
      `بالنسبة للحضور، ما أحد فتح النظام اليوم من ${count(a.expected, "موظف", "موظفين", "موظفين")} — ` +
        "وهذا يقيس فتح النظام بس، يمكن يكونون شغّالين على الجوال.",
    );
  } else {
    const names = a.absent.slice(0, 3).join("، ");
    const more = a.absent.length > 3 ? ` وغيرهم` : "";
    const missed = a.absent.length === 1 ? "ما فتحه اليوم" : "ما فتحوه اليوم";
    parts.push(
      `بالنسبة للحضور، ${say(a.present)} من ${say(a.expected)} فتحوا النظام، ` +
        `و${names}${more} ${missed} — وهذا يقيس فتح النظام بس، يمكن يكون شغّال على الجوال.`,
    );
  }
  const longest = [...a.windows].sort((x, y) => y.minutes - x.minutes)[0];
  if (longest) {
    parts.push(`أطول واحد بالنظام ${longest.name}، من ${clock(longest.from)} إلى ${clock(longest.to)}.`);
  }

  // ---- the client-facing delay ----
  if (r.opened === 0 && r.unanswered === 0) {
    parts.push("ما وصلتنا طلبات عناية اليوم.");
  } else {
    parts.push(
      r.opened === 0
        ? "عن العملاء، ما وصلنا طلب جديد اليوم."
        : `عن العملاء، وصلنا ${count(r.opened, "طلب", "طلبين", "طلبات")} اليوم` +
            (r.answered > 0 ? `، ورددنا على ${say(r.answered)}.` : "، وما رددنا على ولا واحد."),
    );
    if (r.unanswered > 0) {
      parts.push(`و${count(r.unanswered, "طلب", "طلبين", "طلبات")} للحين بدون رد.`);
    }
    if (r.avgMinutes != null) {
      parts.push(`متوسط الرد ${minutesPhrase(r.avgMinutes)}.`);
    }
    if (r.worstMinutes != null && r.worstSubject) {
      parts.push(`وأطول تأخير كان ${minutesPhrase(r.worstMinutes)} على «${r.worstSubject}».`);
    }
  }

  // ---- operations ----
  if (o.liveCases === 0) {
    parts.push("ما عندنا ملفات عمليات شغالة الحين.");
  } else {
    // One file is «ملف واحد شغال… ويبي له حركة»; several are «ملفات شغالة… منها».
    // The pronoun has to follow the number or the sentence stops being Arabic.
    const single = o.liveCases === 1;
    parts.push(
      single
        ? `في العمليات، عندنا ملف واحد شغال` +
            (o.needsAction > 0 ? "، ويبي له حركة" : "") +
            (o.critical > 0 ? "، وحالته حرِجة" : "") +
            "."
        : `في العمليات، عندنا ${count(o.liveCases, "ملف", "ملفين", "ملفات")} شغالة، ` +
            `منها ${count(o.needsAction, "ملف", "ملفين", "ملفات")} يبي لها حركة` +
            (o.critical > 0 ? `، و${count(o.critical, "ملف واحد حرِج", "ملفين حرجة", "ملفات حرجة")}` : "") +
            ".",
    );
    if (o.openBookings > 0) {
      parts.push(`و${count(o.openBookings, "حجز", "حجزين", "حجوزات")} لسا ما تأكدت من المورّد.`);
    }
    if (o.travelSoon > 0) {
      parts.push(
        o.travelSoon === 1
          ? "وفيه ملف سفره خلال أسبوع."
          : `و${count(o.travelSoon, "ملف", "ملفين", "ملفات")} سفرها خلال أسبوع.`,
      );
    }
    const worst = o.urgent[0];
    if (worst) {
      parts.push(`أهمها ملف ${worst.customer ?? worst.serial}، والسبب: ${worst.worst}.`);
    }
  }

  // ---- money ----
  const s = report.sales;
  if (s.issuedToday > 0) {
    parts.push(
      `صدر اليوم ${count(s.issuedToday, "عرض", "عرضين", "عروض")}` +
        (s.totalToday ? ` بمجموع ${money(s.totalToday, s.currency)}` : "") +
        (s.confirmedToday > 0 ? `، وتأكد ${count(s.confirmedToday, "عرض", "عرضين", "عروض")}` : "") +
        ".",
    );
  } else {
    parts.push("ما صدر اليوم أي عرض جديد.");
  }

  // ---- the notes: the part that is the whole point ----
  const critical = report.notes.filter((n) => n.severity === "critical");
  const warn = report.notes.filter((n) => n.severity === "warn");
  if (report.notes.length === 0) {
    parts.push("وما عندي ملاحظات اليوم، كل شي ماشي زين.");
  } else {
    parts.push(`عندي ${count(report.notes.length, "ملاحظة", "ملاحظتين", "ملاحظات", true)}.`);
    for (const note of [...critical, ...warn].slice(0, 5)) {
      parts.push(spoken(`${note.title}${note.detail ? `، ${note.detail}` : ""}.`));
    }
    const rest = report.notes.length - Math.min(critical.length + warn.length, 5);
    if (rest > 0) parts.push(`والباقي ${count(rest, "ملاحظة", "ملاحظتين", "ملاحظات", true)} تلقاها مكتوبة.`);
  }

  parts.push("هذا كل شي. لو تبي تفاصيل أي نقطة اسألني.");
  // One sentence per line, not one long paragraph: a speech engine handed a wall
  // of comma-joined text reads it in one flat breath. The line breaks are where
  // it pauses, and pauses are most of what makes a voice sound like a person.
  return parts.join("\n");
}

// --------------------------------------------------------------- written ----

function noteLine(note: Note): string {
  const mark = note.severity === "critical" ? "🔴" : note.severity === "warn" ? "🟠" : "⚪️";
  return `${mark} ${note.title}${note.detail ? ` — <i>${note.detail}</i>` : ""}`;
}

/** The same facts for the eye, with digits. Telegram HTML. */
export function textSummary(report: EyeReport): string {
  const a = report.attendance;
  const r = report.response;
  const o = report.ops;

  const lines = [
    "👁️ <b>عين الإدارة</b>",
    `<code>${report.day}</code>`,
    "",
    `<b>الحضور</b> — ${a.present} من ${a.expected} فتحوا النظام${a.absent.length ? ` · غاب: ${a.absent.join("، ")}` : ""}`,
    `<b>العناية</b> — ${r.opened} طلب اليوم · ${r.answered} رُدّ عليه · <b>${r.unanswered}</b> بلا رد` +
      (r.avgMinutes != null ? ` · متوسط ${r.avgMinutes} دقيقة` : ""),
    `<b>العمليات</b> — ${o.needsAction} يحتاج إجراءً${o.critical ? ` (${o.critical} حرِج)` : ""} · ${o.openBookings} حجز غير مؤكَّد · ${o.travelSoon} سفر خلال ٧ أيام`,
    `<b>المبيعات</b> — ${report.sales.issuedToday} صدر اليوم · ${report.sales.confirmedToday} تأكّد` +
      (report.sales.totalToday ? ` · ${Math.round(report.sales.totalToday)} ${report.sales.currency}` : ""),
  ];

  if (report.activity.length > 0) {
    lines.push("", `<b>النشاط</b> — ${report.activity.map((x) => `${x.name} (${x.count})`).join(" · ")}`);
  }

  if (report.notes.length > 0) {
    lines.push("", `<b>الملاحظات (${report.notes.length})</b>`);
    for (const note of report.notes.slice(0, 12)) lines.push(noteLine(note));
    if (report.notes.length > 12) lines.push(`… و${report.notes.length - 12} أخرى`);
  } else {
    lines.push("", "لا ملاحظات اليوم.");
  }

  return lines.join("\n");
}
