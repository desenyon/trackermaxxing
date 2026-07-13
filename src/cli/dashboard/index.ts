import { render } from "ink";
import { createElement } from "react";

import { getUnifiedOverview } from "@/lib/ai/service";
import { getGithubActivityOverview } from "@/lib/github/activity";

import { App } from "./App";

export async function runDashboard(options: { days: number }) {
  if (!process.stdin.isTTY) {
    throw new Error("The live dashboard needs an interactive terminal. Run `trackermaxxing` for a one-shot report instead.");
  }

  const instance = render(
    createElement(App, {
      days: options.days,
      loaders: { getAi: getUnifiedOverview, getGithub: getGithubActivityOverview },
    }),
  );
  await instance.waitUntilExit();
}
