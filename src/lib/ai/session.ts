/** Provider-neutral usage contract. Dates and daily attribution are always UTC. */
export interface AiUsage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  reasoningTokens: number;
  estimatedCostUsd: number;
  turnCount: number;
}

export interface AiDailyUsage extends AiUsage {
  date: string;
}

export interface AiSession extends AiUsage {
  id: string;
  sessionPath: string;
  firstActivity: Date;
  lastActivity: Date;
  model: string | null;
  cwd: string | null;
  sourceFileHash: string;
  // Omitted by legacy importers: preserve their first-activity-day attribution.
  dailyUsage?: AiDailyUsage[];
}

export const usageFields = ["inputTokens", "outputTokens", "cachedInputTokens", "reasoningTokens", "estimatedCostUsd", "turnCount"] as const;
export const emptyUsage = (): AiUsage => ({ inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, reasoningTokens: 0, estimatedCostUsd: 0, turnCount: 0 });
export const tokenNumber = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;

export class DailyUsage {
  private readonly days = new Map<string, AiDailyUsage>();

  add(timestamp: Date, usage: Partial<AiUsage>) {
    const date = timestamp.toISOString().slice(0, 10);
    const day = this.days.get(date) ?? { date, ...emptyUsage() };
    for (const field of usageFields) day[field] += usage[field] ?? 0;
    this.days.set(date, day);
  }

  rows() {
    return [...this.days.values()].sort((a, b) => a.date.localeCompare(b.date));
  }

  totals(): AiUsage {
    const totals = emptyUsage();
    for (const day of this.days.values()) for (const field of usageFields) totals[field] += day[field];
    return totals;
  }
}
