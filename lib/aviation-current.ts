import type { AviationCurrent, ConditionKey } from "./weather-condition";

export const AVIATION_METAR_URL = "https://aviationweather.gov/api/data/metar?ids=SBBU&format=json&taf=false";
export const AVIATION_CACHE_MS = 5 * 60_000;
export const AVIATION_MAX_AGE_MS = 65 * 60_000;
const SOURCE = "NOAA Aviation Weather Center · METAR SBBU" as const;
type Metar = { icaoId?: string; reportTime?: string; rawOb?: string; wxString?: string; cover?: string; clouds?: {cover?:string}[]; temp?: number | null };

function metarCondition(report: Metar): {key:ConditionKey; description:string} | null {
  const wx = typeof report.wxString === "string" ? report.wxString : "";
  const raw = typeof report.rawOb === "string" ? report.rawOb : "";
  const weather = `${wx} ${raw}`;
  if (/\bTS(?:RA|SHRA|GS|GR|DZ)?\b/.test(weather)) return {key:"storm",description:"Tempestade reportada no METAR"};
  if (/\b(?:SH|FZ)?RA\b|\b(?:SH|FZ)?DZ\b/.test(weather)) return {key:"rain",description:"Precipitação reportada no METAR"};
  if (/\b(?:FZ)?FG\b|\bBR\b/.test(weather)) return {key:"fog",description:"Neblina reportada no METAR"};
  const clouds = Array.isArray(report.clouds) ? report.clouds.map(x => x?.cover).filter((x): x is string => typeof x === "string") : [];
  const cover = typeof report.cover === "string" ? report.cover : clouds.at(-1);
  if (cover === "OVC" || cover === "BKN") return {key:"cloudy",description:cover === "OVC" ? "Céu encoberto (OVC)" : "Nublado (BKN)"};
  if (clouds.some(x => x === "SCT" || x === "FEW") || cover === "SCT" || cover === "FEW") return {key:"partial",description:"Parcialmente nublado (FEW/SCT)"};
  if (cover === "CLR" || cover === "SKC" || cover === "NSC" || cover === "NCD") return {key:"clear",description:"Céu limpo reportado no METAR"};
  return null;
}

export function parseAviationCurrent(payload: unknown, fetchedAt = Date.now()): AviationCurrent | null {
  const rows = Array.isArray(payload) ? payload as Metar[] : [];
  const report = rows.find(row => row?.icaoId === "SBBU");
  if (!report || typeof report.reportTime !== "string" || !Number.isFinite(fetchedAt)) return null;
  const observed = Date.parse(report.reportTime);
  if (!Number.isFinite(observed) || observed > fetchedAt + 5 * 60_000) return null;
  const condition = metarCondition(report);
  if (!condition) return null;
  return {kind:"current",source:SOURCE,station:"SBBU",code:condition.key,sourceCondition:condition.description,observedAt:new Date(observed).toISOString(),fetchedAt:new Date(fetchedAt).toISOString(),temperature:typeof report.temp === "number" && Number.isFinite(report.temp) ? report.temp : null,apparentTemperature:null};
}

export function createAviationCurrentLoader(fetcher: typeof fetch = (input, options) => globalThis.fetch(input, options), clock: () => number = Date.now) {
  let cache: {value:AviationCurrent|null;expires:number}|null = null;
  let pending:Promise<AviationCurrent|null>|null = null;
  return async ():Promise<AviationCurrent|null> => {
    const now = clock();
    if (cache && now < cache.expires) return cache.value;
    if (pending) return pending;
    pending = (async () => {
      let value:AviationCurrent|null = null;
      try {
        const response = await fetcher(AVIATION_METAR_URL,{method:"GET",cache:"no-store",headers:{Accept:"application/json","Cache-Control":"no-cache",Pragma:"no-cache","User-Agent":"clima2-bauru-current-weather/1.0"},signal:AbortSignal.timeout(6000)});
        if (response.ok) value = parseAviationCurrent(await response.json(),clock());
      } catch { /* unavailable source is never converted to a made-up condition */ }
      cache = {value,expires:clock()+(value ? AVIATION_CACHE_MS : 60_000)};
      return value;
    })();
    try { return await pending; } finally { pending = null; }
  };
}
