import type { SureSettings } from "../api/http";
import { db } from "../db/schema";
import { SYNC_LOCK } from "./outbox";

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
export async function saveSettings(settings: SureSettings): Promise<void> {
  await db.transaction("rw", db.meta, async () => {
    await putSettings(settings);
    await db.meta.delete(PAUSED_AT);
  });
}

/**
 * Whether two URLs reach the same API: requests drop trailing slashes, and URL parsing lowercases
 * the host and drops a default port. An alias or another path of the same instance still differs.
 */
export function sameInstance(a: string, b: string): boolean {
  return apiRoot(a) === apiRoot(b);
}

function apiRoot(baseUrl: string): string {
  const url = URL.parse(baseUrl);
  return url ? url.origin + url.pathname.replace(/\/+$/, "") : baseUrl;
}

/**
 * Stores another instance's settings and clears everything the old one left: the cache, the
 * outbox and the rest of meta (the pause and the entry form's account). It holds the sync lock, so
 * no tab is sending to or pulling from the old instance meanwhile. Records that have not reached
 * the old instance are the ones not `done`; with more of them than `allowedUnsent` it changes
 * nothing and returns their count, so a record another tab added after the user was asked is not
 * lost unseen.
 */
export function switchInstance(
  settings: SureSettings,
  allowedUnsent: number,
): Promise<{ unsent: number } | undefined> {
  // Async, so the lock waits for the commit: Node's LockManager does not wait for the Dexie
  // promise (not a native one) that returning `db.transaction()` directly would hand it.
  return navigator.locks.request(SYNC_LOCK, async () => {
    return await db.transaction("rw", db.tables, async () => {
      const unsent = await db.outbox.filter((record) => record.status !== "done").count();
      if (unsent > allowedUnsent) return { unsent };
      await Promise.all(db.tables.map((table) => table.clear()));
      await putSettings(settings);
      return undefined;
    });
  });
}

function putSettings({ baseUrl, apiKey }: SureSettings) {
  return db.meta.bulkPut([
    { key: BASE_URL, value: baseUrl },
    { key: API_KEY, value: apiKey },
  ]);
}

export async function pauseSync(): Promise<void> {
  await db.meta.put({ key: PAUSED_AT, value: Date.now() });
}
