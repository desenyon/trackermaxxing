export const utcDay = (date: Date) => date.toISOString().slice(0, 10);

/** Inclusive calendar-day bounds. UTC avoids local DST and timezone drift. */
export function utcWindow(days: number, now = new Date()) {
  if (!Number.isSafeInteger(days) || days < 1 || days > 36500) throw new Error("Days must be between 1 and 36500.");
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  start.setUTCDate(start.getUTCDate() - days + 1);
  return { since: utcDay(start), through: utcDay(now) };
}
