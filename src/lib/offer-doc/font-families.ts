/**
 * Which Arabic families a printed document may use — the FACTS about them, with
 * no filesystem in sight.
 *
 * Split from fonts.ts because that module is `server-only`: it reads .ttf files
 * off disk. The admin screen that lets someone pick a company's typeface is a
 * client component, and it needs the names and the descriptions — not the bytes.
 *
 * All four are SIL Open Font License: free to embed and redistribute.
 */

export type DocFont = "tajawal" | "almarai" | "cairo" | "amiri";

export const DEFAULT_DOC_FONT: DocFont = "tajawal";

export type FamilySpec = {
  /** the CSS font-family name the document writes. */
  css: string;
  labelAr: string;
  /** How it reads, in one line — this is what an admin chooses from. */
  noteAr: string;
  /**
   * Files and the weights they cover. A string weight is a VARIABLE range, which
   * is what makes Chromium interpolate rather than snap to one cut.
   */
  faces: { weight: number | string; file: string }[];
};

export const FONT_FAMILIES: Record<DocFont, FamilySpec> = {
  tajawal: {
    css: "Tajawal",
    labelAr: "تجوال",
    noteAr: "الخط الحالي — هندسي حديث، واضح في الأحجام الصغيرة",
    faces: [
      { weight: 400, file: "Tajawal-Regular.ttf" },
      { weight: 500, file: "Tajawal-Medium.ttf" },
      { weight: 700, file: "Tajawal-Bold.ttf" },
      { weight: 800, file: "Tajawal-ExtraBold.ttf" },
    ],
  },
  almarai: {
    css: "Almarai",
    labelAr: "المراعي",
    noteAr: "أعرض وأثقل قليلاً — يُقرأ جيداً من بعيد",
    // No 500 face ships for Almarai; the renderer falls to the nearest real
    // weight rather than synthesising one that would not match in print.
    faces: [
      { weight: 400, file: "Almarai-Regular.ttf" },
      { weight: 700, file: "Almarai-Bold.ttf" },
      { weight: 800, file: "Almarai-ExtraBold.ttf" },
    ],
  },
  cairo: {
    css: "Cairo",
    labelAr: "القاهرة",
    noteAr: "معاصر ورشيق — الأكثر استخداماً في الهويات الحديثة",
    faces: [{ weight: "200 1000", file: "Cairo-Variable.ttf" }],
  },
  amiri: {
    css: "Amiri",
    labelAr: "أميري",
    noteAr: "نسخ كلاسيكي — رسمي، يليق باللوحات والشهادات",
    faces: [
      { weight: 400, file: "Amiri-Regular.ttf" },
      { weight: 700, file: "Amiri-Bold.ttf" },
    ],
  },
};

/** Narrow an arbitrary stored string to a family we actually ship. */
export function toDocFont(value: string | null | undefined): DocFont {
  return value && value in FONT_FAMILIES ? (value as DocFont) : DEFAULT_DOC_FONT;
}

/** What the admin screen offers. */
export function docFontOptions(): { value: DocFont; labelAr: string; noteAr: string; css: string }[] {
  return (Object.keys(FONT_FAMILIES) as DocFont[]).map((value) => ({
    value,
    labelAr: FONT_FAMILIES[value].labelAr,
    noteAr: FONT_FAMILIES[value].noteAr,
    css: FONT_FAMILIES[value].css,
  }));
}

/** The CSS font-family value a document should set. */
export function fontFamilyOf(font: DocFont): string {
  return `${FONT_FAMILIES[font].css}, sans-serif`;
}
