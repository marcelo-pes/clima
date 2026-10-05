import { env } from "cloudflare:workers";

type StoredHistory = { data: Record<string, unknown>; incomplete: boolean; updatedAt: number; origin: "database" };
type JsonObject = Record<string, unknown>;

function mergeHistory(target: JsonObject, source: JsonObject): JsonObject {
  for (const [key, value] of Object.entries(source)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const previous = target[key];
      target[key] = mergeHistory(previous && typeof previous === "object" && !Array.isArray(previous) ? previous as JsonObject : {}, value as JsonObject);
    } else if (value !== "-" || target[key] === undefined || target[key] === "-") target[key] = value;
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

// A successful API checkpoint is not evidence of complete sensor coverage.
export function hasHistoryCoverageGaps(data: JsonObject, cycle: string, start: number, end: number): boolean {
  const step = ({ "5min": 300, "30min": 1800, "4hour": 14400, "1day": 86400 } as Record<string, number>)[cycle];
  if (!step) return true;
  const required = ["outdoor/temperature", "outdoor/humidity", "indoor/temperature", "indoor/humidity", "pressure/relative", "wind/wind_speed", "wind/wind_gust", "wind/wind_direction", "solar_and_uvi/solar", "solar_and_uvi/uvi", "rainfall_piezo/daily"];
  return required.some((path) => {
    let node: unknown = data;
    for (const part of path.split("/")) node = node && typeof node === "object" ? (node as JsonObject)[part] : undefined;
    const list = node && typeof node === "object" ? (node as JsonObject).list : undefined;
    if (!list || typeof list !== "object") return true;
    const times = Object.entries(list).filter(([t, v]) => v !== "-" && v !== "" && v !== null && Number.isFinite(Number(v)) && Number(t) >= start && Number(t) <= end).map(([t]) => Number(t)).sort((a, b) => a - b);
    if (!times.length) return true;
    // Infer the provider's sampling phase; do not assume Brasília midnight for daily readings.
    const phases = new Map<number, number>();
    for (const t of times) phases.set(t % step, (phases.get(t % step) ?? 0) + 1);
    const phase = [...phases].sort((a, b) => b[1] - a[1])[0][0];
    const first = Math.ceil((start - phase) / step) * step + phase;
    const last = Math.floor((end - phase) / step) * step + phase;
    const seen = new Set(times);
    for (let t = first; t <= last; t += step) if (!seen.has(t)) return true;
    return false;
  });
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
  const rows = await db.prepare("SELECT payload, start_ts, end_ts FROM ecowitt_history_import_chunks WHERE device_key = ? AND cycle_type = ? AND status != ? AND end_ts >= ? AND start_ts <= ? ORDER BY start_ts")
    .bind(stationKey, cycle, "empty", start, end).all<{ payload: string | null; start_ts: number; end_ts: number }>();
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
  return { data, incomplete: incomplete || coveredUntil < end || hasHistoryCoverageGaps(data, cycle, start, end), updatedAt: coveredUntil * 1000, origin: "database" };
}

export async function readWeatherHistory(key: string, start: Date, end: Date, maxAgeMs = Infinity, strict = false): Promise<StoredHistory | null> {
  try {
    const db = env.DB;
    if (!db) {
      if (strict) throw new Error("Binding D1 DB indisponível");
      return null;
    }
    // Closed periods prefer reconciled checkpoints. A legacy cached response may
    // omit readings that were subsequently recovered by the independent importer.
    if (maxAgeMs === Infinity) {
      const imported = await readImportedHistory(key,start,end);
      if (imported) return imported;
    }
    const row = await db.prepare("SELECT payload, updated_at FROM weather_history WHERE key = ? AND expires_at > ?")
      .bind(key, Date.now()).first<{ payload: string; updated_at: number }>();
    if (row && Date.now() - row.updated_at <= maxAgeMs) {
      const data = JSON.parse(row.payload) as Record<string, unknown>;
      trimWeatherHistory(data, start, end);
      return { data, incomplete: hasHistoryCoverageGaps(data, key.split("|")[1], Math.floor(start.getTime() / 1000), Math.floor(end.getTime() / 1000)), updatedAt: row.updated_at, origin: "database" };
    }
    // Imported checkpoints cannot satisfy a live request after its cache expires.
    return null;
  } catch (error) {
    console.error("Falha ao ler o histórico armazenado", error);
    if (strict) throw error;
    return null;
  }
}

export async function saveWeatherHistory(key: string, data: Record<string, unknown>, expiresAt: number) {
  if (env.WEATHER_HISTORY_READ_ONLY === "true") return;
  try {
    const db = env.DB;
    if (!db) return;
    await db.prepare("INSERT INTO weather_history (key, payload, updated_at, expires_at) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at, expires_at = excluded.expires_at")
      .bind(key, JSON.stringify(data), Date.now(), expiresAt).run();
  } catch (error) {
    console.error("Falha ao gravar o histórico armazenado", error);
  }
}
