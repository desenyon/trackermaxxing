import { utcDay, utcWindow } from "@/lib/time";

/** Fill inactive dates before grouping the full window into equally spaced bins. */
export function dailySeries(values: Map<string, number>, days: number, width = days) {
  const { since } = utcWindow(days);
  const start = new Date(`${since}T00:00:00Z`);
  const count = Math.max(1, Math.min(days, width));
  const series = Array.from({ length: count }, () => 0);
  for (let i = 0; i < days; i += 1) {
    const date = new Date(start); date.setUTCDate(start.getUTCDate() + i);
    series[Math.floor(i * count / days)] += values.get(utcDay(date)) ?? 0;
  }
  return series;
}
