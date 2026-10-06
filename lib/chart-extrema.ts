export type ExtremePoint = { time: number; value: number; aggregate?: boolean };
export type ChartExtreme = { minimum: ExtremePoint; maximum: ExtremePoint; unit: string; samples: number };
export type ChartExtrema = Record<string, ChartExtreme>;
export const CHART_PATHS: Record<string,string[]> = {
 temperature:['outdoor/temperature'],feelsLike:['outdoor/feels_like','outdoor/app_temp'],dewPoint:['outdoor/dew_point'],humidity:['outdoor/humidity'],vpd:['outdoor/vpd'],
 indoorTemperature:['indoor/temperature'],indoorFeelsLike:['indoor/feels_like','indoor/app_tempin'],indoorDewPoint:['indoor/dew_point'],indoorHumidity:['indoor/humidity'],
 windSpeed:['wind/wind_speed'],windGust:['wind/wind_gust'],pressureRelative:['pressure/relative'],pressureAbsolute:['pressure/absolute'],solar:['solar_and_uvi/solar'],uv:['solar_and_uvi/uvi'],lightning:['lightning/distance'],
 hapticBattery:['battery/haptic_array_battery','battery/hapticarray_battery'],hapticCapacitor:['battery/haptic_array_capacitor','battery/hapticarray_capacitor'],lightningBattery:['battery/lightning_sensor','battery/wh57','battery/wh57_battery','battery/lightning','battery/lightning_sensor_battery','battery/lightning_battery']
};
export function validExtremePoint(p: ExtremePoint) { return typeof p.value==='number' && Number.isFinite(p.value) && Number.isFinite(p.time); }
export function extremaOfPoints(points: ExtremePoint[], unit: string): ChartExtreme | null {
 const valid=points.filter(validExtremePoint);if(!valid.length)return null;
 return {minimum:valid.reduce((a,b)=>b.value<a.value||b.value===a.value&&b.time<a.time?b:a),maximum:valid.reduce((a,b)=>b.value>a.value||b.value===a.value&&b.time<a.time?b:a),unit,samples:valid.length};
}
export function mapChartExtrema(paths: Record<string,ChartExtreme>): ChartExtrema {
 const out:ChartExtrema={};
 for(const [key,choices] of Object.entries(CHART_PATHS)){
  const path=choices.find(p=>paths[p]);if(!path)continue;const base=paths[path];let minimum={...base.minimum},maximum={...base.maximum};
  for(const suffix of ['_low','_high']){const extra=paths[path+suffix];if(!extra||extra.unit!==base.unit)continue;if(extra.minimum.value<minimum.value)minimum={...extra.minimum,aggregate:true};if(extra.maximum.value>maximum.value)maximum={...extra.maximum,aggregate:true}}
  const factor=key==='vpd'&&/inhg/i.test(base.unit)?3.38639:1;
  out[key]={minimum:{...minimum,value:minimum.value*factor},maximum:{...maximum,value:maximum.value*factor},unit:factor!==1?'kPa':base.unit,samples:base.samples};
 }
 return out;
}
export function payloadChartExtrema(payload: Record<string,unknown>,start:number,end:number):ChartExtrema {
 const paths:Record<string,ChartExtreme>={};
 function visit(node:unknown,path:string[]){if(!node||typeof node!=='object')return;const n=node as Record<string,unknown>;if(n.list&&typeof n.list==='object'){
  const points=Object.entries(n.list).filter(([t,v])=>v!==null&&v!==''&&v!=='-'&&Number.isFinite(Number(v))&&Number(t)>=start&&Number(t)<=end).map(([t,v])=>({time:Number(t)*1000,value:Number(v)}));const item=extremaOfPoints(points,String(n.unit||''));if(item)paths[path.join('/')]=item;
 }for(const [k,v]of Object.entries(n))if(k!=='list')visit(v,[...path,k])}visit(payload,[]);return mapChartExtrema(paths);
}
