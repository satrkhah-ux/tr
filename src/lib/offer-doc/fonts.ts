import "server-only";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * The Tajawal Arabic font, base64-encoded, so the PDF HTML embeds the exact same
 * glyphs (Arabic shaping + tabular numerals) with no network fetch — the
 * on-screen preview loads the same files by URL, so metrics (and therefore
 * pagination) match.
 *
 * Four weights, because the document's type scale uses all of them:
 * 400 body · 500 labels/table headers · 700 headings · 800 hero numbers.
 */
const WEIGHTS = [
  { weight: 400, file: "Tajawal-Regular.ttf" },
  { weight: 500, file: "Tajawal-Medium.ttf" },
  { weight: 700, file: "Tajawal-Bold.ttf" },
  { weight: 800, file: "Tajawal-ExtraBold.ttf" },
] as const;

export type TajawalFaces = { weight: number; base64: string }[];

let cache: TajawalFaces | null = null;

export async function loadTajawalBase64(): Promise<TajawalFaces> {
  if (cache) return cache;
  cache = await Promise.all(
    WEIGHTS.map(async ({ weight, file }) => ({
      weight,
      base64: (await readFile(join(process.cwd(), "public/fonts", file))).toString("base64"),
    })),
  );
  return cache;
}

export function fontFaceCss(faces: TajawalFaces): string {
  return faces
    .map(
      (f) =>
        `@font-face{font-family:Tajawal;font-style:normal;font-weight:${f.weight};` +
        `src:url(data:font/ttf;base64,${f.base64}) format('truetype');}`,
    )
    .join("\n");
}
