import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { toLocalDate, todayLocal } from "./dates";

const originalTz = process.env.TZ;

// Assigning TZ at runtime only takes effect in a child process, not in worker_threads. This relies on
// Vitest's default forks pool; the offset check below fails loudly if that ever changes.
beforeAll(() => {
  process.env.TZ = "Europe/Paris";
  vi.useFakeTimers();
});

afterAll(() => {
  vi.useRealTimers();
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
});

describe("todayLocal", () => {
  test("returns the local day at 00:30 in Paris, where the UTC date is still yesterday", () => {
    vi.setSystemTime(new Date("2026-11-01T23:30:00Z"));
    expect(new Date().getTimezoneOffset()).toBe(-60);
    expect(new Date().toISOString().slice(0, 10)).toBe("2026-11-01");
    expect(todayLocal()).toBe("2026-11-02");
  });

  test("returns the local day at 00:30 in Paris in summer time", () => {
    vi.setSystemTime(new Date("2026-07-14T22:30:00Z"));
    expect(todayLocal()).toBe("2026-07-15");
  });

  test("stays on the same day at 23:59 local time", () => {
    vi.setSystemTime(new Date("2026-11-02T22:59:00Z"));
    expect(todayLocal()).toBe("2026-11-02");
  });
});

describe("toLocalDate", () => {
  test("pads month and day", () => {
    expect(toLocalDate(new Date(2026, 0, 5, 12))).toBe("2026-01-05");
  });
});
