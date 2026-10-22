import importlib.util,sqlite3,datetime as dt,time,json,pathlib,subprocess
spec=importlib.util.spec_from_file_location('m','/root/CLIMA/Clima/scripts/ecowitt_history_import.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
c=sqlite3.connect(m.selected_db(),timeout=60);c.execute('pragma busy_timeout=60000')
stamp=dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%SZ');path=pathlib.Path('/root/CLIMA/Clima/backups')/('ecowitt-resume-'+stamp+'.sqlite')
b=sqlite3.connect(str(path));c.backup(b);assert b.execute('pragma integrity_check').fetchone()[0]=='ok';b.close();print('BACKUP_OK',str(path),flush=True)
v=m.read_vars();auth={'application_key':v['ECOWITT_APPLICATION_KEY'],'api_key':v['ECOWITT_API_KEY']};mac=v.get('ECOWITT_MAC')
if not mac:
    devices=[];m.find_devices(m.request_api('/device/list',auth).get('data'),devices);mac=next(d for d in devices if str(d.get('id',d.get('device_id'))) == str(v.get('ECOWITT_DEVICE_ID','251816'))).get('mac')
def merge(a,b):
    for k,value in b.items():
        if isinstance(value,dict):a[k]=merge(a.get(k,{}) if isinstance(a.get(k),dict) else {},value)
        elif value!='-' or a.get(k) in (None,'-'):a[k]=value
    return a
for device,cycle,start,end,payload in c.execute("select device_key,cycle_type,start_ts,end_ts,payload from ecowitt_history_import_chunks where status='empty'").fetchall():
    result=m.request_api('/device/history',{**auth,'mac':mac,'start_date':dt.datetime.fromtimestamp(start,m.UTC).strftime('%Y-%m-%d %H:%M:%S'),'end_date':dt.datetime.fromtimestamp(end,m.UTC).strftime('%Y-%m-%d %H:%M:%S'),'cycle_type':cycle,'call_back':m.CALLBACKS,**m.UNITS}).get('data') or {}
    points=[p for p in m.iter_series(result) if start<=p[1]<=end]
    if points:
        with c:
            for metric,ts,value,unit in points:m.merge_point(c,device,cycle,metric,ts,value,unit)
            combined=merge(json.loads(payload or '{}'),result)
            c.execute('update ecowitt_history_import_chunks set status=?,api_points=?,payload=? where device_key=? and cycle_type=? and start_ts=? and end_ts=?',('complete',len(points),json.dumps(combined,separators=(',',':')),device,cycle,start,end))
    print(json.dumps({'empty_retry':cycle,'start':m.iso(start),'end':m.iso(end),'points':len(points),'status':'complete' if points else 'empty'}),flush=True);time.sleep(3.1)
# Check the interval preceding the earliest saved day; never fabricate data.
older=m.request_api('/device/history',{**auth,'mac':mac,'start_date':'2025-01-01 03:00:00','end_date':'2025-05-12 02:59:59','cycle_type':'1day','call_back':m.CALLBACKS,**m.UNITS}).get('data') or {}
print(json.dumps({'older_2025_before_may12_points':sum(1 for _ in m.iter_series(older))}),flush=True)
c.close();r=subprocess.run(['python3','-u','/root/CLIMA/Clima/scripts/resume_import_20261002.py']);print('RESUME_EXIT',r.returncode,flush=True)
