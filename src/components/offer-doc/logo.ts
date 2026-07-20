/**
 * The Traveliun mark as an inline SVG data-URI.
 *
 * Inlined (not /traveliun/logo-en.svg) because the PDF renderer loads the
 * document via setContent with NO base URL and no network — a file path would
 * silently render as a broken image. Same string is used by the on-screen
 * preview so header artwork is identical in both.
 *
 * `currentColor` is not usable inside a data-URI, so the mark ships in white
 * (it always sits on the green band).
 */
const MARK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" fill="none">
<path d="M20.5 6H33a9 9 0 0 1 9 9v6.5a9 9 0 0 1-9 9h-4.2V24a2.5 2.5 0 0 0-2.5-2.5H20.5V6Z" fill="#ffffff"/>
<path d="M6 15.5h10.5a2.5 2.5 0 0 1 2.5 2.5v6.5h-4.2a2.5 2.5 0 0 0-2.5 2.5V33H15a9 9 0 0 1-9-9v-8.5Z" fill="#ffffff" opacity=".72"/>
<path d="M19 24h6.3a2.5 2.5 0 0 1 2.5 2.5V42h-2.9a5.9 5.9 0 0 1-5.9-5.9V24Z" fill="#ffffff" opacity=".55"/>
</svg>`;

export const TRAVELIUN_MARK_DATA_URI = `data:image/svg+xml;base64,${Buffer.from(MARK_SVG, "utf8").toString("base64")}`;
