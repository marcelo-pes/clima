import importlib.util,sqlite3,json,datetime,pathlib
spec=importlib.util.spec_from_file_location('m','/root/CLIMA/Clima/scripts/ecowitt_history_import.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
db=m.selected_db();c=sqlite3.connect('file:'+db+'?mode=ro',uri=True)
report={'database':db,'cycles':{},'cache_rows':c.execute('select count(*) from weather_history').fetchone()[0]}
for cycle,step in [('5min',300),('30min',1800),('4hour',14400),('1day',86400)]:
    rows=c.execute('select start_ts,end_ts,status from ecowitt_history_import_chunks where cycle_type=? order by start_ts',(cycle,)).fetchall()
    gaps=[];overlaps=[]
    for prev,cur in zip(rows,rows[1:]):
        if cur[0]>prev[1]+1:gaps.append([prev[1]+1,cur[0]-1])
        if cur[0]<=prev[1]:overlaps.append([cur[0],prev[1]])
    report['cycles'][cycle]={'checkpoints':len(rows),'start':m.iso(rows[0][0]),'end':m.iso(rows[-1][1]),'window_gaps':gaps,'window_overlaps':overlaps,'empty_windows':[[m.iso(a),m.iso(b)] for a,b,status in rows if status=='empty']}
report['unique_points']=c.execute('select count(*) from ecowitt_history_points').fetchone()[0]
report['unique_cycle_points']=c.execute('select count(*) from ecowitt_history_cycle_points').fetchone()[0]
report['point_table_keys']=[row[4] for row in c.execute('pragma table_info(ecowitt_history_points)')]
old='/root/CLIMA/Clima/backups/ecowitt-quality-before-dedupe-20260925T145636Z.sqlite'
b=sqlite3.connect('file:'+old+'?mode=ro',uri=True)
cache=set()
for key,payload in b.execute('select key,payload from weather_history'):
    cycle=key.split('|')[1]
    for metric,ts,value,unit in m.iter_series(json.loads(payload)):
        cache.add((cycle,metric,ts,value,unit))
counts=[]
for connection in (b,c):
    out=matches=0
    for cycle,start,end,payload in connection.execute('select cycle_type,start_ts,end_ts,payload from ecowitt_history_import_chunks where payload is not null'):
        for metric,ts,value,unit in m.iter_series(json.loads(payload)):
            if not start<=ts<=end:
                out+=1
                if (cycle,metric,ts,value,unit) in cache:matches+=1
    counts.append({'outside_window':out,'outside_matching_original_cache':matches})
report['before_after_payload_audit']=counts
b.close();c.close()
p=pathlib.Path('/root/CLIMA/Clima/backups/audit-20261005.json');p.write_text(json.dumps(report,indent=2));print(json.dumps(report),flush=True)
