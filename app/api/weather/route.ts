import { env } from "cloudflare:workers";
import { lightningTotals } from "@/lib/lightning-totals";
import { readWeatherHistory, saveWeatherHistory } from "@/lib/weather-history-store";

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
  if (!item || item.value === undefined || item.value === "-") return null;
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
        .map(([timestamp, value]) => ({ time: Number(timestamp) * 1000, value: Number(value) }))
        .filter((point) => Number.isFinite(point.time) && Number.isFinite(point.value))
        .sort((a, b) => a.time - b.time);
      const stride = Math.max(1, Math.ceil(entries.length / maxPoints));
      return {
        unit: candidate.unit ?? "",
        points: entries.filter((_, index) => index % stride === 0 || index === entries.length - 1),
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
  if (!result.points.length) return { value: 0, unit: result.unit || "mm", time: Math.floor(Date.now() / 1000) };
  const last = result.points.at(-1)!;
  const recent = result.points.filter((point) => point.time >= last.time - 60 * 60 * 1000);
  let total = 0;
  for (let index = 1; index < recent.length; index++) total += Math.max(0, recent[index].value - recent[index - 1].value);
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

function utcDate(date: Date) {
  return date.toISOString().slice(0, 19).replace("T", " ");
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
  const key = [mac, range.cycle, callbacks, utcDate(start).slice(0, 10), utcDate(end).slice(0, 10)].join("|");
  const recent = end.getTime() >= Date.now() - 2 * 86400000;
  const stored = source === "api" || source === "refresh" ? null : await readWeatherHistory(key, source === "database" || !recent ? Infinity : 300000);
  if (stored) return stored;
  if (source === "database") throw new Error("Histórico ainda não importado para o banco");
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
      ...auth, mac, start_date: utcDate(window.start), end_date: utcDate(window.end),
      cycle_type: range.cycle, call_back: callbacks, ...units,
    }))));
  }
  // A failed window should not leave a hole when a second attempt succeeds.
  for (const [index, result] of results.entries()) {
    if (result.status === "fulfilled") continue;
    const window = windows[index];
    try {
      results[index] = { status: "fulfilled", value: await ecowitt("/device/history", {
        ...auth, mac, start_date: utcDate(window.start), end_date: utcDate(window.end),
        cycle_type: range.cycle, call_back: callbacks, ...units,
      }) };
    } catch (error) {
      console.warn("Janela de histórico indisponível", range.cycle, utcDate(window.start), error instanceof Error ? error.message : "erro");
    }
  }
  const data = results.reduce<JsonObject>((merged, result) => result.status === "fulfilled" ? mergeHistory(merged, asObject(result.value.data)) : merged, {});
  const incomplete = results.some((result) => result.status === "rejected");
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
  const condition = lightningDistance !== null && lightningDistance <= 20 ? ["lightning", "Atividade elétrica próxima"] as const
    : rainRate > 0 ? ["rain", "Chuva em curso"] as const
      : Math.max(wind, gust) >= 45 ? ["strong_wind", "Vento forte"] as const
        : uv >= 8 ? ["high_uv", "UV elevado"] as const
          : ["stable", "Condições estáveis"] as const;
  const alert = lightningDistance !== null && lightningDistance <= 10 || Math.max(wind, gust) >= 60 ? ["alert", "Alerta"] as const
    : lightningDistance !== null && lightningDistance <= 20 || rainRate > 0 || Math.max(wind, gust) >= 45 || uv >= 8 ? ["attention", "Atenção"] as const
      : ["normal", "Normal"] as const;
  return { condition: { key: condition[0], label: condition[1], confidence: null }, alert: { key: alert[0], label: alert[1], confidence: null }, source: "Regras locais", evaluatedAt: Date.now() };
}

type LightningPoint = { time: number; value: number };
let lightningCache: { mac: string; day: string; expires: number; points: LightningPoint[] } | null = null;
let lightningPending: { key: string; promise: Promise<LightningPoint[]> } | null = null;
async function annualLightningHistory(auth: Record<string, string>, mac: string, now: Date): Promise<LightningPoint[]> {
  const day = now.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  if (lightningCache?.mac === mac && lightningCache.day === day && lightningCache.expires > Date.now()) return lightningCache.points;
  const midnight = new Date(`${day}T00:00:00-03:00`);
  const periodStart = new Date(midnight.getTime() - 364 * 86400000);
  const key = `${mac}:${day}`;
  if (lightningPending?.key === key) return lightningPending.promise;
  const promise = (async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      // Ecowitt limits request frequency. Query after the other history calls,
      // with a pause and retries instead of converting an API rejection to {}.
      await new Promise((resolve) => setTimeout(resolve, (attempt + 1) * 1200));
      try {
        const result = await ecowitt("/device/history", { ...auth, mac, start_date: `${new Date(periodStart.getTime() - 86400000).toISOString().slice(0, 10)} 00:00:00`, end_date: `${day} 00:00:00`, cycle_type: "1day", call_back: "lightning" });
        // Ecowitt's daily buckets use UTC midnight as a date label, not
        // the time of a strike. Preserve that calendar date in Bauru.
        const points = series(result.data, [["lightning", "count"]], Infinity).points.map((point) => ({
          ...point, time: Date.parse(`${new Date(point.time).toISOString().slice(0, 10)}T00:00:00-03:00`),
        }));
        if (!points.length) throw new Error("Histórico anual de raios indisponível");
        lightningCache = { mac, day, expires: Date.now() + 300000, points };
        return points;
      } catch { /* Retry the same complete history, never substitute a shorter period. */ }
    }
    throw new Error("Histórico anual de raios indisponível");
  })();
  lightningPending = { key, promise };
  try { return await promise; } finally { if (lightningPending?.promise === promise) lightningPending = null; }
}

export async function GET(request: Request) {
  try {
    const requestUrl = new URL(request.url);
    const requestedRange = requestUrl.searchParams.get("range") as RangeKey | null;
    const requestedDate = requestUrl.searchParams.get("date");
    const view = requestUrl.searchParams.get("view");
    const extrasOnly = view === "extras";
    const summaryOnly = view === "summary" || extrasOnly;
    const historyOnly = view === "history";
    const fullDashboard = !summaryOnly && !historyOnly;
    const solarOnly = requestUrl.searchParams.get("view") === "solar";
    const rangeKey: RangeKey = requestedRange && requestedRange in RANGES ? requestedRange : "24h";
    const range = RANGES[rangeKey];
    const requestedSource = requestUrl.searchParams.get("source");
    const historySource = requestedSource === "database" || requestedSource === "api" ? requestedSource : "auto";
    const applicationKey = env.ECOWITT_APPLICATION_KEY;
    const apiKey = env.ECOWITT_API_KEY;
    if (!applicationKey || !apiKey) throw new Error("Credenciais ausentes");

    const auth = { application_key: applicationKey, api_key: apiKey };
    let mac = env.ECOWITT_MAC;
    if (!mac) {
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
    const selectedStart = requestedDate && /^\d{4}-\d{2}-\d{2}$/.test(requestedDate) ? new Date(`${requestedDate}T00:00:00-03:00`) : null;
    const isCurrentObservation = !requestedDate || requestedDate === actualNow.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
    const now = selectedStart ? new Date(Math.min(selectedStart.getTime() + 24 * 60 * 60 * 1000 - 1000, actualNow.getTime())) : actualNow;
    const start = selectedStart
      ? new Date(selectedStart.getTime() - (range.days - 1) * 24 * 60 * 60 * 1000)
      : new Date(now.getTime() - range.days * 24 * 60 * 60 * 1000);
    // The generation dashboard needs only raw irradiance. Keep this lean path
    // independent from the station's live readings, forecasts and lightning.
    if (solarOnly) {
      const history = await fetchHistory(auth, mac, start, now, range, "solar_and_uvi", units, historySource);
      return Response.json({ history: { solar: series(history.data, [["solar_and_uvi", "solar"]], range.maxPoints) }, historyIncomplete: history.incomplete }, { headers: { "Cache-Control": "private, max-age=300" } });
    }
    const callbacks = "outdoor,indoor,pressure,wind,solar_and_uvi,rainfall,rainfall_piezo,lightning,battery";
    const [live, history] = await Promise.all([
      extrasOnly
        ? ecowitt("/device/real_time", { ...auth, mac, call_back: "all", ...units }).catch(() => ({ data: {}, time: undefined }))
        : ecowitt("/device/real_time", { ...auth, mac, call_back: "all", ...units }),
      summaryOnly ? Promise.resolve({ data: {}, incomplete: false, updatedAt: 0, origin: "api" as const }) : fetchHistory(auth, mac, start, now, range, callbacks, units, historySource),
    ]);

    const data = live.data;
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
    const uvWindowsPromise = fullDashboard ? Promise.all([{ days: 1, cycle: "5min" }, { days: 30, cycle: "30min" }, { days: 365, cycle: "4hour" }].map((window) =>
      ecowitt("/device/history", { ...auth, mac, start_date: utcDate(new Date(now.getTime() - window.days * 86400000)), end_date: utcDate(now), cycle_type: window.cycle, call_back: "solar_and_uvi", ...units }).catch(() => ({ data: {} })),
    )) : Promise.resolve([{ data: {} }, { data: {} }, { data: {} }]);
    const [climatempoForecast, openMeteoForecast, uvWindows] = await Promise.all([climatempoForecastPromise, openMeteoForecastPromise, uvWindowsPromise]);
    // A failed annual query must never silently fall back to a single day/month.
    // Keep the full annual series separate from the optional UV/chart requests.
    const lightningHistory = fullDashboard ? await annualLightningHistory(auth, mac, actualNow).catch(() => null) : null;
    const lightningCounts = lightningHistory
      ? lightningTotals(lightningHistory, cleanMetric(metric(data, [["lightning", "count"]])), actualNow)
      : null;
    const forecast = climatempoForecast ?? openMeteoForecast;
    const uvMaximum = (source: unknown) => {
      const points = series(source, [["solar_and_uvi", "uvi"]], 20000).points;
      if (!points.length) return null;
      return points.reduce((maximum, point) => point.value > maximum.value ? point : maximum);
    };

    const hourlyLive = cleanMetric(metric(data, [...rain("hourly"), ...rain("rain_hourly"), ...rain("rainfall_hourly")]));
    const hourlyReading = hourlyLive ?? (summaryOnly ? null : accumulatedLastHour(history.data, rain("daily")));
    const lightningBatteryPaths = [...battery("wh57"), ...battery("wh57_battery"), ...battery("lightning"), ...battery("lightning_sensor"), ...battery("lightning_sensor_battery"), ...battery("lightning_battery")];
    // A decisão é independente da série dos gráficos e fica em cache por cinco
    // minutos. Caso a IA não responda, a estação continua normal com regras locais.
    const insight = extrasOnly && isCurrentObservation && Object.keys(asObject(data)).length ? localWeatherInsight(data, rain) : null;
    if (extrasOnly) {
      return Response.json({ forecast, insight }, { headers: { "Cache-Control": "private, max-age=60" } });
    }

    const response = Response.json({
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
        rainHourly: series(history.data, [...rain("hourly"), ...rain("rain_hourly"), ...rain("rainfall_hourly")], range.maxPoints),
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
  } catch {
    return Response.json({ error: "Os dados da estação estão temporariamente indisponíveis." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
