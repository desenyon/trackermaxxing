const compactFormatter = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const currencyFormatter = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

export function compactNumber(value: number) {
  return compactFormatter.format(value);
}

export function currency(value: number) {
  return currencyFormatter.format(value);
}

const SPARK_LEVELS = "▁▂▃▄▅▆▇█";

export function sparkline(values: number[]) {
  if (values.length === 0) return "";
  const max = Math.max(...values, 1);
  return values
    .map((value) => {
      const level = Math.min(SPARK_LEVELS.length - 1, Math.floor((value / max) * (SPARK_LEVELS.length - 1)));
      return SPARK_LEVELS[Math.max(0, level)];
    })
    .join("");
}

const BAR_CHAR = "█";
const BAR_TRACK = "░";

export function bar(fraction: number, width: number) {
  const filled = Math.max(0, Math.min(width, Math.round(fraction * width)));
  return BAR_CHAR.repeat(filled) + BAR_TRACK.repeat(width - filled);
}

export function pad(text: string, width: number, align: "left" | "right" = "left") {
  const visible = stripAnsiLength(text);
  const gap = Math.max(0, width - visible);
  return align === "left" ? text + " ".repeat(gap) : " ".repeat(gap) + text;
}

// eslint-disable-next-line no-control-regex
const ANSI_PATTERN = /\x1b\[[0-9;]*m/g;

export function stripAnsiLength(text: string) {
  return text.replace(ANSI_PATTERN, "").length;
}

export function relativeDay(dateKey: string) {
  const today = new Date().toISOString().slice(0, 10);
  const diffMs = new Date(`${today}T00:00:00Z`).getTime() - new Date(`${dateKey}T00:00:00Z`).getTime();
  const days = Math.round(diffMs / 86_400_000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  return `${days}d ago`;
}
