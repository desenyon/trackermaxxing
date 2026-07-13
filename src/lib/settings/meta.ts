import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { appSettings } from "@/lib/db/schema";

export async function setMeta(key: string, value: string) {
  await db.insert(appSettings).values({ key, value, updatedAt: new Date() }).onConflictDoUpdate({
    target: appSettings.key,
    set: { value, updatedAt: new Date() },
  });
}

export async function getMeta(key: string) {
  const [setting] = await db.select().from(appSettings).where(eq(appSettings.key, key)).limit(1);
  return setting ?? null;
}
