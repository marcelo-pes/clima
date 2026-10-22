import type { ClimatempoCurrent } from "./weather-condition";

export const CLIMATEMPO_CURRENT_URL = "https://www.climatempo.com.br/json/myclimatempo/user/weatherNow?idlocale=6655";
export const CURRENT_CACHE_MS = 5 * 60_000;
export const CURRENT_REFRESH_INTERVAL_MS = 5 * 60_000;
export const CURRENT_FAILURE_RETRY_MS = 60_000;

// The public "Agora" feed and its page return dateUpdate without an offset.
// Repeated source snapshots align this clock with UTC; retain the raw value
// and only add Z when normalizing it for America/Sao_Paulo display.
export function climatempoUpdateTime(date: unknown, time: unknown): string | null {
  if (typeof date !== "string" || typeof time !== "string") return null;
  const d = date.match(/^(\d{2})\/(\d{2})\/(\d{4})$/), t = time.match(/^(\d{2}):(\d{2}):(\d{2})$/);
  if (!d || !t) return null;
  const iso = `${d[3]}-${d[2]}-${d[1]}T${t[1]}:${t[2]}:${t[3]}Z`, epoch = Date.parse(iso);
  if (!Number.isFinite(epoch) || new Date(epoch).toISOString().slice(0, 19) !== iso.slice(0, 19)) return null;
  return new Date(epoch).toISOString();
}

const numberOrNull = (value: unknown) => value !== null && value !== "" && value !== undefined && Number.isFinite(Number(value)) ? Number(value) : null;

type ClimatempoPayload = {
  status_code?: number;
  data?: { getWeatherNow?: Array<{ data?: Array<{ locale?: { idcity?: number; idlocale?: number }; weather?: Record<string, unknown> }> }> };
};

export function parseClimatempoCurrent(payload: unknown, fetchedAt = Date.now()): ClimatempoCurrent | null {
  const body = payload as ClimatempoPayload | null;
  if (!body || body.status_code !== 200 || !Number.isFinite(fetchedAt)) return null;
  const groups = body.data?.getWeatherNow;
  if (!Array.isArray(groups)) return null;
  const entry = groups.flatMap((group) => Array.isArray(group?.data) ? group.data : [])
    .find((candidate) => candidate?.locale?.idcity === 406 && candidate.locale.idlocale === 6655);
  const weather = entry?.weather;
  if (!weather || weather.id !== 6655 || weather.name !== "Bauru" || typeof weather.icon !== "string" || !weather.icon || typeof weather.condition !== "string" || !weather.condition.trim()) return null;
  return {
    kind: "current", source: "Climatempo", cityId: 406, localeId: 6655,
    code: weather.icon, sourceCondition: weather.condition.trim(),
    observedAt: climatempoUpdateTime(weather.date, weather.dateUpdate), fetchedAt: new Date(fetchedAt).toISOString(),
    sourceDate: typeof weather.date === "string" ? weather.date : "",
    sourceTime: typeof weather.dateUpdate === "string" ? weather.dateUpdate : "",
    sourceTimeZone: "UTC",
    temperature: numberOrNull(weather.temperature), apparentTemperature: numberOrNull(weather.sensation),
  };
}

export function createClimatempoCurrentLoader(fetcher: typeof fetch = (input, options) => globalThis.fetch(input, options), clock: () => number = Date.now) {
  let cache: { value: ClimatempoCurrent | null; expires: number } | null = null;
  let lastSuccess: ClimatempoCurrent | null = null;
  let pending: Promise<ClimatempoCurrent | null> | null = null;

  const load = async (): Promise<ClimatempoCurrent | null> => {
    const now = clock();
    if (cache && now < cache.expires) return cache.value;
    if (pending) return lastSuccess ? { ...lastSuccess } : pending;

    pending = (async () => {
      let result: ClimatempoCurrent | null = null;
      try {
        const response = await fetcher(CLIMATEMPO_CURRENT_URL, {
          method: "POST", cache: "no-store",
          headers: { Accept: "application/json", "Cache-Control": "no-cache", Pragma: "no-cache", "User-Agent": "Mozilla/5.0" },
          signal: AbortSignal.timeout(6000),
        });
        if (response.ok) result = parseClimatempoCurrent(await response.json(), clock());
      } catch { /* Keep the last source reading and mark it as stale on failure. */ }

      const observed = result?.observedAt ? Date.parse(result.observedAt) : NaN;
      const impossibleClock = !Number.isFinite(observed) || observed > clock() + 5 * 60_000;
      const regressedClock = Boolean(result && lastSuccess?.observedAt && Number.isFinite(observed) && observed < Date.parse(lastSuccess.observedAt));
      if (result && !impossibleClock && !regressedClock) {
        lastSuccess = { ...result, refreshFailed: false };
        cache = { value: lastSuccess, expires: clock() + CURRENT_CACHE_MS };
      } else {
        const retained = lastSuccess ? { ...lastSuccess, refreshFailed: true } : null;
        cache = { value: retained, expires: clock() + CURRENT_FAILURE_RETRY_MS };
      }
      return cache.value;
    })();
    try { return await pending; } finally { pending = null; }
  };

  return load;
}

const loadClimatempoCurrent = createClimatempoCurrentLoader();
let updateTimer: ReturnType<typeof setInterval> | null = null;

/** Start server-side refreshes once, on the first request, and keep them warm between visitors. */
export function startClimatempoCurrentUpdater() {
  if (updateTimer) return;
  void loadClimatempoCurrent();
  updateTimer = setInterval(() => { void loadClimatempoCurrent(); }, CURRENT_REFRESH_INTERVAL_MS);
  updateTimer.unref?.();
}

export function fetchClimatempoCurrent() {
  startClimatempoCurrentUpdater();
  return loadClimatempoCurrent();
}
