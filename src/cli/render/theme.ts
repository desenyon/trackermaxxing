import chalk from "chalk";

const PROVIDER_HEX = {
  codex: "#10A37F",
  claude: "#D97757",
  cursor: "#B794F6",
} as const;

export const providerColor = {
  codex: chalk.hex(PROVIDER_HEX.codex),
  claude: chalk.hex(PROVIDER_HEX.claude),
  cursor: chalk.hex(PROVIDER_HEX.cursor),
} as const;

export const providerLabel: Record<keyof typeof providerColor, string> = {
  codex: "Codex",
  claude: "Claude",
  cursor: "Cursor",
};

export const dim = chalk.hex("#9ca3af");
export const heading = chalk.bold.white;
export const accent = chalk.hex("#B794F6");
export const good = chalk.hex("#34D399");
export const warn = chalk.hex("#FBBF24");
export const bad = chalk.hex("#F87171");

const BADGE_WIDTH = Math.max(...Object.values(providerLabel).map((label) => label.length));

// A solid color chip reads reliably against any terminal theme - plain colored
// text on some 256-color / low-contrast dark schemes can wash out, especially
// the AI usage rows this is built for. Padded to a fixed width so badges (and
// whatever follows them on the line) line up regardless of provider name length.
export function providerBadge(provider: keyof typeof PROVIDER_HEX) {
  const label = providerLabel[provider].toUpperCase().padEnd(BADGE_WIDTH, " ");
  return chalk.bgHex(PROVIDER_HEX[provider]).black.bold(` ${label} `);
}
