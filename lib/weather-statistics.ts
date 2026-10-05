import { env } from "cloudflare:workers";
const cache = new Map<string,{expires:number;data:unknown}>();
export async function sqliteStatistics(device: string, start: number, end: number) {
  if (!env.DB) return null;
  const key = `${device}:${start}:${end}`; const prior = cache.get(key);
  if (prior && prior.expires>Date.now()) return prior.data;
  const hasDaily = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='weather_daily_statistics'").first();
  const sql = hasDaily
    ? "SELECT metric_path,unit,cycle_type,SUM(samples) AS samples,MIN(minimum) AS minimum,MAX(maximum) AS maximum,CASE WHEN metric_path NOT LIKE '%direction%' AND metric_path NOT LIKE 'battery/%' AND metric_path NOT LIKE 'lightning/%' AND (metric_path NOT LIKE 'rainfall%' OR metric_path LIKE '%rain_rate') THEN SUM(total)/SUM(samples) END AS mean,MIN(first) AS first,MAX(last) AS last FROM weather_daily_statistics WHERE device_key=? AND day>=date(?,'unixepoch','-3 hours') AND day<=date(?,'unixepoch','-3 hours') GROUP BY metric_path,unit,cycle_type"
    : "SELECT metric_path,unit,cycle_type,COUNT(*) AS samples,MIN(CAST(value AS REAL)) AS minimum,MAX(CAST(value AS REAL)) AS maximum,AVG(CASE WHEN metric_path NOT LIKE '%direction%' AND metric_path NOT LIKE 'battery/%' AND metric_path NOT LIKE 'lightning/%' AND (metric_path NOT LIKE 'rainfall%' OR metric_path LIKE '%rain_rate') THEN CAST(value AS REAL) END) AS mean,MIN(observed_at) AS first,MAX(observed_at) AS last FROM ecowitt_history_points WHERE device_key=? AND observed_at>=? AND observed_at<=? AND value!='-' AND value!='' GROUP BY metric_path,unit,cycle_type";
  const result = await env.DB.prepare(sql).bind(device,start,end).all<{metric_path:string;unit:string;cycle_type:string;samples:number;minimum:number;maximum:number;mean:number|null;first:number;last:number}>();

  const variables: Record<string,{unit:string;minimum:number;maximum:number;samples:number;first:number;last:number;resolutions:{cycle:string;samples:number;mean:number|null}[]}>={};
  for (const row of result.results ?? []) {
    if (row.metric_path === "outdoor/vpd" && /inhg/i.test(row.unit)) { row.unit="kPa"; row.minimum*=3.38639; row.maximum*=3.38639; if(row.mean!==null)row.mean*=3.38639; }
    const item = variables[row.metric_path] ??= {unit:row.unit,minimum:row.minimum,maximum:row.maximum,samples:0,first:row.first,last:row.last,resolutions:[]};
    item.minimum=Math.min(item.minimum,row.minimum);item.maximum=Math.max(item.maximum,row.maximum);item.samples+=row.samples;item.first=Math.min(item.first,row.first);item.last=Math.max(item.last,row.last);item.resolutions.push({cycle:row.cycle_type,samples:row.samples,mean:row.mean});
  }
  // Daily high/low fields retain observed extremes even when the plotted series is a daily aggregate.
  for (const path of ["outdoor/temperature","outdoor/humidity","indoor/temperature","indoor/humidity","pressure/relative"]) {
    const item=variables[path];if(!item)continue;
    if(variables[path+"_high"])item.maximum=Math.max(item.maximum,variables[path+"_high"].maximum);
    if(variables[path+"_low"])item.minimum=Math.min(item.minimum,variables[path+"_low"].minimum);
  }
  const data={variables,note:"Extremos dos registros disponíveis, incluindo campos high/low da origem quando presentes. Médias amostrais por ciclo solicitado de importação; a origem reduz a cadência dos dados antigos. Não representam média temporal anual nem máxima das médias diárias. Acumuladores de chuva não são somados."};
  if(cache.size>=12)cache.delete(cache.keys().next().value!);cache.set(key,{expires:Date.now()+60000,data});return data;
}
