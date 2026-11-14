/** The institution's time zone: lessons are set and shown in it, whatever the browser's zone is. */
export const INSTITUTION_ZONE = 'Africa/Cairo';

/** «الأحد ١٥ نوفمبر، ٨:٠٠ م» for a lesson's time, in the institution's time zone. */
export const lessonTime = (iso: string) => new Intl.DateTimeFormat('ar-EG', {
  weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit', timeZone: INSTITUTION_ZONE,
}).format(new Date(iso));

const parts = (at: Date, timeZone: string) => Object.fromEntries(
  new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(at).map((p) => [p.type, p.value]),
) as Record<string, string>;

/** The wall-clock time in a zone as `YYYY-MM-DDTHH:mm`, the shape an `<input type="datetime-local">` holds. */
export function wallClock(at: Date, timeZone = INSTITUTION_ZONE): string {
  const p = parts(at, timeZone);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

/** The value for the input that is `minutes` from now, as the institution's clock reads. */
export const localInputValue = (minutes: number) => wallClock(new Date(Date.now() + minutes * 60_000));

/**
 * The instant a wall-clock time in the institution's zone means, as an ISO string (or null when `value` is not a time).
 * The input has no zone of its own, so the browser's zone must not decide what «٨:٠٠ م» means.
 */
export function institutionTimeToIso(value: string, timeZone = INSTITUTION_ZONE): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!m) return null;
  const asUtc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  if (Number.isNaN(asUtc)) return null;
  // The zone's offset at that moment, found by asking what the zone's clock reads at a first guess; once more settles a daylight-saving edge.
  let guess = asUtc;
  for (let i = 0; i < 2; i++) {
    const p = parts(new Date(guess), timeZone);
    const read = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
    guess = asUtc - (read - guess);
  }
  const iso = new Date(guess);
  // A time that does not exist (the hour skipped when clocks go forward) reads back differently: refuse it.
  return wallClock(iso, timeZone) === value ? iso.toISOString() : null;
}
