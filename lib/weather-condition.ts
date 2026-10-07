import { sunTime } from "./sun-time";

export const CONDITION_MAX_AGE_MS = 65 * 60_000;
export type ConditionKey = "clear" | "partial" | "cloudy" | "rain" | "storm" | "fog";
export type ClimatempoCurrent = {
  kind: "current"; source: "Climatempo"; cityId: 406; localeId: 6655;
  code: string; sourceCondition: string; observedAt: string | null; fetchedAt: string;
  sourceDate: string; sourceTime: string; sourceTimeZone: "UTC";
  temperature: number | null; apparentTemperature: number | null;
  refreshFailed?: boolean;
};
export type AviationCurrent = {
  kind: "current"; source: "NOAA Aviation Weather Center · METAR SBBU"; station: "SBBU";
  code: string; sourceCondition: string; observedAt: string; fetchedAt: string;
  temperature: number | null; apparentTemperature: null; refreshFailed?: boolean;
};
export type CurrentWeather = ClimatempoCurrent | AviationCurrent;

// Climatempo's official weather-conditions.pdf. 2r/2rn mean many clouds,
// not rain; 4tn means nocturnal showers, without explicitly reporting thunder.
export const CLIMATEMPO_CODES: Readonly<Record<string, ConditionKey>> = {
  "1":"clear","1n":"clear", "2":"partial","2n":"partial","2r":"partial","2rn":"partial",
  "3":"cloudy","3n":"cloudy", "4":"rain","4r":"rain","4n":"rain","4rn":"rain","4tn":"rain",
  "5":"rain","5n":"rain", "4t":"storm","6":"storm","6n":"storm", "9":"fog",
};
export const CONDITION_VISUALS = {
  clear: {label:"Céu limpo",icons:["sun","moon"],photos:["/weather-clear-day.webp","/weather-clear-night.webp"]},
  partial: {label:"Parcialmente nublado",icons:["cloud-sun","cloud-moon"],photos:["/weather-partial-day.webp","/weather-partial-night.webp"]},
  cloudy: {label:"Nublado",icons:["cloud","cloud"],photos:["/weather-cloudy-day.webp","/weather-cloudy-night.webp"]},
  rain: {label:"Chuva",icons:["rain","rain"],photos:["/weather-rain-day.webp","/weather-rain-night.webp"]},
  storm: {label:"Tempestade",icons:["storm","storm"],photos:["/weather-storm-day.webp","/weather-storm-night.webp"]},
  fog: {label:"Neblina",icons:["fog","fog"],photos:["/weather-fog-day.webp","/weather-fog-night.webp"]},
} as const;

export function currentConditionPresentation(data: CurrentWeather | null | undefined, now = Date.now(), latitude = -22.315, longitude = -49.061) {
  const sourceTimestamp = data?.observedAt && Number.isFinite(Date.parse(data.observedAt)) ? data.observedAt : null;
  const neutral = (status:string,label:string) => ({key:"unknown",status,label,photo:null,icon:"unknown",period:"neutral",observedAt:sourceTimestamp,source:data?.source ?? null});
  if (!data || data.kind !== "current" || !(data.source === "Climatempo" && data.cityId === 406 && data.localeId === 6655 || data.source === "NOAA Aviation Weather Center · METAR SBBU" && data.station === "SBBU")) return neutral("unavailable","Condição indisponível");
  const timestamp = data.observedAt ? Date.parse(data.observedAt) : NaN;
  if (!Number.isFinite(timestamp) || timestamp > now + 5 * 60_000) return neutral("unavailable","Horário da condição indisponível");
  if (data.refreshFailed) return neutral("stale","Falha ao atualizar · dados desatualizados");
  if (now - timestamp > CONDITION_MAX_AGE_MS) return neutral("stale","Condição desatualizada");
  const key: ConditionKey | undefined = data.source === "Climatempo" ? CLIMATEMPO_CODES[data.code] : (data.code as ConditionKey);
  if (!key) return neutral("unknown","Condição não reconhecida");
  const normalizedSourceCondition = data.sourceCondition.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");
  const conditionMatches: Record<ConditionKey, RegExp> = {
    clear: /\b(sol|sem nuvens|ceu limpo)\b/,
    partial: /\b(nuvens|nublado|sol)\b/,
    cloudy: /\bnublado\b/,
    rain: /\b(chuv|chuva|pancada)\w*/,
    storm: /\b(trovoad|tempestade)\w*/,
    fog: /\b(nevoeiro|neblina)\b/,
  };
  if (data.source === "Climatempo" && !conditionMatches[key].test(normalizedSourceCondition)) return neutral("unknown","Condição da fonte inconsistente");
  const date = new Date(now);
  const clock = new Intl.DateTimeFormat("en-GB",{timeZone:"America/Sao_Paulo",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).format(date);
  const sunrise = sunTime(date,latitude,longitude,true), sunset = sunTime(date,latitude,longitude,false);
  if (sunrise === "—" || sunset === "—") return neutral("unavailable","Horário local indisponível");
  const night = clock < sunrise || clock >= sunset;
  const visual = CONDITION_VISUALS[key];
  return {key,status:"current",label:visual.label,photo:visual.photos[night ? 1 : 0],icon:visual.icons[night ? 1 : 0],period:night ? "night" : "day",observedAt:data.observedAt,source:data.source};
}
