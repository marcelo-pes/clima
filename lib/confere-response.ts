export type ConfereSource = "database" | "api";

export function confereHttpError(status: number, code: string | undefined, source: ConfereSource): string {
  if (status === 404 && code === "HISTORY_NOT_IMPORTED") {
    return "Este período ainda não foi importado para o banco.";
  }
  return `Falha HTTP ${status} ao consultar ${source === "database" ? "o SQLite" : "a API Ecowitt"}.`;
}

export function shouldQueryConfereDatabase(range: string): boolean {
  return range !== "24h";
}

export function weeklyWindowLabelDates(referenceDate: string): { startDate: string; endDate: string } {
  const [year, month, day] = referenceDate.split("-").map(Number);
  const start = new Date(Date.UTC(year, month - 1, day - 7));
  const end = new Date(Date.UTC(year, month - 1, day - 1));
  return { startDate: start.toISOString().slice(0, 10), endDate: end.toISOString().slice(0, 10) };
}
