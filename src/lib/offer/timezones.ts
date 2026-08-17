/**
 * Time differences, computed rather than tabulated.
 *
 * The temptation is a table: "Malaysia +5". It is wrong for 21 of our 56
 * destinations, because their offset MOVES with daylight saving — Germany is
 * −2 from Riyadh in summer and −1 in winter, Britain −2 then −3. A number
 * stored next to a country would be right half the year and quietly wrong the
 * other half, on exactly the files an agent does not re-check.
 *
 * So the offset is derived from the IANA zone AND the travel date, every time.
 * Pure module: Intl only, no network, no React.
 *
 * What this is FOR: a flight leaving Jeddah at 23:40 lands in Kuala Lumpur the
 * NEXT local day, and the programme's day one is that landing day, not the
 * departure day. And a group that lands at 04:00 is not touring that morning —
 * they are sleeping. Both facts are invisible in a date field.
 */

export const HOME_TZ = "Asia/Riyadh";

/** UTC offset of a zone, in hours, ON a given instant (so DST is respected). */
export function zoneOffsetHours(timeZone: string, at: Date): number | null {
  try {
    const label = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" })
      .formatToParts(at)
      .find((p) => p.type === "timeZoneName")?.value;
    if (!label) return null;
    if (label === "GMT") return 0;
    const m = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(label);
    if (!m) return null;
    const sign = m[1] === "-" ? -1 : 1;
    return sign * (Number(m[2]) + Number(m[3] ?? 0) / 60);
  } catch {
    // An unknown or misspelt zone must not take the page down; the caller
    // renders nothing rather than a wrong number.
    return null;
  }
}

/**
 * How far AHEAD the destination is of home, on the travel date.
 * Positive = destination is ahead (east). Null when either zone is unusable.
 */
export function offsetFromHome(destTz: string | null, onDate?: string | null, homeTz = HOME_TZ): number | null {
  if (!destTz) return null;
  const at = onDate ? new Date(`${onDate}T12:00:00Z`) : new Date();
  if (Number.isNaN(at.getTime())) return null;
  const dest = zoneOffsetHours(destTz, at);
  const home = zoneOffsetHours(homeTz, at);
  if (dest === null || home === null) return null;
  return dest - home;
}

function hoursAr(abs: number): string {
  const whole = Math.floor(abs);
  const mins = Math.round((abs - whole) * 60);
  const h = whole === 1 ? "ساعة" : whole === 2 ? "ساعتان" : whole <= 10 ? `${whole} ساعات` : `${whole} ساعة`;
  return mins ? `${h} و${mins} دقيقة` : h;
}

/** "تتقدّم الوجهة على السعودية بـ٥ ساعات" — or that the two agree. */
export function describeOffsetAr(diff: number | null): string | null {
  if (diff === null) return null;
  if (diff === 0) return "لا فرق توقيت مع السعودية";
  const abs = Math.abs(diff);
  return diff > 0
    ? `الوجهة تسبق السعودية بـ${hoursAr(abs)}`
    : `الوجهة تتأخّر عن السعودية بـ${hoursAr(abs)}`;
}

export type ArrivalPart = "late_night" | "dawn" | "morning" | "afternoon" | "evening" | "night";

/**
 * What time of day the group actually lands, LOCALLY.
 *
 * The programme's first day is worth what is left of it. A 04:00 landing buys
 * a hotel bed and an afternoon; a 23:40 landing buys nothing at all — and both
 * used to read as a full day one with tours planned on it.
 */
export function arrivalPart(localDateTime: string | null | undefined): ArrivalPart | null {
  if (!localDateTime) return null;
  const time = localDateTime.slice(11, 16);
  const m = /^(\d{2}):(\d{2})$/.exec(time);
  if (!m) return null;
  const h = Number(m[1]);
  if (h < 5) return "late_night";
  if (h < 8) return "dawn";
  if (h < 12) return "morning";
  if (h < 17) return "afternoon";
  if (h < 21) return "evening";
  return "night";
}

export const ARRIVAL_PART_AR: Record<ArrivalPart, string> = {
  late_night: "بعد منتصف الليل",
  dawn: "فجراً",
  morning: "صباحاً",
  afternoon: "بعد الظهر",
  evening: "مساءً",
  night: "ليلاً",
};

/**
 * Is day one a day the group can actually be shown anything?
 *
 * Landing after 21:00 or before 05:00 means the answer is no: the day is a
 * transfer and a bed. Saying so on the programme prevents the two failures
 * that follow — a tour sold for a day nobody is awake, and a client who counts
 * the day and asks what they paid for.
 */
export function dayOneIsUsable(arrivalLocalDateTime: string | null | undefined): boolean {
  const part = arrivalPart(arrivalLocalDateTime);
  if (part === null) return true;
  return part !== "late_night" && part !== "night";
}

/** The sentence the itinerary prints on day one. */
export function arrivalDayNoteAr(arrivalLocalDateTime: string | null | undefined): string | null {
  const part = arrivalPart(arrivalLocalDateTime);
  if (!part) return null;
  const when = ARRIVAL_PART_AR[part];
  return dayOneIsUsable(arrivalLocalDateTime)
    ? `الوصول ${when}`
    : `الوصول ${when} — يوم انتقال واستراحة، لا جولات`;
}

/**
 * The plain-language warning for a flight whose local dates do not line up
 * with the departure date. `offset` is arrival local date − departure local date.
 */
export function dayShiftNoteAr(offset: number): string | null {
  if (offset === 0) return null;
  if (offset > 0) {
    return offset === 1
      ? "تهبط الرحلة في اليوم التالي بتوقيت الوجهة — البرنامج يبدأ من يوم الهبوط"
      : `تهبط الرحلة بعد ${offset} أيام بتوقيت الوجهة`;
  }
  // Westward across the date line. Rare from here, and the one nobody expects.
  return offset === -1
    ? "تهبط الرحلة في اليوم السابق بتوقيت الوجهة — تحقّق من التاريخ"
    : `تهبط الرحلة قبل ${Math.abs(offset)} أيام بتوقيت الوجهة — تحقّق من التاريخ`;
}
