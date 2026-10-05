from checkpoint_coverage import coverage
import pathlib,sqlite3,importlib.util,fcntl,datetime,json,shutil,hashlib,math,collections,os,time
ROOT=pathlib.Path('/opt/clima-antaisolar'); spec=importlib.util.spec_from_file_location('sync',ROOT/'scripts/ecowitt_history_sync.py'); sync=importlib.util.module_from_spec(spec);spec.loader.exec_module(sync);m=sync.m

def valid(v):
 try:return math.isfinite(float(v))
 except:return False

def backup():
 lock=open(ROOT/'backups/history-import.lock','a');fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
 stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ');folder=ROOT/'backups'/('coverage-repair-'+stamp);folder.mkdir()
 shutil.copy2(ROOT/'scripts/ecowitt_history_sync.py',folder/'sync-before.py')
 src=sqlite3.connect(m.selected_db(),timeout=60);dst=sqlite3.connect(folder/'production-before.sqlite');src.backup(dst);assert dst.execute('pragma integrity_check').fetchone()[0]=='ok';dst.execute('pragma journal_mode=delete');dst.close();src.close()
 shutil.copy2(folder/'production-before.sqlite',folder/'recovery-test.sqlite')
 test=sqlite3.connect(folder/'recovery-test.sqlite');assert test.execute('pragma integrity_check').fetchone()[0]=='ok';test.close()
 (ROOT/'backups/coverage-repair-current.txt').write_text(str(folder));print(json.dumps({'backup':str(folder),'integrity':'ok'}),flush=True)

def add(payload,metric,t,value,unit):
 node=payload
 for key in metric.split('/'):node=node.setdefault(key,{})
 node.setdefault('unit',unit);series=node.setdefault('list',{});old=series.get(str(t))
 if old is None or (not valid(old) and valid(value)):series[str(t)]=value

def recover(c):
 device=c.execute('select distinct device_key from ecowitt_history_import_chunks').fetchone()[0];total=0;stats={}
 for cycle in m.CYCLES:
  rows=c.execute('select start_ts,end_ts,payload from ecowitt_history_import_chunks where device_key=? and cycle_type=? order by start_ts',(device,cycle)).fetchall();caches=[json.loads(p) for key,p in c.execute('select key,payload from weather_history') if key.split('|')[1]==cycle];added=0
  for i,(a,b,raw) in enumerate(rows):
   payload=json.loads(raw or '{}');before={(p[0],p[1]):p[2] for p in m.iter_series(payload) if a<=p[1]<=b};sources=caches+[json.loads(r[2] or '{}') for r in rows[max(0,i-1):i+2] if r[0]!=a]
   for source in sources:
    for metric,t,value,unit in m.iter_series(source):
     if a<=t<=b:add(payload,metric,t,value,unit)
   points=[p for p in m.iter_series(payload) if a<=p[1]<=b];added+=len({(p[0],p[1]) for p in points}-set(before))
   with c:
    for metric,t,value,unit in points:
     if before.get((metric,t))==value:continue
     old=c.execute('select value from ecowitt_history_points where device_key=? and metric_path=? and observed_at=?',(device,metric,t)).fetchone()
     if old and valid(old[0]):
      c.execute('insert or ignore into ecowitt_history_cycle_points values(?,?,?,?)',(device,cycle,metric,t))
     else:sync.merge_point(c,device,cycle,metric,t,value,unit)
    # Legacy status denotes response availability only; never claims expected coverage.
    c.execute('update ecowitt_history_import_chunks set payload=?,api_points=?,status=? where device_key=? and cycle_type=? and start_ts=? and end_ts=?',(json.dumps(payload,separators=(',',':')),len(points),('complete' if coverage(points,cycle,a,b)['complete'] else 'partial') if points else 'empty',device,cycle,a,b))
  stats[cycle]=added;total+=added;print(json.dumps({'reconciled':cycle,'added_checkpoint_points':added}),flush=True)
 return stats

def audit(c):
 device=c.execute('select distinct device_key from ecowitt_history_import_chunks').fetchone()[0]
 c.create_function('is_valid',1,lambda v:int(valid(v)))
 def iso(t):return m.iso(t) if t else None
 variables=[]
 for metric,n,good,first,last in c.execute('select metric_path,count(*),sum(is_valid(value)),min(case when is_valid(value) then observed_at end),max(case when is_valid(value) then observed_at end) from ecowitt_history_points where device_key=? group by metric_path',(device,)):
  variables.append({'variable':metric,'timestamps':n,'valid':good,'missing_markers':n-good,'first':iso(first),'last':iso(last)})
 cycles={}
 for cycle,step in [('5min',300),('30min',1800),('4hour',14400),('1day',86400)]:
  entries=[];current=None;item=None;previous=None
  for metric,t,value in c.execute('SELECT x.metric_path,x.observed_at,p.value FROM ecowitt_history_cycle_points x JOIN ecowitt_history_points p ON p.device_key=x.device_key AND p.metric_path=x.metric_path AND p.observed_at=x.observed_at WHERE x.device_key=? AND x.cycle_type=? ORDER BY x.metric_path,x.observed_at',(device,cycle)):
   if metric!=current:
    if item:entries.append(item)
    current=metric;previous=None;item={'variable':metric,'valid':0,'first':None,'last':None,'missing_markers':0,'missing_slots':0,'gap_intervals':0,'gaps':[]}
   if not valid(value):item['missing_markers']+=1;continue
   item['valid']+=1;item['first']=item['first'] or iso(t);item['last']=iso(t)
   if previous is not None and t-previous>step and (t-previous)//step-1>0:
    gap={'start':previous+step,'end':t-step,'slots':(t-previous)//step-1};item['gaps'].append(gap);item['missing_slots']+=gap['slots'];item['gap_intervals']+=1
    if len(item['gaps'])>100:item['gaps'].pop(0)
   previous=t
  if item:entries.append(item)
  cycles[cycle]=entries
  print(json.dumps({'audit_cycle':cycle,'metrics':len(entries),'indexed_valid_timestamps':sum(x['valid'] for x in entries)}),flush=True)
 return {'variables':variables,'cycles':cycles,'points':sum(v['timestamps'] for v in variables),'valid_points':sum(v['valid'] for v in variables),'cache_rows':c.execute('select count(*) from weather_history').fetchone()[0]}

def test():
 folder=pathlib.Path((ROOT/'backups/coverage-repair-current.txt').read_text());c=sqlite3.connect(folder/'recovery-test.sqlite',timeout=60);before=audit(c);stats=recover(c);api=repair_api(c);after=audit(c)
 c.execute('attach database ? as baseline',(str(folder/'production-before.sqlite'),));lost=c.execute('select count(*) from baseline.ecowitt_history_points b left join main.ecowitt_history_points n using(device_key,metric_path,observed_at) where n.observed_at is null').fetchone()[0];changed=c.execute("select count(*) from baseline.ecowitt_history_points b join main.ecowitt_history_points n using(device_key,metric_path,observed_at) where b.value!='-' and (b.value!=n.value or b.unit!=n.unit)").fetchone()[0]
 duplicates=c.execute('select count(*) from (select device_key,metric_path,observed_at,count(*) n from ecowitt_history_points group by 1,2,3 having n>1)').fetchone()[0];check=c.execute('pragma main.integrity_check').fetchone()[0];assert lost==changed==duplicates==0 and check=='ok'
 report={'before':before,'after':after,'checkpoint_recovery':stats,'api_recovery':api,'added_unique_points':after['points']-before['points'],'added_valid_points':after['valid_points']-before['valid_points'],'lost':lost,'changed_valid':changed,'duplicates':duplicates,'integrity':check};(folder/'test-report.json').write_text(json.dumps(report,indent=2));print(json.dumps({k:v for k,v in report.items() if k not in ('before','after')}),flush=True)


def repair_api(c):
 device=c.execute('select distinct device_key from ecowitt_history_import_chunks').fetchone()[0]
 v=m.read_vars();auth={'application_key':v['ECOWITT_APPLICATION_KEY'],'api_key':v['ECOWITT_API_KEY']};mac=v.get('ECOWITT_MAC')
 if not mac:
  found=[];m.find_devices(m.request_api('/device/list',auth).get('data'),found);mac=next(d for d in found if str(d.get('id',d.get('device_id')))==str(v.get('ECOWITT_DEVICE_ID','251816'))).get('mac')
 assert m.hashlib.sha256(str(mac).encode()).hexdigest()==device
 report=audit(c);recovery=[]
 for cycle,step in [('5min',300),('30min',1800),('4hour',14400),('1day',86400)]:
  metric=next(x for x in report['cycles'][cycle] if x['variable']=='outdoor/temperature')
  # Retry only gaps, plus initial and latest edges. Long unavailable spans use bounded probes.
  bounds=c.execute('select min(start_ts),max(end_ts) from ecowitt_history_import_chunks where cycle_type=?',(cycle,)).fetchone();first=int(datetime.datetime.fromisoformat(metric['first']).timestamp());last=int(datetime.datetime.fromisoformat(metric['last']).timestamp());gaps=[(g['start'],g['end']) for g in metric['gaps']]+[(bounds[0],first-step),(last+step,int(time.time())-600)]
  intervals=[]
  for a,b in gaps:
   if cycle=='5min' and b<int(datetime.datetime.fromisoformat(metric['last']).timestamp())-90*86400:
    if len(intervals)>=2:continue
   if b<a:continue
   if b-a>7*86400 and cycle=='5min':
    intervals.extend([(a,min(a+86400-1,b)),(max(a,b-86400+1),b)])
   else:
    while a<=b:
     end=min(b,a+m.CYCLES[cycle]-1);intervals.append((a,end));a=end+1
  for a,b in intervals:
   # An aligned complete-day envelope avoids short-window endpoint quirks.
   qa=int(datetime.datetime.fromtimestamp(a,m.BAURU).replace(hour=0,minute=0,second=0).timestamp());qb=int(datetime.datetime.fromtimestamp(b,m.BAURU).replace(hour=23,minute=59,second=59).timestamp());qb=min(qb,int(time.time()))
   data=m.request_api('/device/history',{**auth,'mac':mac,'start_date':datetime.datetime.fromtimestamp(qa,m.BAURU).strftime('%Y-%m-%d %H:%M:%S'),'end_date':datetime.datetime.fromtimestamp(qb,m.BAURU).strftime('%Y-%m-%d %H:%M:%S'),'cycle_type':cycle,'call_back':m.CALLBACKS,**m.UNITS}).get('data') or {}
   points=[p for p in m.iter_series(data) if qa<=p[1]<=qb];new=0
   owners=c.execute('select start_ts,end_ts,payload from ecowitt_history_import_chunks where cycle_type=? and end_ts>=? and start_ts<=? order by start_ts',(cycle,qa,qb)).fetchall()
   with c:
    for oa,ob,raw in owners:
     payload=json.loads(raw or '{}')
     for metric,t,value,unit in points:
      if not oa<=t<=ob:continue
      old=c.execute('select value from ecowitt_history_points where device_key=? and metric_path=? and observed_at=?',(device,metric,t)).fetchone()
      if not old or (not valid(old[0]) and valid(value)):
       sync.merge_point(c,device,cycle,metric,t,value,unit);new+=int(valid(value))
      else:c.execute('insert or ignore into ecowitt_history_cycle_points values(?,?,?,?)',(device,cycle,metric,t))
      add(payload,metric,t,value,unit)
     count=sum(1 for p in m.iter_series(payload) if oa<=p[1]<=ob)
     c.execute('update ecowitt_history_import_chunks set payload=?,api_points=?,status=? where device_key=? and cycle_type=? and start_ts=? and end_ts=?',(json.dumps(payload,separators=(',',':')),count,('complete' if coverage(list(m.iter_series(payload)),cycle,oa,ob)['complete'] else 'partial') if count else 'empty',device,cycle,oa,ob))
   result={'cycle':cycle,'start':m.iso(qa),'end':m.iso(qb),'returned_points':len(points),'recovered_valid':new};recovery.append(result);print(json.dumps(result),flush=True);time.sleep(3.1)
 return recovery

if __name__=='__main__':
 import sys
 {'backup':backup,'test':test}[sys.argv[1]]()

def apply_test(c):
 folder=pathlib.Path((ROOT/'backups/coverage-repair-current.txt').read_text());report=json.loads((folder/'test-report.json').read_text());assert report['lost']==report['changed_valid']==report['duplicates']==0 and report['integrity']=='ok'
 baseline=sqlite3.connect('file:'+str(folder/'production-before.sqlite')+'?mode=ro',uri=True);test=sqlite3.connect('file:'+str(folder/'recovery-test.sqlite')+'?mode=ro',uri=True)
 prior=c.execute('select count(*) from ecowitt_history_points').fetchone()[0]
 c.execute('attach database ? as tested',(str(folder/'recovery-test.sqlite'),))
 with c:
  c.execute('''INSERT INTO ecowitt_history_points SELECT t.* FROM tested.ecowitt_history_points t WHERE NOT EXISTS(SELECT 1 FROM main.ecowitt_history_points p WHERE p.device_key=t.device_key AND p.metric_path=t.metric_path AND p.observed_at=t.observed_at)''')
  c.execute('''UPDATE ecowitt_history_points SET (value,unit,cycle_type,priority)=(SELECT t.value,t.unit,t.cycle_type,t.priority FROM tested.ecowitt_history_points t WHERE t.device_key=ecowitt_history_points.device_key AND t.metric_path=ecowitt_history_points.metric_path AND t.observed_at=ecowitt_history_points.observed_at) WHERE value='-' AND EXISTS(SELECT 1 FROM tested.ecowitt_history_points t WHERE t.device_key=ecowitt_history_points.device_key AND t.metric_path=ecowitt_history_points.metric_path AND t.observed_at=ecowitt_history_points.observed_at AND t.value!='-')''')
  c.execute('insert or ignore into ecowitt_history_cycle_points select * from tested.ecowitt_history_cycle_points')
  for device,cycle,a,b,raw in test.execute('select device_key,cycle_type,start_ts,end_ts,payload from ecowitt_history_import_chunks'):
   old=c.execute('select payload from main.ecowitt_history_import_chunks where device_key=? and cycle_type=? and start_ts=? and end_ts=?',(device,cycle,a,b)).fetchone()
   payload=json.loads((old[0] if old else None) or '{}')
   for metric,t,value,unit in m.iter_series(json.loads(raw or '{}')):add(payload,metric,t,value,unit)
   points=[p for p in m.iter_series(payload) if a<=p[1]<=b];status=('complete' if coverage(points,cycle,a,b)['complete'] else 'partial') if points else 'empty'
   c.execute('insert into ecowitt_history_import_chunks values(?,?,?,?,?,?,?) on conflict(device_key,cycle_type,start_ts,end_ts) do update set status=excluded.status,api_points=excluded.api_points,payload=excluded.payload',(device,cycle,a,b,status,len(points),json.dumps(payload,separators=(',',':'))))
 after=c.execute('select count(*) from ecowitt_history_points').fetchone()[0];print(json.dumps({'tested_recovery_applied':True,'new_unique_points':after-prior}),flush=True)
 baseline.close();test.close();c.execute('detach database tested')
