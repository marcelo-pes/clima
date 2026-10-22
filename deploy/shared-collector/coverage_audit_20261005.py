import sqlite3,glob,json,datetime,collections,math,pathlib
p=glob.glob('/root/CLIMA/Clima/database/wrangler/v3/d1/miniflare-D1DatabaseObject/*.sqlite')[0]
c=sqlite3.connect('file:'+p+'?mode=ro',uri=True)
def iso(t):return datetime.datetime.fromtimestamp(t,datetime.timezone(datetime.timedelta(hours=-3))).isoformat() if t else None
def valid(v):
 try:return math.isfinite(float(v))
 except:return False
report={'database':p,'cache_rows':c.execute('select count(*) from weather_history').fetchone()[0],'variables':[],'cycles':{}}
for metric, in c.execute('select distinct metric_path from ecowitt_history_points order by metric_path').fetchall():
 rows=c.execute('select observed_at,value from ecowitt_history_points where metric_path=? order by observed_at',(metric,)).fetchall();good=[t for t,v in rows if valid(v)]
 report['variables'].append({'variable':metric,'unique_timestamps':len(rows),'valid_observations':len(good),'missing_markers':len(rows)-len(good),'first_valid':iso(min(good)) if good else None,'last_valid':iso(max(good)) if good else None})
for cycle,step in [('5min',300),('30min',1800),('4hour',14400),('1day',86400)]:
 stats=[]
 for metric, in c.execute('select distinct metric_path from ecowitt_history_cycle_points where cycle_type=?',(cycle,)).fetchall():
  times=[r[0] for r in c.execute('select distinct observed_at from ecowitt_history_cycle_points where cycle_type=? and metric_path=? order by observed_at',(cycle,metric))]; gaps=[{'after':iso(a),'before':iso(b),'missing_slots':max(0,(b-a)//step-1)} for a,b in zip(times,times[1:]) if b-a>step]
  stats.append({'variable':metric,'timestamps':len(times),'first':iso(times[0]),'last':iso(times[-1]),'gap_intervals':len(gaps),'missing_slots':sum(g['missing_slots'] for g in gaps),'gaps':gaps})
 report['cycles'][cycle]=stats
out=pathlib.Path('/root/CLIMA/Clima/backups/coverage-20261005.json');out.write_text(json.dumps(report,indent=2));print(json.dumps({'report':str(out),'variables':report['variables'],'cycles':{k:[{x:y for x,y in s.items() if x!='gaps'} for s in v if s['variable']=='outdoor/temperature'] for k,v in report['cycles'].items()}}))
