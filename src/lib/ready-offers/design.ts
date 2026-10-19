/**
 * A ready offer's design (the owner, 2026-10-19: the card shows the design
 * image, the description over it on hover). Pure: whether a link can be shown
 * as an image, and as which. A Google Drive share link becomes Drive's own
 * image of it; a link to an image file or to our storage is shown as it is;
 * anything else (Canva, a page) is no image — the card keeps its description
 * and a button that opens the link. The card still checks the image loads
 * before it shows it, so a link that fails is never a broken box.
 */
export const DESIGN_BUCKET = "ready-designs";
export const DESIGN_MAX_BYTES = 5 * 1024 * 1024;
export const DESIGN_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export function designImageUrl(url: string | null | undefined): string | null {
  const u = (url ?? "").trim();
  if (!/^https?:\/\//i.test(u)) return null;
  const drive = u.match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:[^#]*&)?id=)([A-Za-z0-9_-]{10,})/);
  if (drive) return `https://drive.google.com/thumbnail?id=${drive[1]}&sz=w1200`;
  if (/drive\.google\.com\/thumbnail\?/.test(u)) return u;
  if (/\/storage\/v1\/object\/public\//.test(u)) return u;
  if (/\.(jpe?g|png|webp|gif|avif)(\?|#|$)/i.test(u)) return u;
  if (/(^https?:\/\/)?[^/]*(googleusercontent\.com|i\.imgur\.com)\//.test(u)) return u;
  return null;
}
