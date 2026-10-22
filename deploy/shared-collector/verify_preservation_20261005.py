import importlib.util, sqlite3, json
spec=importlib.util.spec_from_file_location('m','/root/CLIMA/Clima/scripts/ecowitt_history_import.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
b=sqlite3.connect('file:/root/CLIMA/Clima/backups/ecowitt-quality-before-dedupe-20260925T145636Z.sqlite?mode=ro',uri=True)
c=sqlite3.connect('file:'+m.selected_db()+'?mode=ro',uri=True)
cache=set()
for key,payload in b.execute('select key,payload from weather_history'):
    for metric,ts,value,unit in m.iter_series(json.loads(payload)):cache.add((key.split('|')[1],metric,ts,value,unit))
candidates=set()
for cycle,start,end,payload in b.execute('select cycle_type,start_ts,end_ts,payload from ecowitt_history_import_chunks'):
    for metric,ts,value,unit in m.iter_series(json.loads(payload)):
        point=(cycle,metric,ts,value,unit)
        if not start<=ts<=end and point in cache:candidates.add(point)
preserved=set();owned=set()
for cycle,start,end,payload in c.execute('select cycle_type,start_ts,end_ts,payload from ecowitt_history_import_chunks'):
    for metric,ts,value,unit in m.iter_series(json.loads(payload)):
        point=(cycle,metric,ts,value,unit)
        if point in candidates:
            preserved.add(point)
            if start<=ts<=end:owned.add(point)
report={'original_candidates':len(candidates),'preserved':len(preserved),'in_owner_window':len(owned),'missing':len(candidates-preserved),'point_primary_key':[row[1] for row in c.execute('pragma table_info(ecowitt_history_points)') if row[5]]}
assert not candidates-preserved
print(json.dumps(report),flush=True)
open('/root/CLIMA/Clima/backups/preservation-audit-20261005.json','w').write(json.dumps(report,indent=2))
