"use client";

/**
 * Where an anchored list (a combobox, a suggestion list) is mounted: a layer
 * inside <body> that undoes the body's zoom (globals.css `--tv-zoom`).
 *
 * Floating UI reads the field's position in screen pixels and writes the
 * list's top/left as CSS pixels. Inside the zoomed body every one of those
 * pixels is drawn 12% larger, so a list opened 12% of the field's distance from
 * the top of the page below it — over the next row near the top, off the
 * screen further down. In this layer one CSS pixel is one screen pixel again,
 * so the list lands under its field; the list itself puts the size back with
 * ZOOMED_POPUP and divides the field's width and the room left by the zoom.
 */
let root: HTMLElement | null = null;

export function unzoomedRoot(): HTMLElement | undefined {
  if (typeof document === "undefined") return undefined;
  if (root?.isConnected) return root;
  const zoom = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--tv-zoom")) || 1;
  root = document.createElement("div");
  root.setAttribute("data-tv-overlays", "");
  root.style.zoom = String(1 / zoom);
  document.body.appendChild(root);
  return root;
}

/** The list's own classes in that layer: the app's size again, its width and height in the field's terms. */
export const ZOOMED_POPUP =
  "[zoom:var(--tv-zoom)] w-[calc(var(--anchor-width)/var(--tv-zoom))] max-h-[min(320px,calc(var(--available-height)/var(--tv-zoom)))]";
