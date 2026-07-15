import { InvalidArgumentError } from "commander";

export function positiveInteger(value: string) {
  if (!/^\d+$/.test(value)) throw new InvalidArgumentError("Expected a positive integer.");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new InvalidArgumentError("Expected a positive integer.");
  return parsed;
}
