/**
 * «الشاشات» — what a screen shows at a given moment, as PURE functions of the
 * server's clock. Ads and country relays stay synchronized after a TV suspends
 * or reloads; request alerts recover separately using completed event IDs.
 * Written once, as plain ES5 source, because the same text
 * runs in three places: inlined into the screen's page (old TV WebViews — no
 * arrow functions, no let), on the server for the first paint, and in the tests.
 *
 *  · adIndexAt — screen at position p (0 = the leftmost) shows
 *    ads[(slot − p) mod N]: the ad on one screen moves to the next one at the
 *    next slot, and no two screens match while N ≥ S;
 *  · tickerElapsed — the band is hidden; it comes up every period (10 min) for
 *    exactly one pass across all S screens, and once more when its words change
 *    (bumpAt, pinned to the server's clock): how far into its pass it is, or −1;
 *  · tickerLeft — ONE strip runs across all S screens, left to right (an Arabic
 *    news ticker: its beginning arrives first); x of the text's left edge in this
 *    screen's reference pixels (a 1920-wide screen), so mixed TVs stay in step;
 *  · alertAt — every screen shows an event from `at + lead` for `show` ms, so
 *    screens that poll at different moments still pop together.
 */
export const SCREEN_CORE = String.raw`
function mod(a, n) { return ((a % n) + n) % n; }
function countryBulletinElapsed(now, screen, screens) {
  if (screen < 1 || screen > screens) return -1;
  var elapsed = mod(now, 600000);
  return elapsed < 60000 ? elapsed : -1;
}
function adIndexAt(now, slotMs, position, count) {
  if (!(count > 0) || !(slotMs > 0)) return -1;
  return mod(Math.floor(now / slotMs) - position, count);
}
function tickerPassMs(speed, textRef, screens, refWidth) {
  return ((textRef + screens * refWidth) / speed) * 1000;
}
function tickerElapsed(now, periodMs, passMs, bumpAt) {
  if (bumpAt > 0 && now >= bumpAt && now < bumpAt + passMs) return now - bumpAt;
  if (!(periodMs > 0)) return -1;
  var e = mod(now, periodMs);
  return e < passMs ? e : -1;
}
function tickerLeft(elapsed, speed, textRef, position, refWidth) {
  return -textRef + (elapsed / 1000) * speed - position * refWidth;
}
function alertAt(events, now, lead, show) {
  for (var i = 0; i < events.length; i++) {
    var start = events[i].at + lead;
    if (now >= start && now < start + show) return i;
  }
  return -1;
}
// A delayed poll must not lose an event. The queue is per screen, and only
// completed presentations are persisted. No customer details go in storage.
function nextScreenAlert(events, now, seen, lead) {
  for (var i = 0; i < events.length; i++) {
    if (!seen[events[i].id] && events[i].at + lead <= now && events[i].at >= now - 300000) return i;
  }
  return -1;
}
`;

export type ScreenCore = {
  countryBulletinElapsed(now: number, screen: number, screens: number): number;
  adIndexAt(now: number, slotMs: number, position: number, count: number): number;
  tickerPassMs(speed: number, textRef: number, screens: number, refWidth: number): number;
  tickerElapsed(now: number, periodMs: number, passMs: number, bumpAt: number): number;
  tickerLeft(elapsed: number, speed: number, textRef: number, position: number, refWidth: number): number;
  alertAt(events: { at: number }[], now: number, lead: number, show: number): number;
  nextScreenAlert(events: { id: string; at: number }[], now: number, seen: Record<string, number>, lead: number): number;
};

// the same source the page runs, for the server's first paint and the tests
export const core = new Function(`${SCREEN_CORE}; return { countryBulletinElapsed: countryBulletinElapsed, adIndexAt: adIndexAt, tickerPassMs: tickerPassMs, tickerElapsed: tickerElapsed, tickerLeft: tickerLeft, alertAt: alertAt, nextScreenAlert: nextScreenAlert };`)() as ScreenCore;

/** the reference screen the ticker's speed and width are counted in */
export const REF_WIDTH = 1920;
/** Normal synchronized start; delayed screens still give each event its full duration. */
export const ALERT_LEAD_MS = 8000;
export const ALERT_SHOW_MS = 20000;
