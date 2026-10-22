import { fetchClimatempoCurrent } from "./climatempo-current";
import { createAviationCurrentLoader } from "./aviation-current";
import type { CurrentWeather } from "./weather-condition";

const fetchAviationCurrent = createAviationCurrentLoader();

export function selectCurrentWeather(climatempo: CurrentWeather | null, metar: CurrentWeather | null, now = Date.now()): CurrentWeather | null {
  const records: (CurrentWeather | null)[] = [climatempo, metar];
  const usable = (item: CurrentWeather | null): item is CurrentWeather => Boolean(item && !item.refreshFailed && Number.isFinite(Date.parse(item.observedAt ?? "")) && now - Date.parse(item.observedAt!) <= 65 * 60_000 && Date.parse(item.observedAt!) <= now + 5 * 60_000);
  if (usable(climatempo)) return climatempo;
  if (usable(metar)) return metar;
  const available = records.filter((item): item is CurrentWeather => item !== null && Boolean(item.observedAt && Number.isFinite(Date.parse(item.observedAt))));
  return available.sort((a,b) => Date.parse(b.observedAt!) - Date.parse(a.observedAt!))[0] ?? null;
}

/** Prefer a valid Climatempo observation; use SBBU METAR when it is stale or unavailable. */
export async function fetchCurrentWeather(now = Date.now()): Promise<CurrentWeather | null> {
  const [climatempo, metar] = await Promise.all([fetchClimatempoCurrent(), fetchAviationCurrent()]);
  return selectCurrentWeather(climatempo, metar, now);
}
