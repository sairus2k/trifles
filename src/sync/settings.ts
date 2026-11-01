import type { SureSettings } from "../api/http";
import { db } from "../db/schema";

// Kept in `meta` rather than in memory so that every tab and the UI see the same settings and pause,
// and a reload does not spend another request on a key Sure already rejected.

const BASE_URL = "baseUrl";
const API_KEY = "apiKey";
const PAUSED_AT = "syncPausedAt";

export interface SyncConfig {
  settings: SureSettings | undefined;
  /** Set when Sure rejected the key (401, or 403 for a read-only key); sync waits for new settings. */
  pausedAt: number | undefined;
}

export async function readSyncConfig(): Promise<SyncConfig> {
  const [baseUrl, apiKey, pausedAt] = await db.meta.bulkGet([BASE_URL, API_KEY, PAUSED_AT]);
  return {
    settings:
      baseUrl && apiKey
        ? { baseUrl: String(baseUrl.value), apiKey: String(apiKey.value) }
        : undefined,
    pausedAt: pausedAt ? Number(pausedAt.value) : undefined,
  };
}

/** Stores the settings and lifts the pause: new settings are the only way out of it. */
export async function saveSettings({ baseUrl, apiKey }: SureSettings): Promise<void> {
  await db.transaction("rw", db.meta, async () => {
    await db.meta.bulkPut([
      { key: BASE_URL, value: baseUrl },
      { key: API_KEY, value: apiKey },
    ]);
    await db.meta.delete(PAUSED_AT);
  });
}

export async function pauseSync(): Promise<void> {
  await db.meta.put({ key: PAUSED_AT, value: Date.now() });
}
