import { InvalidArgumentError } from "commander";

export function positiveInteger(value: string) {
  if (!/^\d+$/.test(value)) throw new InvalidArgumentError("Expected a positive integer.");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new InvalidArgumentError("Expected a positive integer.");
  return parsed;
}

export function dayCount(value: string) {
  const days = positiveInteger(value);
  if (days > 36500) throw new InvalidArgumentError("Expected at most 36500 days.");
  return days;
}
