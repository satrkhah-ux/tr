import "server-only";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { DEFAULT_DOC_FONT, FONT_FAMILIES, type DocFont } from "./font-families";

/**
 * The Arabic faces our print documents embed, base64-encoded, so a PDF carries
 * the exact glyphs (Arabic shaping + tabular numerals) with no network fetch —
 * the on-screen preview loads the same files by URL, so metrics, and therefore
 * pagination, match.
 *
 * Only the family a document ASKS for is read and encoded. Embedding all four
 * would put roughly 1.9MB of base64 into every sheet, nearly all of it glyphs
 * nothing on the page draws.
 *
 * The families themselves live in font-families.ts — this module is the part
 * that touches disk, and the admin screen that picks a font must not import it.
 */

export type LoadedFaces = { family: string; faces: { weight: number | string; base64: string }[] };

const cache = new Map<DocFont, LoadedFaces>();

export async function loadFontFaces(font: DocFont = DEFAULT_DOC_FONT): Promise<LoadedFaces> {
  const cached = cache.get(font);
  if (cached) return cached;
  const spec = FONT_FAMILIES[font];
  const loaded: LoadedFaces = {
    family: spec.css,
    faces: await Promise.all(
      spec.faces.map(async ({ weight, file }) => ({
        weight,
        base64: (await readFile(join(process.cwd(), "public/fonts", file))).toString("base64"),
      })),
    ),
  };
  cache.set(font, loaded);
  return loaded;
}

export function fontFaceCss(loaded: LoadedFaces): string {
  return loaded.faces
    .map(
      (f) =>
        `@font-face{font-family:${loaded.family};font-style:normal;font-weight:${f.weight};` +
        `src:url(data:font/ttf;base64,${f.base64}) format('truetype');}`,
    )
    .join("\n");
}
