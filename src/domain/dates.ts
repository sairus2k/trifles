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

/** "Today", "Yesterday", or the weekday and date of a local `YYYY-MM-DD`; the year only when it differs. */
export function dayLabel(date: string, today: string, locale?: string): string {
  if (date === today) return "Today";
  const [year, month, day] = today.split("-").map(Number) as [number, number, number];
  if (date === toLocalDate(new Date(year, month - 1, day - 1))) return "Yesterday";
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Intl.DateTimeFormat(locale, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: y === year ? undefined : "numeric",
  }).format(new Date(y, m - 1, d));
}
