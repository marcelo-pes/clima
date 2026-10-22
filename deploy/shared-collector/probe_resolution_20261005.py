import importlib.util,json,collections,time,datetime
spec=importlib.util.spec_from_file_location('m','/root/CLIMA/Clima/scripts/ecowitt_history_import.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);v=m.read_vars();auth={'application_key':v['ECOWITT_APPLICATION_KEY'],'api_key':v['ECOWITT_API_KEY']};mac=v.get('ECOWITT_MAC')
if not mac:
 f=[];m.find_devices(m.request_api('/device/list',auth).get('data'),f);mac=next(d for d in f if str(d.get('id',d.get('device_id')))==str(v.get('ECOWITT_DEVICE_ID','251816'))).get('mac')
report=[]
for day in ['2025-05-13','2025-10-19','2026-06-24','2026-07-08','2026-09-24']:
 data=m.request_api('/device/history',{**auth,'mac':mac,'start_date':day+' 00:00:00','end_date':day+' 23:59:59','cycle_type':'5min','call_back':'outdoor,wind',**m.UNITS}).get('data') or {};points=list(m.iter_series(data));temp=sorted(set(p[1] for p in points if p[0]=='outdoor/temperature'));diff=collections.Counter(b-a for a,b in zip(temp,temp[1:]));gust=[p for p in points if p[0]=='wind/wind_gust' and p[2]!='-'];row={'day':day,'requested_cycle':'5min','temperature_samples':len(temp),'observed_steps_seconds':dict(diff),'first':m.iso(temp[0]) if temp else None,'last':m.iso(temp[-1]) if temp else None};
 if day=='2025-10-19':row['gust_118_4_confirmed']=any(p[2]=='118.4' for p in gust)
 report.append(row);print(json.dumps(row),flush=True);time.sleep(3.1)
open('/root/CLIMA/Clima/backups/source-resolution-20261005.json','w').write(json.dumps(report,indent=2))
