"""Synthetic station only; no production data or credentials."""
from pathlib import Path
import importlib.util, sqlite3, hashlib, json, sys
NOW=1792670400  # 2026-10-22T12:00:00Z
METRICS={'outdoor/temperature':('C',24),'outdoor/humidity':('%',60),'indoor/temperature':('C',25),'indoor/humidity':('%',55),'pressure/relative':('hPa',1013),'wind/wind_speed':('km/h',5),'wind/wind_gust':('km/h',8),'wind/wind_direction':('°',90),'solar_and_uvi/solar':('W/m2',400),'solar_and_uvi/uvi':('',3),'rainfall_piezo/daily':('mm',0),'rainfall_piezo/rain_rate':('mm/hr',0)}
def create(directory, source):
 directory.mkdir(parents=True);(directory/'cache').mkdir()
 spec=importlib.util.spec_from_file_location('fixture_importer',source/'deploy/coleta/ecowitt_history_import.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
 db=directory/'weather.sqlite';c=sqlite3.connect(db);m.schema(c)
 c.execute('create table weather_history(key text primary key,payload text,updated_at integer,expires_at integer)')
 device=hashlib.sha256(b'test-station').hexdigest();start=NOW-400*86400
 for cycle in m.CYCLES:
  data={}
  for metric,(unit,value) in METRICS.items():
   node=data
   for part in metric.split('/')[:-1]:node=node.setdefault(part,{})
   series={str(t):str(value+((t//14400)%3 if 'temperature' in metric else 0)) for t in range(start,NOW+1,14400)}
   node[metric.split('/')[-1]]={'unit':unit,'list':series}
   for t in [NOW-2*86400,NOW-86400,NOW]:
    c.execute('insert or ignore into ecowitt_history_points values(?,?,?,?,?,?,?)',(device,metric,t,str(value),unit,cycle,m.PRIORITY[cycle]))
  c.execute('insert into ecowitt_history_import_chunks values(?,?,?,?,?,?,?)',(device,cycle,start,NOW,'partial',len(data),json.dumps(data)))
 c.commit();c.close()
 (directory/'runtime.vars').write_text('ECOWITT_APPLICATION_KEY=test\nECOWITT_API_KEY=test\nECOWITT_MAC=test-station\n')
 return db
if __name__=='__main__':create(Path(sys.argv[1]),Path(__file__).resolve().parents[2])
