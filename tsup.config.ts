import { cp, chmod } from "node:fs/promises";

import { defineConfig } from "tsup";

export default defineConfig({
  entry: { cli: "src/cli/index.ts" },
  format: "esm",
  platform: "node",
  target: "node22",
  clean: true,
  minify: true,
  banner: { js: "#!/usr/bin/env node" },
  external: ["better-sqlite3"],
  async onSuccess() {
    await cp("drizzle", "dist/drizzle", { recursive: true });
    await chmod("dist/cli.js", 0o755);
  },
});
