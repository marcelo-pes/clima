import sys,pathlib,sqlite3,json,itertools
sys.path.insert(0,'/root/CLIMA/Clima/scripts');import coverage_recovery as r
folder=pathlib.Path('/root/CLIMA/Clima/backups/coverage-repair-20261005T180900Z');before=sqlite3.connect('file:'+str(folder/'production-before.sqlite')+'?mode=ro',uri=True);after=sqlite3.connect('file:'+str(folder/'recovery-test.sqlite')+'?mode=ro',uri=True)
maxid=before.execute('select max(rowid) from ecowitt_history_points').fetchone()[0];a=before.execute('select rowid,device_key,metric_path,observed_at,value,unit from ecowitt_history_points order by rowid');b=after.execute('select rowid,device_key,metric_path,observed_at,value,unit from ecowitt_history_points where rowid<=? order by rowid',(maxid,));lost=changed=0
for old,new in itertools.zip_longest(a,b):
 if old is None or new is None or old[:4]!=new[:4]:lost+=1;continue
 if r.valid(old[4]) and old[4:]!=new[4:]:changed+=1
print(json.dumps({'stream_check_lost':lost,'changed_valid':changed}),flush=True);assert lost==changed==0
counts={}
for label,c in [('before',before),('after',after)]:
 c.create_function('valid_number',1,lambda v:int(r.valid(v)));counts[label]=dict(zip(['points','valid'],c.execute('select count(*),sum(valid_number(value)) from ecowitt_history_points').fetchone()))
print(json.dumps({'counts':counts}),flush=True)
coverage_before=r.audit(before);coverage_after=r.audit(after)
check=after.execute('pragma integrity_check').fetchone()[0];assert check=='ok';duplicates=after.execute('select count(*) from(select device_key,metric_path,observed_at,count(*) n from ecowitt_history_points group by 1,2,3 having n>1)').fetchone()[0];assert duplicates==0
report={'before':coverage_before,'after':coverage_after,'added_unique_points':counts['after']['points']-counts['before']['points'],'added_valid_points':counts['after']['valid']-counts['before']['valid'],'lost':lost,'changed_valid':changed,'duplicates':duplicates,'integrity':check};(folder/'test-report.json').write_text(json.dumps(report,indent=2));print(json.dumps({k:v for k,v in report.items() if k not in ('before','after')}),flush=True)
