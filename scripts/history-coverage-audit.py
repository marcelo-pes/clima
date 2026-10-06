"""Read-only coverage by variable, complete gap CSV and deduplicated source windows."""
import collections,csv,datetime as dt,gzip,json,math,pathlib,sqlite3,sys
STEPS={'5min':300,'30min':1800,'4hour':14400,'1day':86400}
SPANS={'5min':86400,'30min':604800,'4hour':2592000,'1day':31536000}
TZ=dt.timezone(dt.timedelta(hours=-3))
def valid(v):
 try:return v is not None and v!='' and math.isfinite(float(v))
 except (ValueError,TypeError):return False

def audit(db,folder):
 folder=pathlib.Path(folder);folder.mkdir(parents=True,exist_ok=True)
 c=sqlite3.connect('file:'+str(db)+'?mode=ro',uri=True);c.execute('pragma query_only=on');c.execute('pragma cache_size=-16000');c.create_function('is_valid',1,lambda v:int(valid(v)))
 def iso(t):return dt.datetime.fromtimestamp(t,TZ).isoformat() if t is not None else None
 variables=[]
 for metric,n,good,first,last in c.execute('select metric_path,count(*),sum(is_valid(value)),min(case when is_valid(value) then observed_at end),max(case when is_valid(value) then observed_at end) from ecowitt_history_points group by metric_path'):
  variables.append(dict(variable=metric,timestamps=n,valid=good,missing_markers=n-good,first=iso(first),last=iso(last)))
 devices=c.execute('select distinct device_key from ecowitt_history_import_chunks').fetchall();assert len(devices)==1;device=devices[0][0]
 cycles={};windows=[]
 with gzip.open(folder/'coverage-gaps.csv.gz','wt') as f:
  writer=csv.writer(f);writer.writerow(['cycle','variable','start_brt','end_brt','nominal_missing_slots','kind'])
  for cycle,step in STEPS.items():
   lo,hi=c.execute('select min(start_ts),max(end_ts) from ecowitt_history_import_chunks where cycle_type=?',(cycle,)).fetchone();anchor=int(dt.datetime.fromtimestamp(lo,TZ).replace(hour=0,minute=0,second=0).timestamp());span=SPANS[cycle];planned=set();items=[]
   for variable in variables:
    metric=variable['variable'];points=list(c.execute('select x.observed_at,p.value from ecowitt_history_cycle_points x join ecowitt_history_points p using(device_key,metric_path,observed_at) where x.device_key=? and x.cycle_type=? and x.metric_path=? order by x.observed_at',(device,cycle,metric)))
    times=[t for t,v in points if valid(v)];item=dict(variable=metric,valid=len(times),missing_markers=len(points)-len(times),first=iso(times[0]) if times else None,last=iso(times[-1]) if times else None,missing_slots=0,gap_intervals=0,edge_missing_slots=0,eventDependent=metric=='lightning/distance')
    def gap(a,b,kind):
     n=max(0,(b-a)//step+1)
     if not n:return
     writer.writerow([cycle,metric,iso(a),iso(b),n,kind])
     if kind=='internal':item['missing_slots']+=n;item['gap_intervals']+=1
     else:item['edge_missing_slots']+=n
     if metric=='lightning/distance':return
     for k in range((a-anchor)//span,(b-anchor)//span+1):planned.add(k)
    for a,b in zip(times,times[1:]):
     if b-a>step:gap(a+step,b-step,'internal')
    if times:
     phase=collections.Counter(t%step for t in times).most_common(1)[0][0];gap(times[-1]+step,(hi-phase)//step*step+phase,'recent-edge')
    items.append(item)
   cycles[cycle]=items
   plannedWindows=[dict(cycle=cycle,start=max(lo,anchor+i*span),end=min(hi,anchor+(i+1)*span-1)) for i in sorted(planned)];windows+=plannedWindows
   print(json.dumps({'cycle':cycle,'planned_windows':len(plannedWindows),'gap_intervals':sum(i['gap_intervals'] for i in items)}),flush=True)
 result=dict(checkedAt=dt.datetime.now(dt.timezone.utc).isoformat(),variables=variables,cycles=cycles,points=sum(v['timestamps'] for v in variables),valid_points=sum(v['valid'] for v in variables),note='Nominal gaps do not prove recoverability. Event-dependent lightning distance is excluded from repair. Different sensor start dates preserved. All gap intervals retained in compressed CSV.')
 (folder/'coverage.json').write_text(json.dumps(result,indent=2));(folder/'repair-plan.json').write_text(json.dumps(dict(createdAt=result['checkedAt'],windows=windows),indent=2))
 with (folder/'coverage.csv').open('w') as f:
  writer=csv.DictWriter(f,fieldnames=list(variables[0]));writer.writeheader();writer.writerows(variables)
 c.close();return result
if __name__=='__main__':
 r=audit(sys.argv[1],sys.argv[2]);print(json.dumps({'points':r['points'],'valid':r['valid_points'],'variables':len(r['variables'])}))
