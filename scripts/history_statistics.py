import sqlite3,sys,json

def build_statistics(c,after=None):
 if after is not None:after=((after-10800)//86400)*86400+10800
 c.execute('''create table if not exists weather_daily_statistics(device_key text not null,metric_path text not null,day text not null,unit text not null,cycle_type text not null,samples integer not null,minimum real not null,maximum real not null,total real not null,first integer not null,last integer not null,primary key(device_key,metric_path,day,unit,cycle_type))''')
 c.execute('pragma temp_store=file')
 with c:
  if after is None:c.execute('delete from weather_daily_statistics')
  else:c.execute('delete from weather_daily_statistics where day>=date(?,"unixepoch","-3 hours")',(after,))
  c.execute('''insert into weather_daily_statistics select device_key,metric_path,date(observed_at,'unixepoch','-3 hours'),unit,cycle_type,count(*),min(cast(value as real)),max(cast(value as real)),sum(cast(value as real)),min(observed_at),max(observed_at) from ecowitt_history_points where value!='-' and value!='' and (? is null or observed_at>=?) group by device_key,metric_path,date(observed_at,'unixepoch','-3 hours'),unit,cycle_type''',(after,after))
 print(json.dumps({'daily_statistics_rows':c.execute('select count(*) from weather_daily_statistics').fetchone()[0]}),flush=True)
