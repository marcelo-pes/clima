import importlib.util
import sqlite3
import datetime as dt
import json
import time
from pathlib import Path

spec = importlib.util.spec_from_file_location('old', '/root/CLIMA/Clima/scripts/ecowitt_history_import.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
db = '/root/CLIMA/Clima/database/wrangler/v3/d1/miniflare-D1DatabaseObject/faaf2b0445ab934c3aac48ddf0cdfade8f9bac050be98993748742cdd2cb05fb.sqlite'
backups = sorted(Path('/root/CLIMA/Clima/backups').glob('ecowitt-resume-*.sqlite'))
assert backups, 'BACKUP_REQUIRED'
b = sqlite3.connect('file:' + str(backups[-1]) + '?mode=ro', uri=True)
assert b.execute('pragma quick_check').fetchone()[0] == 'ok'
b.close()
c = sqlite3.connect(db, timeout=60)
c.execute('pragma busy_timeout=60000')
devices = c.execute('select distinct device_key from ecowitt_history_import_chunks').fetchall()
assert len(devices) == 1
device_key = devices[0][0]
v = m.read_vars()
auth = {'application_key': v['ECOWITT_APPLICATION_KEY'], 'api_key': v['ECOWITT_API_KEY']}
mac = v.get('ECOWITT_MAC')
if not mac:
    devices = []
    m.find_devices(m.request_api('/device/list', auth).get('data'), devices)
    device = next(d for d in devices if str(d.get('id', d.get('device_id'))) == str(v.get('ECOWITT_DEVICE_ID', '251816')))
    mac = device.get('mac', device.get('mac_address'))
assert m.hashlib.sha256(str(mac).encode()).hexdigest() == device_key
cache_before = dict(c.execute('select key,payload from weather_history'))
end_ts = int(time.time())
log = open('/root/CLIMA/Clima/backups/resume-import-audit.jsonl', 'a', buffering=1)
def record(data):
    log.write(json.dumps(data) + '\n')
    print(json.dumps(data), flush=True)
for cycle, span in m.CYCLES.items():
    cursor = c.execute('select max(end_ts)+1 from ecowitt_history_import_chunks where cycle_type=? and device_key=?', (cycle, device_key)).fetchone()[0]
    while cursor <= end_ts:
        end = min(cursor + span - 1, end_ts)
        try:
            result = m.request_api('/device/history', {**auth, 'mac':mac, 'start_date':dt.datetime.fromtimestamp(cursor,m.UTC).strftime('%Y-%m-%d %H:%M:%S'), 'end_date':dt.datetime.fromtimestamp(end,m.UTC).strftime('%Y-%m-%d %H:%M:%S'), 'cycle_type':cycle, 'call_back':m.CALLBACKS, **m.UNITS})
            data = result.get('data') or {}
            points = [(a,b,d,e) for a,b,d,e in m.iter_series(data) if cursor <= b <= end]
            with c:
                for metric, stamp, value, unit in points:
                    m.merge_point(c,device_key,cycle,metric,stamp,value,unit)
                c.execute('insert into ecowitt_history_import_chunks values(?,?,?,?,?,?,?)', (device_key,cycle,cursor,end,'complete' if points else 'empty',len(points),json.dumps(data,separators=(',',':'))))
            record({'cycle':cycle,'start':m.iso(cursor),'end':m.iso(end),'status':'complete' if points else 'empty','points':len(points)})
        except Exception as error:
            record({'cycle':cycle,'start':m.iso(cursor),'end':m.iso(end),'status':'error','reason': str(error) if str(error).startswith(('API_CODE_','HTTP_','NETWORK_')) else type(error).__name__})
            break
        cursor = end + 1
        time.sleep(3.1)
assert dict(c.execute('select key,payload from weather_history')) == cache_before, 'CACHE_CHANGED'
record({'cache_preserved':len(cache_before),'quick_check':c.execute('pragma quick_check').fetchone()[0]})
c.close()
