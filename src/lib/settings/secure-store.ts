import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { appSettings } from "@/lib/db/schema";

const keyFilePath = resolve(homedir(), ".trackermaxxing", "key");

// No env var required: a random key is generated once and persisted alongside
// the local DB, so credentials saved via `trackermaxxing github login` stay
// encrypted at rest without any setup. Set TRACKER_ENCRYPTION_KEY to override.
function localKeyMaterial() {
  if (process.env.TRACKER_ENCRYPTION_KEY) return process.env.TRACKER_ENCRYPTION_KEY;
  if (existsSync(keyFilePath)) return readFileSync(keyFilePath, "utf8").trim();
  const generated = randomBytes(32).toString("base64url");
  mkdirSync(dirname(keyFilePath), { recursive: true });
  writeFileSync(keyFilePath, generated, { mode: 0o600 });
  return generated;
}

const encryptionKey = () => createHash("sha256").update(localKeyMaterial()).digest();

export function encryptSecret(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `v1:${iv.toString("base64url")}:${cipher.getAuthTag().toString("base64url")}:${encrypted.toString("base64url")}`;
}

export function decryptSecret(value: string) {
  const [version, iv, tag, encrypted] = value.split(":");
  if (version !== "v1" || !iv || !tag || !encrypted) throw new Error("Stored credential has an invalid format.");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encrypted, "base64url")), decipher.final()]).toString("utf8");
}

export function writeSecrets(values: Record<string, string>) {
  db.transaction((tx) => {
    for (const [key, plaintext] of Object.entries(values)) {
      const value = encryptSecret(plaintext);
      const updatedAt = new Date();
      tx.insert(appSettings).values({ key, value, updatedAt }).onConflictDoUpdate({
        target: appSettings.key, set: { value, updatedAt },
      }).run();
    }
  });
}

export async function writeSecret(key: string, value: string) {
  writeSecrets({ [key]: value });
}

export async function readSecret(key: string) {
  const [setting] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, key)).limit(1);
  return setting ? decryptSecret(setting.value) : null;
}

export async function hasSecret(key: string) {
  const [setting] = await db.select({ key: appSettings.key }).from(appSettings).where(eq(appSettings.key, key)).limit(1);
  return Boolean(setting);
}
