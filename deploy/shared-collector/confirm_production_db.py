import importlib.util,sqlite3,json,os,datetime,subprocess
spec=importlib.util.spec_from_file_location('m','/root/CLIMA/Clima/scripts/ecowitt_history_import.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
path=os.path.realpath(m.selected_db());expected='/root/CLIMA/Clima/database/wrangler/v3/d1/miniflare-D1DatabaseObject/faaf2b0445ab934c3aac48ddf0cdfade8f9bac050be98993748742cdd2cb05fb.sqlite';assert path==expected
c=sqlite3.connect('file:'+path+'?mode=ro',uri=True)
count,first,last=c.execute('select count(*),min(updated_at),max(updated_at) from weather_history').fetchone()
low=high=None;points=0
for raw, in c.execute('select payload from weather_history'):
    for _,ts,_,_ in m.iter_series(json.loads(raw)):
        low=ts if low is None else min(low,ts);high=ts if high is None else max(high,ts);points+=1
report={'database':path,'weather_history_rows':count,'first_cache_updated':m.iso(first/1000),'last_cache_updated':m.iso(last/1000),'first_cache_observation':m.iso(low),'last_cache_observation':m.iso(high),'cache_payload_observations_including_overlap':points,'importer_selected_database_matches':True,'imported_checkpoints':c.execute('select count(*) from ecowitt_history_import_chunks').fetchone()[0],'normalized_unique_observations':c.execute('select count(*) from ecowitt_history_points').fetchone()[0]}
c.close();open('/root/CLIMA/Clima/backups/clima2-20261005/production-database.json','w').write(json.dumps(report,indent=2));print(json.dumps(report),flush=True)
