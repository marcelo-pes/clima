import { env } from "cloudflare:workers";

type StoredHistory = { data: Record<string, unknown>; incomplete: boolean; updatedAt: number; origin: "database" };
type JsonObject = Record<string, unknown>;

function mergeHistory(target: JsonObject, source: JsonObject): JsonObject {
  for (const [key, value] of Object.entries(source)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const previous = target[key];
      target[key] = mergeHistory(previous && typeof previous === "object" && !Array.isArray(previous) ? previous as JsonObject : {}, value as JsonObject);
    } else target[key] = value;
  }
  return target;
}

function trimHistory(value: unknown, minSeconds: number, maxSeconds: number): void {
  if (Array.isArray(value)) { value.forEach((item) => trimHistory(item, minSeconds, maxSeconds)); return; }
  if (!value || typeof value !== "object") return;
  const object = value as JsonObject;
  if (object.list && typeof object.list === "object" && !Array.isArray(object.list)) {
    object.list = Object.fromEntries(Object.entries(object.list as Record<string, unknown>).filter(([stamp]) => {
      const time = Number(stamp);
      return Number.isFinite(time) && time >= minSeconds && time <= maxSeconds;
    }));
  }
  for (const [key, item] of Object.entries(object)) if (key !== "list") trimHistory(item, minSeconds, maxSeconds);
}

export function trimWeatherHistory(data: Record<string, unknown>, start: Date, end: Date): void {
  trimHistory(data, Math.floor(start.getTime() / 1000), Math.floor(end.getTime() / 1000));
}

async function readImportedHistory(key: string, requestedStart: Date, requestedEnd: Date): Promise<StoredHistory | null> {
  const [deviceKey, cycle, , startKey, endKey] = key.split("|");
  if (!deviceKey || !cycle || !/^\d+$/.test(startKey ?? "") || !/^\d+$/.test(endKey ?? "")) return null;
  const start = Math.floor(requestedStart.getTime() / 1000);
  const end = Math.floor(requestedEnd.getTime() / 1000);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start !== Number(startKey) || end !== Number(endKey)) return null;
  const db = env.DB;
  if (!db) return null;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(deviceKey));
  const stationKey = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  const rows = await db.prepare("SELECT payload, start_ts, end_ts FROM ecowitt_history_import_chunks WHERE device_key = ? AND cycle_type = ? AND status = ? AND end_ts >= ? AND start_ts <= ? ORDER BY start_ts")
    .bind(stationKey, cycle, "complete", start, end).all<{ payload: string | null; start_ts: number; end_ts: number }>();
  const data: JsonObject = {};
  let hasPayload = false;
  let coveredUntil = start - 1;
  let incomplete = false;
  for (const row of rows.results ?? []) {
    if (!row.payload) continue;
    try {
      mergeHistory(data, JSON.parse(row.payload) as JsonObject);
      hasPayload = true;
      if (row.start_ts > coveredUntil + 1) incomplete = true;
      coveredUntil = Math.max(coveredUntil, row.end_ts);
    } catch { incomplete = true; }
  }
  if (!hasPayload) return null;
  trimWeatherHistory(data, requestedStart, requestedEnd);
  return { data, incomplete: incomplete || coveredUntil < end, updatedAt: coveredUntil * 1000, origin: "database" };
}

export async function readWeatherHistory(key: string, start: Date, end: Date, maxAgeMs = Infinity, strict = false): Promise<StoredHistory | null> {
  try {
    const db = env.DB;
    if (!db) {
      if (strict) throw new Error("Binding D1 DB indisponível");
      return null;
    }
    const row = await db.prepare("SELECT payload, updated_at FROM weather_history WHERE key = ? AND expires_at > ?")
      .bind(key, Date.now()).first<{ payload: string; updated_at: number }>();
    if (row && Date.now() - row.updated_at <= maxAgeMs) {
      const data = JSON.parse(row.payload) as Record<string, unknown>;
      trimWeatherHistory(data, start, end);
      return { data, incomplete: false, updatedAt: row.updated_at, origin: "database" };
    }
    // Imported checkpoints cannot satisfy a live request after its cache expires.
    return maxAgeMs === Infinity ? await readImportedHistory(key, start, end) : null;
  } catch (error) {
    console.error("Falha ao ler o histórico armazenado", error);
    if (strict) throw error;
    return null;
  }
}

export async function saveWeatherHistory(key: string, data: Record<string, unknown>, expiresAt: number) {
  try {
    const db = env.DB;
    if (!db) return;
    await db.prepare("INSERT INTO weather_history (key, payload, updated_at, expires_at) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at, expires_at = excluded.expires_at")
      .bind(key, JSON.stringify(data), Date.now(), expiresAt).run();
  } catch (error) {
    console.error("Falha ao gravar o histórico armazenado", error);
  }
}
