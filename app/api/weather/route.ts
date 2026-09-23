import { env } from "cloudflare:workers";
import { lightningTotals } from "@/lib/lightning-totals";

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
  "7d": { days: 7, cycle: "5min", maxPoints: 2016 },
  "30d": { days: 30, cycle: "5min", maxPoints: 8640 },
  "1y": { days: 365, cycle: "4hour", maxPoints: 365 },
};
let weatherInsightCache: { expires: number; insight: WeatherInsight } | null = null;

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
  if (!response.ok) throw new Error("Ecowitt indisponível");
  const payload = (await response.json()) as JsonObject;
  if (Number(payload.code) !== 0) throw new Error("Consulta recusada");
  return payload;
}

function utcDate(date: Date) {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

function numericMetric(item: EcowittMetric | null) {
  const reading = cleanMetric(item);
  const number = Number(reading?.value);
  return Number.isFinite(number) ? number : null;
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

async function weatherInsight(data: unknown, rain: (name: string) => string[][]): Promise<WeatherInsight> {
  if (weatherInsightCache && weatherInsightCache.expires > Date.now()) return weatherInsightCache.insight;
  const fallback = localWeatherInsight(data, rain);
  const apiKey = (env as unknown as Record<string, string | undefined>).TYPESAFE_API_KEY;
  if (!apiKey) return fallback;
  const state = {
    temperature_c: numericMetric(metric(data, [["outdoor", "temperature"]])),
    humidity_percent: numericMetric(metric(data, [["outdoor", "humidity"]])),
    wind_kmh: numericMetric(metric(data, [["wind", "wind_speed"]])),
    gust_kmh: numericMetric(metric(data, [["wind", "wind_gust"]])),
    rain_rate_mmh: numericMetric(metric(data, rain("rain_rate"))),
    uv_index: numericMetric(metric(data, [["solar_and_uvi", "uvi"]])),
    lightning_distance_km: numericMetric(metric(data, [["lightning", "distance"]])),
  };
  try {
    const response = await fetch("https://api.typesafe.ai/v1/systemone", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(900),
      body: JSON.stringify({
        model: "jev-latest",
        state,
        questions: {
          condition: {
            type: "choice",
            instructions: "Qual condição meteorológica predomina agora com base somente nas leituras fornecidas?",
            criteria: {
              stable: "Sem chuva, sem atividade elétrica próxima, vento comum e UV abaixo de 8.",
              rain: "Há chuva em curso indicada por taxa de chuva positiva.",
              strong_wind: "Vento sustentado ou rajada é a condição mais relevante.",
              high_uv: "Índice UV de 8 ou mais é a condição mais relevante.",
              lightning: "Atividade elétrica está a 20 km ou menos e é a condição mais relevante.",
              mixed: "Duas ou mais condições relevantes ocorrem ao mesmo tempo, sem uma claramente dominante.",
            },
          },
          alert: {
            type: "choice",
            instructions: "Qual nível de alerta é adequado apenas para exibição informativa, sem acionar ações?",
            criteria: {
              normal: "Sem chuva em curso, atividade elétrica próxima, vento forte ou UV elevado.",
              attention: "Chuva em curso, UV elevado, vento forte ou atividade elétrica entre 10 e 20 km.",
              alert: "Atividade elétrica a até 10 km ou vento/rajada muito forte, a partir de 60 km/h.",
            },
          },
        },
      }),
    });
    if (!response.ok) return fallback;
    const payload = await response.json() as { answers?: Record<string, { choice?: string; confidence?: number }> };
    const conditionKey = payload.answers?.condition?.choice;
    const alertKey = payload.answers?.alert?.choice;
    const conditionLabels = { stable: "Condições estáveis", rain: "Chuva em curso", strong_wind: "Vento forte", high_uv: "UV elevado", lightning: "Atividade elétrica próxima", mixed: "Condições combinadas" } as const;
    const alertLabels = { normal: "Normal", attention: "Atenção", alert: "Alerta" } as const;
    if (!(conditionKey in conditionLabels) || !(alertKey in alertLabels)) return fallback;
    const insight: WeatherInsight = {
      condition: { key: conditionKey as WeatherInsight["condition"]["key"], label: conditionLabels[conditionKey as keyof typeof conditionLabels], confidence: payload.answers?.condition?.confidence ?? null },
      alert: { key: alertKey as WeatherInsight["alert"]["key"], label: alertLabels[alertKey as keyof typeof alertLabels], confidence: payload.answers?.alert?.confidence ?? null },
      source: "Jev",
      evaluatedAt: Date.now(),
    };
    weatherInsightCache = { insight, expires: Date.now() + 5 * 60_000 };
    return insight;
  } catch {
    return fallback;
  }
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
      const history = await ecowitt("/device/history", {
        ...auth, mac, start_date: utcDate(start), end_date: utcDate(now), cycle_type: range.cycle,
        call_back: "solar_and_uvi", ...units,
      });
      return Response.json({ history: { solar: series(history.data, [["solar_and_uvi", "solar"]], range.maxPoints) } }, { headers: { "Cache-Control": "private, max-age=300" } });
    }
    const callbacks = "outdoor,indoor,pressure,wind,solar_and_uvi,rainfall,rainfall_piezo,lightning,battery";
    const [live, history] = await Promise.all([
      ecowitt("/device/real_time", { ...auth, mac, call_back: "all", ...units }),
      summaryOnly ? Promise.resolve({ data: {} }) : ecowitt("/device/history", {
        ...auth,
        mac,
        start_date: utcDate(start),
        end_date: utcDate(now),
        cycle_type: range.cycle,
        call_back: callbacks,
        ...units,
      }).catch(() => ({ data: {} })),
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
    const insight = extrasOnly && isCurrentObservation ? await weatherInsight(data, rain) : null;
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
