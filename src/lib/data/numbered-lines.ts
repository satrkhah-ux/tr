/**
 * «1- الجواز…2- صورة…3- كشف حساب…» → one item per line.
 *
 * A single-line box ate the line breaks of every list pasted into it, so the
 * visas' requirements reached the screen — and Murad's WhatsApp answer — as one
 * run-on paragraph. Only the sequence 1, 2, 3… is split on, in order, so a
 * figure inside an item («6 شهور», «3.5 في 4.5», «10 الاف») is never mistaken
 * for the next item.
 */
export function splitNumbered(text: string): string {
  let out = text.replace(/\r\n?/g, "\n");
  let at = 0;
  for (let n = 1; n < 100; n += 1) {
    // «n-», «n –», «n)» or «n.»: not the tail of a longer number or of a date («2026-1-5»),
    // not a range («3-6 أشهر»), and the number and its mark on one line
    const marker = new RegExp(`(?<![\\d.٫/\\-–])${n}[ \\t]*(?:[-–)](?!\\d)|\\.(?!\\d))`, "g");
    marker.lastIndex = at;
    const hit = marker.exec(out);
    if (!hit) break;
    const before = out.slice(0, hit.index).replace(/[ \t]+$/, "");
    if (before === "" || before.endsWith("\n")) {
      at = hit.index + hit[0].length;
    } else {
      out = `${before}\n${out.slice(hit.index)}`;
      at = before.length + 1 + hit[0].length;
    }
  }
  return out;
}

/** The text holds a numbered list that runs on in one line somewhere. */
export function runsOn(text: string | null | undefined): boolean {
  const own = (text ?? "").replace(/\r\n?/g, "\n");
  return own.trim() !== "" && splitNumbered(own) !== own;
}
