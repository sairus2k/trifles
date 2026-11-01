import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { db } from "../db/schema";
import { pauseSync, readSyncConfig, saveSettings } from "./settings";

const NOW = new Date("2026-11-01T10:00:00Z").getTime();
const settings = { baseUrl: "https://sure.example", apiKey: "key-1" };

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  await db.meta.clear();
});
afterEach(() => {
  vi.useRealTimers();
});

test("nothing is configured on a fresh install", async () => {
  expect(await readSyncConfig()).toEqual({ settings: undefined, pausedAt: undefined });
});

test("saved settings are read back", async () => {
  await saveSettings(settings);

  expect(await readSyncConfig()).toEqual({ settings, pausedAt: undefined });
});

test("a pause holds until settings are saved", async () => {
  await saveSettings(settings);
  await pauseSync();
  expect(await readSyncConfig()).toEqual({ settings, pausedAt: NOW });

  await saveSettings({ ...settings, apiKey: "key-2" });

  expect(await readSyncConfig()).toEqual({
    settings: { ...settings, apiKey: "key-2" },
    pausedAt: undefined,
  });
});
