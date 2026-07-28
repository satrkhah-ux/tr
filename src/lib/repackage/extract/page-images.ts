import "server-only";
import type { AiImage } from "./ai-extract";

/**
 * Pictures of a supplier document, for the vision reader.
 *
 * A designed brochure — a PowerPoint exported to PDF is the common case — puts
 * every word inside artwork, so the text layer is empty and the page's content
 * IS an embedded image. Pulling those images out is enough for a vision model
 * and needs nothing beyond what the project already installs (`unpdf` reads the
 * PDF, `sharp` turns raw pixels into PNG); a true page rasteriser would mean
 * adding a native canvas just to redraw pixels that are already there.
 *
 * Small images are skipped: a slide carries logos, icons and social badges that
 * cost a request and say nothing.
 */

/** Below this, an embedded image is decoration rather than content. */
const MIN_SIDE = 500;
/** Vision models gain nothing past ~1600px, and the payload grows fast. */
const MAX_SIDE = 1600;
/** Enough pages to read a brochure; beyond that cost climbs without new facts. */
const MAX_PAGES = 4;
/** At most this many pictures per page — the biggest ones. */
const PER_PAGE = 2;

type RawImage = { width: number; height: number; channels: number; data: Uint8Array | Uint8ClampedArray };

export async function pdfPageImages(pdf: Buffer): Promise<AiImage[]> {
  const { extractImages, getDocumentProxy } = await import("unpdf");
  const sharp = (await import("sharp")).default;

  const doc = await getDocumentProxy(new Uint8Array(pdf));
  const pages = Math.min(doc.numPages, MAX_PAGES);
  const out: AiImage[] = [];

  for (let page = 1; page <= pages; page += 1) {
    let found: RawImage[] = [];
    try {
      found = (await extractImages(doc, page)) as unknown as RawImage[];
    } catch {
      continue; // a page we cannot read is not a reason to fail the import
    }
    const worthwhile = found
      .filter((img) => img.width >= MIN_SIDE && img.height >= MIN_SIDE)
      .sort((a, b) => b.width * b.height - a.width * a.height)
      .slice(0, PER_PAGE);

    for (const img of worthwhile) {
      try {
        const png = await sharp(Buffer.from(img.data), {
          raw: { width: img.width, height: img.height, channels: (img.channels === 4 ? 4 : 3) as 3 | 4 },
        })
          .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: "inside", withoutEnlargement: true })
          .png({ compressionLevel: 9 })
          .toBuffer();
        out.push({ mime: "image/png", base64: png.toString("base64") });
      } catch {
        /* a picture we cannot convert is simply left out */
      }
    }
  }
  return out;
}

/** Normalize an uploaded photo/screenshot for the vision reader. */
export async function normalizeImage(bytes: Buffer): Promise<AiImage> {
  const sharp = (await import("sharp")).default;
  const png = await sharp(bytes)
    .rotate() // honour the EXIF orientation of a phone photo
    .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: "inside", withoutEnlargement: true })
    .png({ compressionLevel: 9 })
    .toBuffer();
  return { mime: "image/png", base64: png.toString("base64") };
}
