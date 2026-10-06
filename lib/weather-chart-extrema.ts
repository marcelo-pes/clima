import {env} from 'cloudflare:workers';
import {mapChartExtrema,CHART_PATHS,type ChartExtreme,type ChartExtrema} from './chart-extrema';
const cache=new Map<string,{expires:number;data:ChartExtrema}>();
const valid="value!='-' AND value!='' AND value GLOB '*[0-9]*' AND value NOT GLOB '*[^0-9.eE+-]*' AND CAST(value AS REAL)>-1e308 AND CAST(value AS REAL)<1e308";
type Row={metric_path:string;unit:string;minimum:number;maximum:number;minimum_at:number;maximum_at:number;samples:number};
export async function sqliteChartExtrema(device:string,start:number,end:number):Promise<ChartExtrema>{
 const db=env.DB;if(!db)return {};const key=`${device}:${start}:${end}`;const cached=cache.get(key);if(cached&&cached.expires>Date.now())return cached.data;
 const fullStart=Math.ceil((start-10800)/86400)*86400+10800,fullEnd=Math.floor((end+1-10800)/86400)*86400+10800-1;
 const paths:Record<string,ChartExtreme>={};
 function merge(row:Row){if(!Number.isFinite(row.minimum)||!Number.isFinite(row.maximum)||row.minimum_at===null||row.maximum_at===null)return;const item={minimum:{time:row.minimum_at*1000,value:row.minimum},maximum:{time:row.maximum_at*1000,value:row.maximum},unit:row.unit,samples:row.samples};const old=paths[row.metric_path];if(!old){paths[row.metric_path]=item;return}if(old.unit!==item.unit)return;old.samples+=item.samples;if(item.minimum.value<old.minimum.value||item.minimum.value===old.minimum.value&&item.minimum.time<old.minimum.time)old.minimum=item.minimum;if(item.maximum.value>old.maximum.value||item.maximum.value===old.maximum.value&&item.maximum.time<old.maximum.time)old.maximum=item.maximum}
 const columns=await db.prepare("SELECT name FROM pragma_table_info('weather_daily_statistics') WHERE name='minimum_at'").first();
 let edges:[number,number][]=[];
 if(columns&&fullStart<=fullEnd){
  const sql=`WITH bounds AS (SELECT metric_path,unit,MIN(minimum) minimum,MAX(maximum) maximum,SUM(samples) samples FROM weather_daily_statistics WHERE device_key=? AND day>=date(?,'unixepoch','-3 hours') AND day<=date(?,'unixepoch','-3 hours') GROUP BY metric_path,unit)
   SELECT b.*,MIN(CASE WHEN d.minimum=b.minimum THEN d.minimum_at END) minimum_at,MIN(CASE WHEN d.maximum=b.maximum THEN d.maximum_at END) maximum_at FROM bounds b JOIN weather_daily_statistics d ON d.metric_path=b.metric_path AND d.unit=b.unit WHERE d.device_key=? AND d.day>=date(?,'unixepoch','-3 hours') AND d.day<=date(?,'unixepoch','-3 hours') GROUP BY b.metric_path,b.unit`;
  const r=await db.prepare(sql).bind(device,fullStart,fullEnd,device,fullStart,fullEnd).all<Row>();for(const row of r.results??[])merge(row);
  if(start<fullStart)edges.push([start,fullStart-1]);if(end>fullEnd)edges.push([fullEnd+1,end]);
 }else edges=[[start,end]];
 const metrics=[...new Set(Object.values(CHART_PATHS).flatMap(paths=>paths.flatMap(p=>[p,p+'_high',p+'_low'])))];
 for(const [a,b]of edges)for(const metric of metrics){
  const r=await db.prepare(`WITH readings AS (SELECT metric_path,unit,observed_at,CAST(value AS REAL) amount FROM ecowitt_history_points WHERE device_key=? AND metric_path=? AND observed_at>=? AND observed_at<=? AND ${valid}), bounds AS (SELECT metric_path,unit,MIN(amount) minimum,MAX(amount) maximum,COUNT(*) samples FROM readings GROUP BY metric_path,unit) SELECT b.*,MIN(CASE WHEN r.amount=b.minimum THEN r.observed_at END) minimum_at,MIN(CASE WHEN r.amount=b.maximum THEN r.observed_at END) maximum_at FROM bounds b JOIN readings r ON r.metric_path=b.metric_path AND r.unit=b.unit GROUP BY b.metric_path,b.unit`).bind(device,metric,a,b).all<Row>();for(const row of r.results??[])merge(row);
 }
 const data=mapChartExtrema(paths);if(cache.size>=12)cache.delete(cache.keys().next().value!);cache.set(key,{expires:Date.now()+60000,data});return data;
}
