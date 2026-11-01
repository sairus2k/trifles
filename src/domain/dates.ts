// Transaction dates are local calendar days. toISOString() is UTC, so an entry made at 00:30 in Paris
// would land on the previous day.

/** `toLocalDate(new Date(2026, 0, 5))` → `"2026-01-05"`, in the device's time zone. */
export function toLocalDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

export function todayLocal(): string {
  return toLocalDate(new Date());
}
