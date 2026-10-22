"""Daily statistics of valid source readings, including timestamps of extrema."""
import sqlite3,sys,json
VALID="value!='-' AND value!='' AND value GLOB '*[0-9]*' AND value NOT GLOB '*[^0-9.eE+-]*' AND CAST(value AS REAL)>-1e308 AND CAST(value AS REAL)<1e308"
def build_statistics(c,after=None):
 if after is not None:after=((after-10800)//86400)*86400+10800
 c.execute('''create table if not exists weather_daily_statistics(device_key text not null,metric_path text not null,day text not null,unit text not null,cycle_type text not null,samples integer not null,minimum real not null,maximum real not null,total real not null,first integer not null,last integer not null,primary key(device_key,metric_path,day,unit,cycle_type))''')
 columns={row[1] for row in c.execute('pragma table_info(weather_daily_statistics)')}
 migrate=False
 for name in ('minimum_at','maximum_at'):
  if name not in columns:c.execute('alter table weather_daily_statistics add column '+name+' integer');migrate=True
 if migrate:after=None
 c.execute('pragma temp_store=file');c.execute('pragma cache_size=-16000')
 with c:
  if after is None:c.execute('delete from weather_daily_statistics')
  else:c.execute('delete from weather_daily_statistics where day>=date(?,"unixepoch","-3 hours")',(after,))
  c.execute('''insert into weather_daily_statistics(device_key,metric_path,day,unit,cycle_type,samples,minimum,maximum,total,first,last,minimum_at,maximum_at)
   select device_key,metric_path,day,unit,cycle_type,count(*),min(amount),max(amount),sum(amount),min(observed_at),max(observed_at),min(case when amount=lo then observed_at end),min(case when amount=hi then observed_at end)
   from (select *,min(amount) over(partition by device_key,metric_path,day,unit,cycle_type) as lo,max(amount) over(partition by device_key,metric_path,day,unit,cycle_type) as hi
     from (select device_key,metric_path,date(observed_at,'unixepoch','-3 hours') as day,unit,cycle_type,observed_at,cast(value as real) as amount from ecowitt_history_points where '''+VALID+''' and (? is null or observed_at>=?)))
   group by device_key,metric_path,day,unit,cycle_type''',(after,after))
 print(json.dumps({'daily_statistics_rows':c.execute('select count(*) from weather_daily_statistics').fetchone()[0],'extrema_timestamps':True}),flush=True)
