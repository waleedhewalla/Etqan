/** «الأحد ١٥ نوفمبر، ٨:٠٠ م» for a lesson's time, in the institution's time zone. */
export const lessonTime = (iso: string) => new Intl.DateTimeFormat('ar-EG', {
  weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit', timeZone: 'Africa/Cairo',
}).format(new Date(iso));

/**
 * The value for an `<input type="datetime-local">` that is `minutes` from now, in the browser's own time zone
 * (the input has no time zone: what it holds is read back by `new Date(value)` in the same zone).
 */
export function localInputValue(minutes: number): string {
  const d = new Date(Date.now() + minutes * 60_000);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}
