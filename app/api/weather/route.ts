import { sqliteChartExtrema } from "@/lib/weather-chart-extrema";
import { payloadChartExtrema } from "@/lib/chart-extrema";
import { sqliteStatistics } from "@/lib/weather-statistics";
import { recentLightning } from "@/lib/weather-rules";
import { env } from "cloudflare:workers";
import { lightningTotals } from "@/lib/lightning-totals";
import { hasHistoryCoverageGaps, readWeatherHistory, saveWeatherHistory, trimWeatherHistory } from "@/lib/weather-history-store";
import { completedSevenDayWindow, historyCacheKey, saoPauloMidnight, shiftCalendarDate } from "@/lib/weather-history-window";

export const dynamic = "force-dynamic";

type EcowittMetric = { value?: string; unit?: string; time?: string; list?: Record<string, string> };
type JsonObject = Record<string, unknown>;
type RangeKey = "24h" | "7d" | "30d" | "1y";
type WeatherInsight = {
  condition: { key: "stable" | "rain" | "strong_wind" | "high_uv" | "lightning" | "mixed"; label: string; confidence: number | null };
  alert: { key: "normal" | "attention" | "alert"; label: string; confidence: number | null };
  source: "Jev" | "Regras locais";
  evaluatedAt: number;
};

const API_BASE = "https://api.ecowitt.net/api/v3";
const RANGES: Record<RangeKey, { days: number; cycle: string; maxPoints: number }> = {
  "24h": { days: 1, cycle: "5min", maxPoints: 288 },
  "7d": { days: 7, cycle: "30min", maxPoints: 336 },
  "30d": { days: 30, cycle: "4hour", maxPoints: 180 },
  "1y": { days: 365, cycle: "1day", maxPoints: 370 },
};

class HistoryNotImportedError extends Error {
  constructor() {
    super("Histórico ainda não importado para o banco");
    this.name = "HistoryNotImportedError";
  }
}

function asObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : {};
}

function at(root: unknown, ...path: string[]): unknown {
  return path.reduce<unknown>((current, key) => asObject(current)[key], root);
}

function metric(root: unknown, choices: string[][]): EcowittMetric | null {
  for (const path of choices) {
    const candidate = at(root, ...path);
    if (candidate && typeof candidate === "object" && "value" in (candidate as object)) return candidate as EcowittMetric;
  }
  return null;
}

function cleanMetric(item: EcowittMetric | null) {
  if (!item || item.value === undefined || item.value === "-" || String(item.value).trim() === "") return null;
  const numeric = Number(item.value);
  return {
    value: Number.isFinite(numeric) ? numeric : item.value,
    unit: item.unit ?? "",
    time: item.time ? Number(item.time) : null,
  };
}

function vpdMetric(item: EcowittMetric | null) {
  const reading = cleanMetric(item);
  if (!reading) return null;
  if (typeof reading.value === "number" && /inhg/i.test(reading.unit)) return { ...reading, value: reading.value * 3.38639, unit: "kPa" };
  return { ...reading, unit: reading.unit || "kPa" };
}

function series(root: unknown, choices: string[][], maxPoints: number) {
  for (const path of choices) {
    const candidate = at(root, ...path) as EcowittMetric | undefined;
    if (candidate?.list) {
      const entries = Object.entries(candidate.list)
        .filter(([,value]) => value !== null && String(value).trim() !== "")
        .map(([timestamp, value]) => ({ time: Number(timestamp) * 1000, value: Number(value) }))
        .filter((point) => Number.isFinite(point.time) && Number.isFinite(point.value))
        .sort((a, b) => a.time - b.time);
      const stride = Math.max(1, Math.ceil(entries.length / maxPoints));
      const minimum = Math.min(...entries.map(p => p.value)), maximum = Math.max(...entries.map(p => p.value));
      return {
        unit: candidate.unit ?? "",
        points: entries.filter((point, index) => index % stride === 0 || index === entries.length - 1 || point.value === minimum || point.value === maximum),
      };
    }
  }
  return { unit: "", points: [] as { time: number; value: number }[] };
}

function vpdSeries(root: unknown, maxPoints: number) {
  const result = series(root, [["outdoor", "vpd"]], maxPoints);
  if (/inhg/i.test(result.unit)) return { unit: "kPa", points: result.points.map((point) => ({ ...point, value: point.value * 3.38639 })) };
  return { ...result, unit: result.unit || "kPa" };
}

function accumulatedLastHour(root: unknown, choices: string[][]) {
  const result = series(root, choices, 2000);
  if (!result.points.length) return null;
  const last = result.points.at(-1)!;
  const recent = result.points.filter((point) => point.time >= last.time - 60 * 60 * 1000);
  let total = 0;
  for (let index = 1; index < recent.length; index++) {
    const delta = recent[index].value - recent[index - 1].value;
    total += delta >= 0 ? delta : Math.max(0,recent[index].value);
  }
  return { value: total, unit: result.unit || "mm", time: Math.floor(last.time / 1000) };
}

function findDevices(value: unknown, found: JsonObject[] = []): JsonObject[] {
  if (Array.isArray(value)) value.forEach((item) => findDevices(item, found));
  else if (value && typeof value === "object") {
    const object = value as JsonObject;
    if (typeof object.mac === "string") found.push(object);
    Object.values(object).forEach((item) => findDevices(item, found));
  }
  return found;
}

function findValue(value: unknown, keys: string[]): unknown {
  if (!value || typeof value !== "object") return undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findValue(item, keys);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  const object = value as JsonObject;
  for (const key of keys) if (object[key] !== undefined && object[key] !== null && object[key] !== "") return object[key];
  for (const item of Object.values(object)) {
    const found = findValue(item, keys);
    if (found !== undefined) return found;
  }
  return undefined;
}

async function ecowitt(path: string, params: Record<string, string>) {
  const url = new URL(`${API_BASE}${path}`);
  Object.entries(params).forEach(([key, val]) => url.searchParams.set(key, val));
  // A Ecowitt pode ocasionalmente manter uma conexão aberta por muito tempo.
  // Um limite explícito evita que uma única consulta bloqueie toda a página.
  const response = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(8_000) });
  if (!response.ok) throw new Error(`Ecowitt HTTP ${response.status}`);
  const payload = (await response.json()) as JsonObject;
  if (Number(payload.code) !== 0) throw new Error(`Ecowitt código ${String(payload.code)}`);
  return payload;
}

function ecowittLocalDate(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const p = Object.fromEntries(parts.map(p => [p.type, p.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}

function mergeHistory(target: JsonObject, source: JsonObject): JsonObject {
  for (const [key, value] of Object.entries(source)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      target[key] = mergeHistory(asObject(target[key]), value as JsonObject);
    } else {
      target[key] = value;
    }
  }
  return target;
}

async function fetchHistory(auth: Record<string, string>, mac: string, start: Date, end: Date, range: typeof RANGES[RangeKey], callbacks: string, units: Record<string, string>, source: "auto" | "database" | "api" | "refresh" = "auto") {
  // A day/range/callback combination has a stable key across visitors. Recent
  // ranges refresh after five minutes; closed historical ranges remain cached.
  const key = historyCacheKey(mac, range.cycle, callbacks, start, end);
  const recent = end.getTime() >= Date.now() - 2 * 86400000;
  const stored = source === "api" || source === "refresh" ? null : await readWeatherHistory(key, start, end, source === "database" || !recent ? Infinity : 300000, source === "database");
  if (stored) return stored;
  if (source === "database") return {data: {}, incomplete: true, updatedAt: 0, origin: "database" as const};
  // Ecowitt limits each 5-minute query to one day, 30-minute queries to a
  // week, 4-hour queries to a month, and daily queries to a year.
  const chunkMs = range.days === 365 ? 365 * 86400000 : range.days === 30 ? 7 * 86400000 : range.days === 7 ? 2 * 86400000 : 86400000;
  const windows: { start: Date; end: Date }[] = [];
  for (let cursor = start.getTime(); cursor < end.getTime(); cursor += chunkMs) {
    windows.push({ start: new Date(cursor), end: new Date(Math.min(cursor + chunkMs, end.getTime())) });
  }
  const results: PromiseSettledResult<JsonObject>[] = [];
  for (let index = 0; index < windows.length; index += 3) {
    results.push(...await Promise.allSettled(windows.slice(index, index + 3).map((window) => ecowitt("/device/history", {
      ...auth, mac, start_date: ecowittLocalDate(window.start), end_date: ecowittLocalDate(window.end),
      cycle_type: range.cycle, call_back: callbacks, ...units,
    }))));
  }
  // A failed window should not leave a hole when a second attempt succeeds.
  for (const [index, result] of results.entries()) {
    if (result.status === "fulfilled") continue;
    const window = windows[index];
    try {
      results[index] = { status: "fulfilled", value: await ecowitt("/device/history", {
        ...auth, mac, start_date: ecowittLocalDate(window.start), end_date: ecowittLocalDate(window.end),
        cycle_type: range.cycle, call_back: callbacks, ...units,
      }) };
    } catch (error) {
      console.warn("Janela de histórico indisponível", range.cycle, ecowittLocalDate(window.start), error instanceof Error ? error.message : "erro");
    }
  }
  const data = results.reduce<JsonObject>((merged, result) => result.status === "fulfilled" ? mergeHistory(merged, asObject(result.value.data)) : merged, {});
  // Ecowitt may include observations just beyond end_date. Clip every series
  // to the same exact interval used by the SQLite lookup and its cache key.
  trimWeatherHistory(data, start, end);
  const incomplete = results.some((result) => result.status === "rejected") || hasHistoryCoverageGaps(data,range.cycle,Math.floor(start.getTime()/1000),Math.floor(end.getTime()/1000));
  if (source !== "api" && !incomplete && results.length && Object.keys(data).length) {
    const closed = end.getTime() < Date.now() - 2 * 86400000;
    await saveWeatherHistory(key, data, Date.now() + (closed || source === "refresh" ? 10 * 365 : 5 / 1440) * 86400000);
  }
  return { data, incomplete, updatedAt: Date.now(), origin: "api" as const };
}

function numericMetric(item: EcowittMetric | null) {
  const reading = cleanMetric(item);
  const number = Number(reading?.value);
  return Number.isFinite(number) ? number : null;
}

export async function archiveWeather() {
  const applicationKey = env.ECOWITT_APPLICATION_KEY;
  const apiKey = env.ECOWITT_API_KEY;
  if (!applicationKey || !apiKey) throw new Error("Credenciais Ecowitt ausentes");
  const auth = { application_key: applicationKey, api_key: apiKey };
  let mac = env.ECOWITT_MAC;
  if (!mac) {
    const devices = findDevices((await ecowitt("/device/list", auth)).data);
    const selected = devices.find((device) => String(device.id) === String(env.ECOWITT_DEVICE_ID ?? "251816")) ?? devices[0];
    mac = typeof selected?.mac === "string" ? selected.mac : undefined;
  }
  if (!mac) throw new Error("Estação Ecowitt ausente");
  const units = { temp_unitid: "1", pressure_unitid: "3", wind_speed_unitid: "7", rainfall_unitid: "12", solar_irradiance_unitid: "16" };
  const callbacks = "outdoor,indoor,pressure,wind,solar_and_uvi,rainfall,rainfall_piezo,lightning,battery";
  const end = new Date();
  const day = end.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  const midnight = new Date(`${day}T00:00:00-03:00`);
  const imported: string[] = [];
  let incomplete = false;
  let historicalLimit: number | null = null;
  for (const rangeKey of ["24h", "7d", "30d", "1y"] as RangeKey[]) {
    const range = RANGES[rangeKey];
    const start = new Date(midnight.getTime() - (range.days - 1) * 86400000);
    try {
      const result = await fetchHistory(auth, mac, start, end, range, callbacks, units, "refresh");
      if (result.incomplete || !Object.keys(result.data).length) {
        console.warn("Arquivo recente incompleto", rangeKey, result.incomplete ? "janela ausente" : "sem dados");
        incomplete = true;
      }
      else imported.push(rangeKey);
    } catch (error) { console.warn("Falha ao arquivar período", rangeKey, error instanceof Error ? error.message : "erro"); incomplete = true; }
  }
  // Calendar-year snapshots preserve older daily records that the rolling
  // one-year graph no longer includes. Stop once Ecowitt has no older records.
  for (let year = Number(day.slice(0, 4)) - 1; year >= Number(day.slice(0, 4)) - 20; year--) {
    const start = new Date(`${year}-01-01T00:00:00-03:00`);
    const finish = new Date(`${year + 1}-01-01T00:00:00-03:00`);
    try {
      const result = await fetchHistory(auth, mac, start, finish, RANGES["1y"], callbacks, units);
      if (result.incomplete) { historicalLimit = year; break; }
      const hasReadings = Object.values(asObject(result.data)).some((group) => Object.values(asObject(group)).some((sensor) => Object.keys(asObject(asObject(sensor).list)).length > 0));
      if (!hasReadings) break;
      imported.push(String(year));
    } catch (error) {
      console.warn("Consulta de ano anterior indisponível", year, error instanceof Error ? error.message : "erro");
      historicalLimit = year;
      break;
    }
  }
  return { date: day, imported, incomplete, historicalLimit };
}

function localWeatherInsight(data: unknown, rain: (name: string) => string[][]): WeatherInsight {
  const rainRate = numericMetric(metric(data, rain("rain_rate"))) ?? 0;
  const wind = numericMetric(metric(data, [["wind", "wind_speed"]])) ?? 0;
  const gust = numericMetric(metric(data, [["wind", "wind_gust"]])) ?? 0;
  const uv = numericMetric(metric(data, [["solar_and_uvi", "uvi"]])) ?? 0;
  const lightningDistance = numericMetric(metric(data, [["lightning", "distance"]]));
  const lightningTime = Number(metric(data, [["lightning", "distance"]])?.time) || null;
  const lightningActive = recentLightning(lightningDistance, lightningTime);
  const condition = lightningActive ? ["lightning", "Atividade elétrica próxima"] as const
    : rainRate > 0 ? ["rain", "Chuva em curso"] as const
      : Math.max(wind, gust) >= 45 ? ["strong_wind", "Vento forte"] as const
        : uv >= 8 ? ["high_uv", "UV elevado"] as const
          : ["stable", "Condições estáveis"] as const;
  const alert = lightningActive && lightningDistance! <= 10 || Math.max(wind, gust) >= 60 ? ["alert", "Alerta"] as const
    : lightningActive || rainRate > 0 || Math.max(wind, gust) >= 45 || uv >= 8 ? ["attention", "Atenção"] as const
      : ["normal", "Normal"] as const;
  return { condition: { key: condition[0], label: condition[1], confidence: null }, alert: { key: alert[0], label: alert[1], confidence: null }, source: "Regras locais", evaluatedAt: Date.now() };
}

type LightningPoint = { time: number; value: number };
let lightningCache: { mac: string; day: string; expires: number; points: LightningPoint[] } | null = null;
async function annualLightningHistory(mac: string, now: Date): Promise<LightningPoint[]> {
  const day = now.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  if (lightningCache?.mac === mac && lightningCache.day === day && lightningCache.expires > Date.now()) return lightningCache.points;
  const start = new Date(saoPauloMidnight(day).getTime() - 365 * 86400000);
  const key = historyCacheKey(mac, "1day", "lightning", start, now);
  const stored = await readWeatherHistory(key, start, now);
  if (!stored) throw new HistoryNotImportedError();
  const points = series(stored.data, [["lightning", "count"]], Infinity).points.map((point) => ({
    ...point, time: Date.parse(`${new Date(point.time).toISOString().slice(0, 10)}T00:00:00-03:00`),
  }));
  if (!points.length) throw new HistoryNotImportedError();
  lightningCache = { mac, day, expires: Date.now() + 300000, points };
  return points;
}

export async function GET(request: Request) {
  try {
    const requestUrl = new URL(request.url);
    const requestedRange = requestUrl.searchParams.get("range") as RangeKey | null;
    const requestedDate = requestUrl.searchParams.get("date");
    const view = requestUrl.searchParams.get("view");
    const extrasOnly = view === "extras";
    const summaryOnly = view === "summary" || extrasOnly;

    const solarOnly = requestUrl.searchParams.get("view") === "solar";
    const rangeKey: RangeKey = requestedRange && requestedRange in RANGES ? requestedRange : "24h";
    const range = RANGES[rangeKey];
    const requestedSource = requestUrl.searchParams.get("source");
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
    // Only an explicit comparison request may query the API for archived periods.
    const archivedPeriod = rangeKey !== "24h" || Boolean(requestedDate && requestedDate < today);
    const databaseOnly = requestedSource === "database" || (archivedPeriod && requestedSource !== "api");
    const historySource = databaseOnly ? "database" : requestedSource === "api" ? "api" : "auto";
    const historyOnly = view === "history" || databaseOnly;
    const fullDashboard = !summaryOnly && !historyOnly;
    const applicationKey = env.ECOWITT_APPLICATION_KEY;
    const apiKey = env.ECOWITT_API_KEY;
    if (!databaseOnly && (!applicationKey || !apiKey)) throw new Error("Credenciais ausentes");

    const auth = { application_key: applicationKey ?? "", api_key: apiKey ?? "" };
    let mac = env.ECOWITT_MAC;
    if (!mac && env.DB) {
      // The sole production station is resolved locally for both live and archived reads.
      const rows = await env.DB?.prepare("SELECT key FROM weather_history").all<{ key: string }>();
      const stations = [...new Set((rows?.results ?? []).map((row) => row.key.split("|")[0]))];
      if (stations.length === 1) mac = stations[0];
    }
    if (!mac && !databaseOnly) {
      const deviceList = await ecowitt("/device/list", auth);
      const devices = findDevices(deviceList.data);
      const selected = devices.find((device) => String(device.id) === String(env.ECOWITT_DEVICE_ID ?? "251816")) ?? devices[0];
      mac = typeof selected?.mac === "string" ? selected.mac : undefined;
    }
    if (!mac) throw new Error("Estação não localizada");

    const units = {
      temp_unitid: "1",
      pressure_unitid: "3",
      wind_speed_unitid: "7",
      rainfall_unitid: "12",
      solar_irradiance_unitid: "16",
    };
    const actualNow = new Date();
    const validRequestedDate = requestedDate && /^\d{4}-\d{2}-\d{2}$/.test(requestedDate) ? requestedDate : null;
    const referenceDate = validRequestedDate ?? actualNow.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
    const selectedStart = validRequestedDate ? saoPauloMidnight(validRequestedDate) : null;
    const isCurrentObservation = !requestedDate || requestedDate === actualNow.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
    const weeklyWindow = rangeKey === "7d" ? completedSevenDayWindow(referenceDate) : null;
    const now = weeklyWindow?.end ?? (selectedStart ? new Date(Math.min(saoPauloMidnight(shiftCalendarDate(validRequestedDate!, 1)).getTime() - 1000, actualNow.getTime())) : actualNow);
    const start = weeklyWindow?.start ?? (selectedStart
      ? new Date(selectedStart.getTime() - (range.days - 1) * 24 * 60 * 60 * 1000)
      : new Date(now.getTime() - range.days * 24 * 60 * 60 * 1000));
    if (view === "statistics") {
      const digest = await crypto.subtle.digest("SHA-256",new TextEncoder().encode(mac));
      const key = Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,"0")).join("");
      return Response.json({statistics:await sqliteStatistics(key,Math.floor(start.getTime()/1000),Math.floor(now.getTime()/1000))});
    }
    // The generation dashboard needs only raw irradiance. Keep this lean path
    // independent from the station's live readings, forecasts and lightning.
    if (solarOnly) {
      const history = await fetchHistory(auth, mac, start, now, range, "solar_and_uvi", units, historySource);
      return Response.json({ history: { solar: series(history.data, [["solar_and_uvi", "solar"]], range.maxPoints) }, historyIncomplete: history.incomplete }, { headers: { "Cache-Control": "private, max-age=300" } });
    }
    const callbacks = "outdoor,indoor,pressure,wind,solar_and_uvi,rainfall,rainfall_piezo,lightning,battery";
    const [live, history] = await Promise.all([
      databaseOnly ? Promise.resolve({data:{},time:undefined}) : extrasOnly
        ? ecowitt("/device/real_time", { ...auth, mac, call_back: "all", ...units }).catch(() => ({ data: {}, time: undefined }))
        : historyOnly
          ? Promise.resolve({ data: {}, time: undefined })
          : ecowitt("/device/real_time", { ...auth, mac, call_back: "all", ...units }),
      summaryOnly ? Promise.resolve({ data: {}, incomplete: false, updatedAt: 0, origin: "api" as const }) : fetchHistory(auth, mac, start, now, range, callbacks, units, historySource),
    ]);

    let data = live.data;
    let stationKey: string | null = null;
    if (databaseOnly && env.DB) {
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(mac));
      stationKey = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
      const snapshot: JsonObject = {};
      const paths = ["outdoor/temperature","outdoor/humidity","outdoor/feels_like","outdoor/dew_point","outdoor/vpd","indoor/temperature","indoor/humidity","indoor/feels_like","indoor/dew_point","pressure/relative","pressure/absolute","wind/wind_speed","wind/wind_gust","wind/wind_direction","wind/10_minute_average_wind_direction","solar_and_uvi/solar","solar_and_uvi/uvi","rainfall_piezo/rain_rate","rainfall_piezo/daily","rainfall_piezo/weekly","rainfall_piezo/monthly","rainfall_piezo/yearly","rainfall_piezo/1_hour","rainfall_piezo/24_hours","rainfall_piezo/event","lightning/count","lightning/distance","battery/haptic_array_battery","battery/haptic_array_capacitor","battery/lightning_sensor","battery/wh57","battery/wh57_battery","battery/lightning","battery/lightning_sensor_battery","battery/lightning_battery"];
      for (const path of paths) {
        const row = await env.DB.prepare("SELECT value,unit,observed_at FROM ecowitt_history_points WHERE device_key=? AND metric_path=? AND value != '-' ORDER BY observed_at DESC LIMIT 1").bind(stationKey,path).first<{value:string;unit:string;observed_at:number}>();
        if (!row) continue;
        const [group,key] = path.split("/");
        (snapshot[group] ??= {} as JsonObject); (snapshot[group] as JsonObject)[key] = {value:row.value,unit:row.unit,time:String(row.observed_at)};
      }
      data = snapshot;
    }
    const rain = (name: string) => [["rainfall_piezo", name], ["rainfall", name]];
    const battery = (name: string) => [["battery", name]];
    const temperature = cleanMetric(metric(data, [["outdoor", "temperature"]]));
    // A localização é estável; consultar /device/info a cada atualização não
    // melhora a precisão e adiciona uma dependência externa à tela inicial.
    const stationLatitude = -22.39547;
    const stationLongitude = -49.07818;
    const climatempoForecastPromise = extrasOnly ? fetch("https://www.climatempo.com.br/previsao-do-tempo/15-dias/cidade/406/bauru-sp", { headers: { Accept: "text/html", "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(2500) })
      .then(async (response) => {
        if (!response.ok) return null;
        const html = await response.text();
        const current = html.match(/"temperature":(\d+(?:\.\d+)?),"windDirection":"[^"]*","windVelocity":\d+(?:\.\d+)?,"windDirectionDegrees":\d+(?:\.\d+)?,"humidity":\d+(?:\.\d+)?,"condition":"([^"]+)","pressure":\d+(?:\.\d+)?,"icon":"([^"]+)",(?:"iconClass":(?:\[[^\]]*\]|\{[^}]*\}),)?"sensation":(\d+(?:\.\d+)?)/);
        const sun = html.match(/(\d{2}:\d{2})h às (\d{2}:\d{2})h/);
        if (!current) return null;
        const condition = current[2].toLowerCase();
        const weatherCode = /trovo|tempest/.test(condition) ? 95 : /chuva|chuv|pancada/.test(condition) ? 61 : /nuv/.test(condition) ? 3 : 0;
        const today = new Date().toISOString().slice(0, 10);
        return { temperature: Number(current[1]), apparentTemperature: Number(current[4]), weatherCode, sunrise: sun ? `${today}T${sun[1]}:00-03:00` : "", sunset: sun ? `${today}T${sun[2]}:00-03:00` : "", source: "Climatempo" };
      }).catch(() => null) : Promise.resolve(null);
    const openMeteoForecastPromise = extrasOnly ? fetch(`https://api.open-meteo.com/v1/forecast?latitude=${stationLatitude}&longitude=${stationLongitude}&current=temperature_2m,apparent_temperature,weather_code&daily=sunrise,sunset&timezone=America%2FSao_Paulo&forecast_days=1`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(4000) })
      .then(async (response) => {
        if (!response.ok) return null;
        const payload = await response.json() as { current?: Record<string, number>; daily?: Record<string, string[]> };
        return { temperature: Number(payload.current?.temperature_2m), apparentTemperature: Number(payload.current?.apparent_temperature), weatherCode: Number(payload.current?.weather_code), sunrise: payload.daily?.sunrise?.[0] ?? "", sunset: payload.daily?.sunset?.[0] ?? "", source: "Open-Meteo" };
      }).catch(() => null) : Promise.resolve(null);
    // The current cards use archived aggregates without opening extra API windows.
    const uvWindowsPromise = fullDashboard ? Promise.all([
      Promise.resolve({ data: history.data }),
      ...[{ days: 30, cycle: "30min" }, { days: 365, cycle: "4hour" }].map(async (window) => {
        const start = new Date(now.getTime() - window.days * 86400000);
        const stored = await readWeatherHistory(historyCacheKey(mac!, window.cycle, "solar_and_uvi", start, now), start, now);
        return { data: stored?.data ?? {} };
      }),
    ]) : Promise.resolve([{ data: {} }, { data: {} }, { data: {} }]);
    const [climatempoForecast, openMeteoForecast, uvWindows] = await Promise.all([climatempoForecastPromise, openMeteoForecastPromise, uvWindowsPromise]);
    // A failed annual query must never silently fall back to a single day/month.
    // Keep the full annual series separate from the optional UV/chart requests.
    const lightningHistory = fullDashboard ? await annualLightningHistory(mac, actualNow).catch(() => null) : null;
    const lightningCounts = lightningHistory
      ? lightningTotals(lightningHistory, cleanMetric(metric(data, [["lightning", "count"]])), actualNow)
      : null;
    const forecast = climatempoForecast ?? openMeteoForecast;
    const uvMaximum = (source: unknown) => {
      const points = series(source, [["solar_and_uvi", "uvi"]], 20000).points;
      if (!points.length) return null;
      return points.reduce((maximum, point) => point.value > maximum.value ? point : maximum);
    };

    const hourlyLive = cleanMetric(metric(data, [...rain("1_hour"), ...rain("hourly"), ...rain("rain_hourly"), ...rain("rainfall_hourly")]));
    const hourlyReading = hourlyLive ?? (summaryOnly ? null : accumulatedLastHour(history.data, rain("daily")));
    const lightningBatteryPaths = [...battery("wh57"), ...battery("wh57_battery"), ...battery("lightning"), ...battery("lightning_sensor"), ...battery("lightning_sensor_battery"), ...battery("lightning_battery")];
    // A decisão é independente da série dos gráficos e fica em cache por cinco
    // minutos. Caso a IA não responda, a estação continua normal com regras locais.
    const insight = !historyOnly && isCurrentObservation && Object.keys(asObject(data)).length ? localWeatherInsight(data, rain) : null;
    if (extrasOnly) {
      return Response.json({ forecast, insight }, { headers: { "Cache-Control": "private, max-age=60" } });
    }

    const statistics = null;
    // Extrema come from every valid stored observation, independent of drawing decimation.
    // Explicit API comparisons use their complete source payload, including high/low fields.
    const comparisonExtrema = payloadChartExtrema(history.data,Math.floor(start.getTime()/1000),Math.floor(now.getTime()/1000));
    const chartExtrema = databaseOnly && stationKey
      ? await sqliteChartExtrema(stationKey,Math.floor(start.getTime()/1000),Math.floor(now.getTime()/1000))
      : comparisonExtrema;
    const response = Response.json({
      statistics,
      chartExtrema,
      comparisonExtrema,
      station: {
        name: "Estação Meteorológica Bauru",
        location: "Bauru–SP",
        deviceId: "251816",
        gateway: "Ecowitt GW3000",
        latitude: stationLatitude,
        longitude: stationLongitude,
      },
      forecast,
      insight,
      lightningCounts,
      uvMaxima: { daily: uvMaximum(uvWindows[0].data), monthly: uvMaximum(uvWindows[1].data), annual: uvMaximum(uvWindows[2].data) },
      updatedAt: temperature?.time ? temperature.time * 1000 : Number(live.time) * 1000 || Date.now(),
      range: rangeKey,
      historyIncomplete: history.incomplete,
      historySource: history.origin,
      historyStoredAt: history.updatedAt,
      observationSource: databaseOnly ? "database" : "api",
      historyWindow: { start: start.toISOString(), end: now.toISOString(), timeZone: "America/Sao_Paulo", resolution: range.cycle, aggregation: range.cycle === "1day" ? "Agregação diária da origem; extremos do gráfico não equivalem a extremos observados" : "Valores na resolução da origem" },
      metrics: {
        temperature,
        feelsLike: cleanMetric(metric(data, [["outdoor", "feels_like"], ["outdoor", "app_temp"]])),
        dewPoint: cleanMetric(metric(data, [["outdoor", "dew_point"]])),
        humidity: cleanMetric(metric(data, [["outdoor", "humidity"]])),
        vpd: vpdMetric(metric(data, [["outdoor", "vpd"]])),
        indoorTemperature: cleanMetric(metric(data, [["indoor", "temperature"]])),
        indoorHumidity: cleanMetric(metric(data, [["indoor", "humidity"]])),
        indoorFeelsLike: cleanMetric(metric(data, [["indoor", "feels_like"], ["indoor", "app_temp"]])),
        indoorDewPoint: cleanMetric(metric(data, [["indoor", "dew_point"]])),
        windSpeed: cleanMetric(metric(data, [["wind", "wind_speed"]])),
        windGust: cleanMetric(metric(data, [["wind", "wind_gust"]])),
        windDirection: cleanMetric(metric(data, [["wind", "wind_direction"]])),
        windAverageDirection: cleanMetric(metric(data, [["wind", "10_minute_average_wind_direction"]])),
        pressureRelative: cleanMetric(metric(data, [["pressure", "relative"]])),
        pressureAbsolute: cleanMetric(metric(data, [["pressure", "absolute"]])),
        rainRate: cleanMetric(metric(data, rain("rain_rate"))),
        rainEvent: cleanMetric(metric(data, rain("event"))),
        rainHourly: hourlyReading,
        rain24h: cleanMetric(metric(data, [...rain("rain_24h"), ...rain("24_hours")])),
        rainDaily: cleanMetric(metric(data, rain("daily"))),
        rainWeekly: cleanMetric(metric(data, rain("weekly"))),
        rainMonthly: cleanMetric(metric(data, rain("monthly"))),
        rainYearly: cleanMetric(metric(data, rain("yearly"))),
        solar: cleanMetric(metric(data, [["solar_and_uvi", "solar"]])),
        uv: cleanMetric(metric(data, [["solar_and_uvi", "uvi"]])),
        lightningDistance: cleanMetric(metric(data, [["lightning", "distance"]])),
        lightningCount: cleanMetric(metric(data, [["lightning", "count"]])),
        hapticBattery: cleanMetric(metric(data, [...battery("haptic_array_battery"), ...battery("hapticarray_battery")])),
        hapticCapacitor: cleanMetric(metric(data, [...battery("haptic_array_capacitor"), ...battery("hapticarray_capacitor")])),
        lightningBattery: cleanMetric(metric(data, lightningBatteryPaths)),
      },
      history: {
        temperature: series(history.data, [["outdoor", "temperature"]], range.maxPoints),
        temperatureHigh: series(history.data, [["outdoor", "temperature_high"]], Infinity),
        temperatureLow: series(history.data, [["outdoor", "temperature_low"]], Infinity),
        feelsLike: series(history.data, [["outdoor", "feels_like"], ["outdoor", "app_temp"]], range.maxPoints),
        dewPoint: series(history.data, [["outdoor", "dew_point"]], range.maxPoints),
        humidity: series(history.data, [["outdoor", "humidity"]], range.maxPoints),
        vpd: vpdSeries(history.data, range.maxPoints),
        indoorTemperature: series(history.data, [["indoor", "temperature"]], range.maxPoints),
        indoorHumidity: series(history.data, [["indoor", "humidity"]], range.maxPoints),
        indoorFeelsLike: series(history.data, [["indoor", "feels_like"], ["indoor", "app_temp"]], range.maxPoints),
        indoorDewPoint: series(history.data, [["indoor", "dew_point"]], range.maxPoints),
        pressureRelative: series(history.data, [["pressure", "relative"]], range.maxPoints),
        pressureAbsolute: series(history.data, [["pressure", "absolute"]], range.maxPoints),
        windSpeed: series(history.data, [["wind", "wind_speed"]], Infinity),
        windGust: series(history.data, [["wind", "wind_gust"]], Infinity),
        windDirection: series(history.data, [["wind", "wind_direction"]], Infinity),
        rainRate: series(history.data, rain("rain_rate"), range.maxPoints),
        rainEvent: series(history.data, rain("event"), range.maxPoints),
        rainHourly: series(history.data, [...rain("1_hour"), ...rain("hourly"), ...rain("rain_hourly"), ...rain("rainfall_hourly")], range.maxPoints),
        rain24h: series(history.data, [...rain("rain_24h"), ...rain("24_hours")], range.maxPoints),
        rainDaily: series(history.data, rain("daily"), range.maxPoints),
        rainWeekly: series(history.data, rain("weekly"), range.maxPoints),
        rainMonthly: series(history.data, rain("monthly"), range.maxPoints),
        rainYearly: series(history.data, rain("yearly"), range.maxPoints),
        solar: series(history.data, [["solar_and_uvi", "solar"]], range.maxPoints),
        uv: series(history.data, [["solar_and_uvi", "uvi"]], range.maxPoints),
        lightning: series(history.data, [["lightning", "distance"]], range.maxPoints),
        lightningCount: series(history.data, [["lightning", "count"]], range.maxPoints),
        hapticBattery: series(history.data, [...battery("haptic_array_battery"), ...battery("hapticarray_battery")], range.maxPoints),
        hapticCapacitor: series(history.data, [...battery("haptic_array_capacitor"), ...battery("hapticarray_capacitor")], range.maxPoints),
        lightningBattery: series(history.data, lightningBatteryPaths, range.maxPoints),
      },
    }, {
      headers: {
        // Histórico muda apenas quando entra uma nova leitura. A borda atende
        // acessos repetidos sem chamar a Ecowitt e mantém a última resposta
        // utilizável durante a atualização em segundo plano.
        "Cache-Control": `public, max-age=20, s-maxage=${summaryOnly ? 60 : historyOnly ? 180 : 90}, stale-while-revalidate=300`,
      },
    });
    return response;
  } catch (error) {
    if (error instanceof HistoryNotImportedError) {
      return Response.json({ code: "HISTORY_NOT_IMPORTED", error: error.message }, { status: 404, headers: { "Cache-Control": "no-store" } });
    }
    const requestUrl = new URL(request.url);
    console.error("Falha em /api/weather", {
      range: requestUrl.searchParams.get("range"),
      source: requestUrl.searchParams.get("source"),
      errorName: error instanceof Error ? error.name : "UnknownError",
      message: error instanceof Error ? error.message : String(error),
    });
    return Response.json({ error: "Os dados da estação estão temporariamente indisponíveis." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
