import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export const sourcePath = (configured: string | undefined, fallback: string) =>
  resolve((configured ?? fallback).replace(/^~(?=$|\/)/, homedir()));

export class SourceUnavailableError extends Error {
  constructor(path: string) { super(`Source unavailable: ${path}. Cached data retained.`); }
}

/** A missing root is not an empty snapshot. Nested disappearance aborts the scan. */
export async function listJsonlFiles(directory: string, root = true): Promise<string[]> {
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (root && error.code === "ENOENT") throw new SourceUnavailableError(directory);
    throw error;
  });
  const files: string[] = [];
  // Sequential traversal bounds open descriptors and gives deterministic ownership.
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await listJsonlFiles(path, false));
    else if (entry.isFile() && entry.name.endsWith(".jsonl")) files.push(path);
  }
  return files;
}

/** Reject damaged snapshots; only an unfinished final append after valid JSON is safe to ignore. */
export async function readJsonlContent(path: string) {
  const content = await fs.readFile(path, "utf8");
  const lines = content.split(/\r?\n/);
  let valid = 0;
  for (let index = 0; index < lines.length; index += 1) {
    if (!lines[index].trim()) continue;
    try { JSON.parse(lines[index]); valid += 1; }
    catch {
      if (index === lines.length - 1 && valid > 0 && !content.endsWith("\n")) continue;
      throw new Error(`Invalid JSONL at ${path}:${index + 1}`);
    }
  }
  return content;
}
