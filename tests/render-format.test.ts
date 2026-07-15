import { describe, expect, it } from "vitest";

import { bar, compactNumber, currency, pad, relativeDay, sparkline, stripAnsiLength } from "@/cli/render/format";

describe("terminal formatting", () => {
  it("formats compact numbers and currency", () => {
    expect(compactNumber(1_250)).toBe("1.3K");
    expect(currency(12.5)).toBe("$12.50");
  });

  it("renders empty and scaled sparklines", () => {
    expect(sparkline([])).toBe("");
    expect(sparkline([0, 5, 10])).toBe("▁▄█");
  });

  it("clamps bars to their requested width", () => {
    expect(bar(-1, 4)).toBe("░░░░");
    expect(bar(0.5, 4)).toBe("██░░");
    expect(bar(2, 4)).toBe("████");
  });

  it("pads ANSI-colored text by visible width", () => {
    const colored = "\u001b[31mred\u001b[0m";
    expect(stripAnsiLength(colored)).toBe(3);
    expect(pad(colored, 5)).toBe(`${colored}  `);
    expect(pad(colored, 5, "right")).toBe(`  ${colored}`);
  });

  it("describes relative UTC days", () => {
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setUTCDate(today.getUTCDate() - 1);
    const older = new Date(today);
    older.setUTCDate(today.getUTCDate() - 3);

    expect(relativeDay(today.toISOString().slice(0, 10))).toBe("today");
    expect(relativeDay(yesterday.toISOString().slice(0, 10))).toBe("yesterday");
    expect(relativeDay(older.toISOString().slice(0, 10))).toBe("3d ago");
  });
});
