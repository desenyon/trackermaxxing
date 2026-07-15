import { InvalidArgumentError } from "commander";
import { describe, expect, it } from "vitest";

import { applyMaskedInput } from "@/cli/commands/github-login";
import { positiveInteger } from "@/cli/options";

describe("positiveInteger", () => {
  it("accepts positive safe integers", () => expect(positiveInteger("42")).toBe(42));

  it.each(["0", "-1", "1.5", "nope", "9007199254740992"])("rejects %s", (value) => {
    expect(() => positiveInteger(value)).toThrow(InvalidArgumentError);
  });
});

describe("applyMaskedInput", () => {
  it("handles delete and backspace", () => {
    expect(applyMaskedInput("abc", "\u007f").value).toBe("ab");
    expect(applyMaskedInput("abc", "\b").value).toBe("ab");
  });

  it("submits on enter and cancels on Ctrl+C", () => {
    expect(applyMaskedInput("token", "\r").action).toBe("submit");
    expect(applyMaskedInput("token", "\u0003").action).toBe("cancel");
  });
});
