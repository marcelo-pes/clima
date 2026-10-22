// Deterministic upstream fixtures. Installed ONLY by the test process, never packaged.
import {readFileSync,appendFileSync} from 'node:fs';
const fixed=Date.parse('2026-10-22T12:00:00Z'), OriginalDate=Date;
globalThis.Date=class extends OriginalDate {constructor(...args){super(...(args.length?args:[fixed]));}static now(){return fixed;}};
const original=globalThis.fetch;
const metric=(value,unit='')=>({value:String(value),unit,time:String(fixed/1000)});
const station={outdoor:{temperature:metric(24,'C'),humidity:metric(60,'%'),feels_like:metric(24,'C')},indoor:{temperature:metric(25,'C'),humidity:metric(55,'%')},pressure:{relative:metric(1013,'hPa')},wind:{wind_speed:metric(5,'km/h'),wind_gust:metric(8,'km/h'),wind_direction:metric(90,'°')},rainfall_piezo:{rain_rate:metric(0,'mm/hr'),daily:metric(0,'mm')},solar_and_uvi:{solar:metric(400,'W/m2'),uvi:metric(3)}};
globalThis.fetch=async(input,options)=>{
 const u=new URL(input instanceof Request?input.url:String(input));
 if(['127.0.0.1','localhost'].includes(u.hostname))return original(input,options);
 if(process.env.CLIMA_TEST_FETCH_LOG)appendFileSync(process.env.CLIMA_TEST_FETCH_LOG,JSON.stringify({host:u.hostname,path:u.pathname})+'\n');
 if(u.hostname==='oss.ecowitt.net')return new Response(readFileSync(new URL('./camera.jpg',import.meta.url)),{headers:{'Content-Type':'image/jpeg'}});
 if(u.hostname==='api.ecowitt.net'){
  let data;
  if(u.pathname.endsWith('/device/list'))data={list:[{id:251816,mac:'test-station',name:'GW3000'},{id:360893,mac:'test-camera',name:'HP10'}]};
  else if(u.pathname.endsWith('/device/real_time'))data=u.searchParams.get('mac')==='test-camera'?{camera:{photo:{time:String(fixed/1000),url:'https://oss.ecowitt.net/test.jpg'}}}:station;
  else if(u.pathname.endsWith('/device/history')){
   data=structuredClone(station);
   for(const group of Object.values(data))for(const item of Object.values(group)){item.list={};for(let t=fixed/1000-86400;t<=fixed/1000;t+=300)item.list[String(t)]=item.value;}
  }else data={};
  return Response.json({code:0,time:String(fixed/1000),data});
 }
 // Weather providers unavailable: exercise existing unavailable/fallback behavior, no live network.
 return new Response('Fixture: provider unavailable',{status:503});
};
