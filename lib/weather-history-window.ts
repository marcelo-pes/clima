const HISTORY_TIME_ZONE = "America/Sao_Paulo";

export function shiftCalendarDate(date: string, days: number): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`Data inválida: ${date}`);
  const [year, month, day] = date.split("-").map(Number);
  const value = new Date(Date.UTC(year, month - 1, day));
  if (value.getUTCFullYear() !== year || value.getUTCMonth() !== month - 1 || value.getUTCDate() !== day) {
    throw new Error(`Data inválida: ${date}`);
  }
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function saoPauloMidnight(date: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`Data inválida: ${date}`);
  const [year, month, day] = date.split("-").map(Number);
  const targetUtc = Date.UTC(year, month - 1, day);
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: HISTORY_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  let instant = targetUtc;
  for (let attempt = 0; attempt < 3; attempt++) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(instant)).map((part) => [part.type, part.value]));
    const localAsUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
    instant = targetUtc - (localAsUtc - instant);
  }
  return new Date(instant);
}

export function completedSevenDayWindow(referenceDate: string) {
  const startDate = shiftCalendarDate(referenceDate, -7);
  const endDate = shiftCalendarDate(referenceDate, -1);
  const anchorMidnight = saoPauloMidnight(referenceDate);
  return {
    startDate,
    endDate,
    start: saoPauloMidnight(startDate),
    end: new Date(anchorMidnight.getTime() - 1000),
  };
}

export function historyCacheKey(mac: string, cycle: string, callbacks: string, start: Date, end: Date): string {
  return [mac, cycle, callbacks, Math.floor(start.getTime() / 1000), Math.floor(end.getTime() / 1000)].join("|");
}
