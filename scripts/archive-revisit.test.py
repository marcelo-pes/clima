import importlib.util
import json
from pathlib import Path
import sqlite3
import sys

sys.path.insert(0, str(Path(__file__).parent))
spec = importlib.util.spec_from_file_location('sync', Path(__file__).with_name('ecowitt-history-sync.py'))
sync = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sync)

c = sqlite3.connect(':memory:')
c.execute('CREATE TABLE ecowitt_history_import_chunks(device_key,cycle_type,start_ts,end_ts,status,payload)')
end = 2_000_000
for age, status in [(86400+14,'partial'),(5*86400,'partial'),(8*86400,'partial'),(2*86400,'complete'),(5*86400,'complete')]:
    c.execute('INSERT INTO ecowitt_history_import_chunks VALUES(?,?,?,?,?,?)',('test','30min',end-age-100,end-age,status,'{}'))
selected = {row[1] for row in sync.windows_to_revisit(c,'test','30min',end)}
assert end-86400-14 in selected, 'Fourteen seconds outside yesterday must still be revisited'
assert end-5*86400 in selected, 'Recent partial aggregates must be revisited'
assert end-8*86400 not in selected, 'Do not endlessly requery old coarse-source history'
assert end-2*86400 in selected
assert len(selected) == 3
c.execute('CREATE TABLE ecowitt_history_points(device_key,metric_path,observed_at,value,unit,cycle_type,priority,PRIMARY KEY(device_key,metric_path,observed_at))')
c.execute('CREATE TABLE ecowitt_history_cycle_points(device_key,cycle_type,metric_path,observed_at,PRIMARY KEY(device_key,cycle_type,metric_path,observed_at))')
sync.merge_point(c,'test','5min','outdoor/temperature',1,'23.9','C')
sync.merge_point(c,'test','1day','outdoor/temperature',1,'21.1','C')
assert c.execute('SELECT value,cycle_type FROM ecowitt_history_points').fetchone() == ('23.9','5min')
sync.merge_point(c,'test','5min','outdoor/temperature',2,'-','C')
sync.merge_point(c,'test','5min','outdoor/temperature',2,'0','C')
assert c.execute('SELECT value FROM ecowitt_history_points WHERE observed_at=2').fetchone()[0] == '0'
old={'outdoor':{'temperature':{'unit':'C','list':{'1':'23.9','2':'-'}}}}
new={'outdoor':{'temperature':{'unit':'C','list':{'1':'21.1','2':'0'}}}}
combined=sync.merge_payload(old,new)
assert combined['outdoor']['temperature']['list']=={'1':'23.9','2':'0'}
print(json.dumps({'retry_cutoff_regression':'passed','bounded_partial_retries':'passed','existing_values_preserved':'passed','real_zero_fills_invalid_marker':'passed'}))
