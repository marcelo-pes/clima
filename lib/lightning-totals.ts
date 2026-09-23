type Point = { time: number; value: number };
type Reading = { value: number | string; time: number | null } | null;
const DAY = 86400000;
const dayKey = (time: number) => new Date(time).toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });

// WH57 counts are cumulative within a local day. Repeated samples and
// overlapping history windows must contribute only once to that day's total.
export function lightningTotals(points: Point[], live: Reading, now: Date) {
  const today = dayKey(now.getTime());
  const midnight = new Date(`${today}T00:00:00-03:00`);
  const monday = new Date(midnight.getTime() - ((midnight.getUTCDay() + 6) % 7) * DAY);
  const [year, month, date] = today.split("-").map(Number);
  // Clamp to the previous month's final day (e.g. March 31 -> February 28/29).
  const previousMonthLastDay = new Date(Date.UTC(year, month - 1, 0));
  const monthlyStart = new Date(Date.UTC(previousMonthLastDay.getUTCFullYear(), previousMonthLastDay.getUTCMonth(), Math.min(date, previousMonthLastDay.getUTCDate()))).toISOString().slice(0, 10);
  const starts = { weekly: dayKey(monday.getTime()), monthly: monthlyStart, annual: dayKey(midnight.getTime() - 364 * DAY) };
  const counts = new Map<string, number>();
  const record = (point: Point) => {
    if (!Number.isFinite(point.time) || !Number.isFinite(point.value) || point.value < 0 || !Number.isInteger(point.value) || point.time > now.getTime()) return;
    const day = dayKey(point.time);
    counts.set(day, Math.max(counts.get(day) ?? 0, point.value));
  };
  points.forEach(record);
  if (live?.time && typeof live.value === "number") record({ time: live.time * 1000, value: live.value });
  const total = (start: string) => {
    const days = [...counts].filter(([day]) => day >= start && day <= today);
    return { value: days.length ? days.reduce((sum, [, value]) => sum + value, 0) : null, start, end: today, recordedDays: days.length, expectedDays: Math.round((midnight.getTime() - new Date(`${start}T00:00:00-03:00`).getTime()) / DAY) + 1 };
  };
  return { weekly: total(starts.weekly), monthly: total(starts.monthly), annual: total(starts.annual) };
}
