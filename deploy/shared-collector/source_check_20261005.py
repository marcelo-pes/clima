import sqlite3,glob,json,datetime
p=glob.glob('/root/CLIMA/Clima/database/wrangler/v3/d1/miniflare-D1DatabaseObject/*.sqlite')[0];c=sqlite3.connect('file:'+p+'?mode=ro',uri=True)
iso=lambda t:datetime.datetime.fromtimestamp(t,datetime.timezone(datetime.timedelta(hours=-3))).isoformat()
peak=c.execute("select value,unit,observed_at,cycle_type from ecowitt_history_points where metric_path='wind/wind_gust' and value!='-' order by cast(value as real) desc limit 1").fetchone();print(json.dumps({'gust_max':{'value':peak[0],'unit':peak[1],'time':iso(peak[2]),'cycle':peak[3]}}),flush=True)
pressure=c.execute("select count(*),sum(a.value=b.value) from ecowitt_history_points a join ecowitt_history_points b on a.device_key=b.device_key and a.observed_at=b.observed_at and b.metric_path='pressure/absolute' where a.metric_path='pressure/relative'").fetchone();print(json.dumps({'pressure_shared_timestamps':pressure[0],'equal_raw_values':pressure[1]}),flush=True)
for metric in ('outdoor/temperature','outdoor/temperature_high'):
 row=c.execute('select value,unit,observed_at,cycle_type from ecowitt_history_points where metric_path=? and value!="-" order by cast(value as real) desc limit 1',(metric,)).fetchone();print(json.dumps({'variable':metric,'maximum':row[0],'unit':row[1],'timestamp':iso(row[2]),'cycle':row[3]}),flush=True)
