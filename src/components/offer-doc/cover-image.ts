import { landmarkFor } from "@/lib/office-screens/landmarks";

/**
 * «الغلاف الفني» (the owner, 2026-10-29): the cover's picture is the destination's own landmark from
 * public/screen-landmarks (the office screens' scenery, already in the repo — nothing from the web). One image
 * per country; a trip to several countries («ماليزيا + سنغافورة») takes the first one that has a picture.
 * Null when none has: the cover then draws the neutral brand cover (gradient + world map), never a broken box.
 */
export function coverImagePath(destination: string | null | undefined): string | null {
  if (!destination) return null;
  const parts = [destination, ...destination.split(/[+،,/\-–]|\sو\s/u).map((p) => p.trim()).filter(Boolean)];
  for (const part of parts) {
    const path = landmarkFor(part);
    if (!path.endsWith("journey.svg")) return path;
  }
  return null;
}

/** how the cover is drawn: the plain one or the designed one — the employee's choice at sending; never printed on a page. */
export type CoverStyle = "basic" | "designed";
