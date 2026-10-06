"""Gap recovery invoked ONLY inside the existing locked synchronizer after verified backup.
Preserves every existing valid value and all source payloads; resumable plan checkpoint.
"""
import collections,datetime as dt,gzip,hashlib,json,math,pathlib,time
from checkpoint_coverage import coverage
STEPS={'5min':300,'30min':1800,'4hour':14400,'1day':86400}
def valid(v):
 try:return v is not None and v!='' and math.isfinite(float(v))
 except (TypeError,ValueError):return False

def merge_preserving(target, source):
 for k,v in source.items():
  if isinstance(v,dict):target[k]=merge_preserving(target.get(k) if isinstance(target.get(k),dict) else {},v)
  elif k not in target or not valid(target[k]) and valid(v):target[k]=v
 return target

def apply_response(c,m,device,cycle,start,end,data):
 points=[p for p in m.iter_series(data) if start<=p[1]<=end]
 added=filled=indexed=0;earliest=None
 with c:
  for metric,t,value,unit in points:
   old=c.execute('select value from ecowitt_history_points where device_key=? and metric_path=? and observed_at=?',(device,metric,t)).fetchone()
   if not old or not valid(old[0]) and valid(value):
    c.execute('INSERT INTO ecowitt_history_points VALUES(?,?,?,?,?,?,?) ON CONFLICT(device_key,metric_path,observed_at) DO UPDATE SET value=excluded.value,unit=excluded.unit,cycle_type=excluded.cycle_type,priority=excluded.priority WHERE ecowitt_history_points.value IN (\'-\',\'\')',(device,metric,t,value,unit,cycle,m.PRIORITY[cycle]))
    if valid(value):
     added+=int(not old);filled+=int(bool(old));earliest=t if earliest is None else min(earliest,t)
   indexed+=c.execute('insert or ignore into ecowitt_history_cycle_points values(?,?,?,?)',(device,cycle,metric,t)).rowcount
  # Enrich existing owning checkpoints, preserving all already valid payload values.
  for a,b,raw in c.execute('select start_ts,end_ts,payload from ecowitt_history_import_chunks where device_key=? and cycle_type=? and end_ts>=? and start_ts<=?',(device,cycle,start,end)).fetchall():
   def clipped(node):
    if not isinstance(node,dict):return node
    return {k:({stamp:value for stamp,value in v.items() if a<=int(stamp)<=b} if k=='list' and isinstance(v,dict) else clipped(v)) for k,v in node.items()}
   payload=merge_preserving(json.loads(raw or '{}'),clipped(data))
   combined=[p for p in m.iter_series(payload) if a<=p[1]<=b]
   status=('complete' if coverage(combined,cycle,a,b)['complete'] else 'partial') if combined else 'empty'
   c.execute('update ecowitt_history_import_chunks set payload=?,api_points=?,status=? where device_key=? and cycle_type=? and start_ts=? and end_ts=?',(json.dumps(payload,separators=(',',':')),len(combined),status,device,cycle,a,b))
 return dict(added_valid=added,filled_missing=filled,indexed=indexed,earliest_changed=earliest,returned_points=len(points))

def run_repair(c,m,device,auth,mac,plan_path,backups,log):
 raw=plan_path.read_bytes();digest=hashlib.sha256(raw).hexdigest()[:16];folder=pathlib.Path(backups)/('gap-repair-'+digest);folder.mkdir(exist_ok=True)
 plan=json.loads(raw);state_path=folder/'progress.json';state=json.loads(state_path.read_text()) if state_path.exists() else {'completed':{},'failures':{}}
 earliest=None;failed=False
 for i,w in enumerate(plan['windows']):
  key=str(i)
  if key in state['completed']:continue
  cycle,start,end=w['cycle'],w['start'],w['end'];assert cycle in STEPS and start<=end and end-start<m.CYCLES[cycle]
  try:
   response=m.request_api('/device/history',{**auth,'mac':mac,'start_date':dt.datetime.fromtimestamp(start,m.BAURU).strftime('%Y-%m-%d %H:%M:%S'),'end_date':dt.datetime.fromtimestamp(end,m.BAURU).strftime('%Y-%m-%d %H:%M:%S'),'cycle_type':cycle,'call_back':m.CALLBACKS,**m.UNITS})
   data=response.get('data') or {}
   # Keep raw provenance without authentication parameters or station/device identifiers.
   with gzip.open(folder/(key+'-source.json.gz'),'wt') as f:json.dump({'window':w,'data':data},f)
   result=apply_response(c,m,device,cycle,start,end,data)
   times=sorted(t for metric,t,v,unit in m.iter_series(data) if metric=='outdoor/temperature' and valid(v) and start<=t<=end)
   cadence=collections.Counter(b-a for a,b in zip(times,times[1:]));result['temperature_cadence_seconds']=cadence.most_common(3)
   result.update(w);result['temperature_points']=len(times)
   state['completed'][key]=result;state['failures'].pop(key,None)
   if result['earliest_changed'] is not None:earliest=result['earliest_changed'] if earliest is None else min(earliest,result['earliest_changed'])
   log({'repair':i+1,'of':len(plan['windows']),**result})
  except Exception as e:
   failed=True;state['failures'][key]={'window':w,'reason':str(e) if str(e).startswith(('API_CODE_','HTTP_','NETWORK_')) else type(e).__name__};log({'repair':i+1,'status':'error','reason':state['failures'][key]['reason']})
  temp=state_path.with_suffix('.tmp');temp.write_text(json.dumps(state,indent=2));temp.replace(state_path)
  time.sleep(3.1)
 log({'repair_complete':not failed,'report':str(state_path),'completed':len(state['completed']),'planned':len(plan['windows'])})
 return {'failed':failed,'earliest_changed':earliest}

def restore_checkpoint_provenance(c, m, baseline_path):
 """Keep all original payload members, including provider spillover outside owner windows.
 Adds recovered members and replaces only missing numeric markers, never valid originals.
 Normalized observation tables are not modified here.
 """
 import sqlite3
 baseline=sqlite3.connect('file:'+str(baseline_path)+'?mode=ro',uri=True);changed=0
 for device,cycle,a,b,old in baseline.execute('select device_key,cycle_type,start_ts,end_ts,payload from ecowitt_history_import_chunks'):
  current=c.execute('select payload from ecowitt_history_import_chunks where device_key=? and cycle_type=? and start_ts=? and end_ts=?',(device,cycle,a,b)).fetchone()
  if not current:raise RuntimeError('CHECKPOINT_MISSING_FROM_BASELINE')
  combined=merge_preserving(json.loads(old or '{}'),json.loads(current[0] or '{}'))
  raw=json.dumps(combined,separators=(',',':'))
  if raw==current[0]:continue
  points=[p for p in m.iter_series(combined) if a<=p[1]<=b];status=('complete' if coverage(points,cycle,a,b)['complete'] else 'partial') if points else 'empty'
  with c:c.execute('update ecowitt_history_import_chunks set payload=?,api_points=?,status=? where device_key=? and cycle_type=? and start_ts=? and end_ts=?',(raw,len(points),status,device,cycle,a,b))
  changed+=1
 baseline.close();return changed
