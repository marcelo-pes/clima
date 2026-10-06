#!/usr/bin/env python3
"""Daily SQLite sync: verified backup, empty-window retries, incremental checkpoints.
Logs only paths, dates and counts. Keeps all existing full and compressed backups.
"""
import datetime as dt
import fcntl
import gzip
import importlib.util
import json
import shutil
import sqlite3
import time
from pathlib import Path
import os
import sys
sys.path.insert(0, str(Path(__file__).parent))
from checkpoint_coverage import coverage

ROOT = Path('/opt/clima-antaisolar')
helper = Path(__file__).with_name('ecowitt-history-import.py')
if not helper.is_file():
    helper = ROOT / 'scripts/ecowitt_history_import.py'
spec = importlib.util.spec_from_file_location('importer', helper)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


def log(event):
    print(json.dumps(event), flush=True)


def merge_payload(target, source):
    for key, value in source.items():
        if isinstance(value, dict):
            prior = target.get(key)
            target[key] = merge_payload(prior if isinstance(prior, dict) else {}, value)
        elif value != '-' or target.get(key) in (None, '-'):
            target[key] = value
    return target


def merge_point(c, device, cycle, metric, timestamp, value, unit):
    c.execute('INSERT OR IGNORE INTO ecowitt_history_cycle_points VALUES(?,?,?,?)', (device, cycle, metric, timestamp))
    # A missing high-resolution value must not replace a valid coarser value.
    c.execute('''INSERT INTO ecowitt_history_points VALUES(?,?,?,?,?,?,?)
      ON CONFLICT(device_key,metric_path,observed_at) DO UPDATE SET
      value=excluded.value,unit=excluded.unit,cycle_type=excluded.cycle_type,priority=excluded.priority
      WHERE (excluded.priority>ecowitt_history_points.priority AND
        (excluded.value!='-' OR ecowitt_history_points.value='-')) OR
        (ecowitt_history_points.value='-' AND excluded.value!='-')''',
      (device, metric, timestamp, value, unit, cycle, m.PRIORITY[cycle]))


def retry_key(device, cycle, start, end):
    return f'retry-window:{device}:{cycle}:{start}:{end}'


def remember_window(c, device, cycle, start, end):
    key = retry_key(device, cycle, start, end)
    with c:
        c.execute('INSERT INTO ecowitt_history_import_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
          (key, json.dumps({'cycle': cycle, 'start': start, 'end': end})))
    return key


def pending_windows(c, device):
    for key, raw in c.execute('SELECT key,value FROM ecowitt_history_import_meta WHERE key LIKE ? ORDER BY key', (f'retry-window:{device}:%',)).fetchall():
        item = json.loads(raw)
        yield item['cycle'], item['start'], item['end']


def main():
    lock = open(ROOT / 'backups/history-import.lock', 'a')
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        raise RuntimeError('IMPORT_ALREADY_RUNNING')
    try:
        return sync_locked()
    finally:
        lock.close()


def sync_locked():
    c = sqlite3.connect(m.selected_db(), timeout=60)
    c.execute('PRAGMA busy_timeout=60000')
    stamp = dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    temporary = ROOT / 'backups' / ('daily-history-' + stamp + '.tmp.sqlite')
    if shutil.disk_usage(ROOT).free < Path(m.selected_db()).stat().st_size * 2:
        raise RuntimeError('INSUFFICIENT_BACKUP_SPACE')
    backup = sqlite3.connect(temporary)
    c.backup(backup)
    assert backup.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
    backup.execute('PRAGMA journal_mode=DELETE')
    backup.close()
    compressed = temporary.with_name('daily-history-' + stamp + '.sqlite.gz')
    with temporary.open('rb') as source, gzip.open(compressed, 'wb', compresslevel=1) as destination:
        shutil.copyfileobj(source, destination)
    with gzip.open(compressed, 'rb') as check:
        while check.read(1024 * 1024):
            pass
    # This run's temporary copy is now verified and retained in compressed form.
    temporary.unlink()
    log({'backup': str(compressed), 'bytes': compressed.stat().st_size, 'integrity_check': 'ok'})
    devices = c.execute('SELECT DISTINCT device_key FROM ecowitt_history_import_chunks').fetchall()
    assert len(devices) == 1
    device = devices[0][0]
    if '--apply-tested-recovery' in sys.argv:
        import coverage_recovery
        coverage_recovery.apply_test(c)
    if os.environ.get('CLIMA_RECONCILE_SAVED') == '1':
        import coverage_recovery
        coverage_recovery.recover(c)
    values = m.read_vars()
    auth = {'application_key': values['ECOWITT_APPLICATION_KEY'], 'api_key': values['ECOWITT_API_KEY']}
    mac = values.get('ECOWITT_MAC')
    if not mac:
        found = []
        m.find_devices(m.request_api('/device/list', auth).get('data'), found)
        chosen = next(d for d in found if str(d.get('id', d.get('device_id'))) == str(values.get('ECOWITT_DEVICE_ID', '251816')))
        mac = chosen.get('mac', chosen.get('mac_address'))
    assert m.hashlib.sha256(str(mac).encode()).hexdigest() == device
    end_ts = int(time.time())
    failure = False
    statistics_since = end_ts-7*86400
    attempted = {}

    def fetch_window(cycle, start, end, previous=None):
        nonlocal failure, statistics_since
        identity = (cycle, start, end)
        if identity in attempted:
            return attempted[identity]
        attempted[identity] = False
        # Persist BEFORE the network call: an interrupted process must not lose its retry.
        key = remember_window(c, device, cycle, start, end)
        try:
            data = m.request_api('/device/history', {**auth, 'mac': mac,
              'start_date': dt.datetime.fromtimestamp(start, m.BAURU).strftime('%Y-%m-%d %H:%M:%S'),
              'end_date': dt.datetime.fromtimestamp(end, m.BAURU).strftime('%Y-%m-%d %H:%M:%S'),
              'cycle_type': cycle, 'call_back': m.CALLBACKS, **m.UNITS}).get('data') or {}
            statistics_since = min(statistics_since,start)
            combined = merge_payload(json.loads(previous or '{}'), data)
            points = [point for point in m.iter_series(combined) if start <= point[1] <= end]
            with c:
                for metric, timestamp, value, unit in points:
                    merge_point(c, device, cycle, metric, timestamp, value, unit)
                c.execute('''INSERT INTO ecowitt_history_import_chunks VALUES(?,?,?,?,?,?,?)
                  ON CONFLICT(device_key,cycle_type,start_ts,end_ts) DO UPDATE SET
                  status=excluded.status,api_points=excluded.api_points,payload=excluded.payload''',
                  (device, cycle, start, end, ('complete' if coverage(points,cycle,start,end)['complete'] else 'partial') if points else 'empty', len(points), json.dumps(combined, separators=(',', ':'))))
                c.execute('DELETE FROM ecowitt_history_import_meta WHERE key=?', (key,))
            attempted[identity] = True
            log({'cycle': cycle, 'start': m.iso(start), 'end': m.iso(end), 'status': ('complete' if coverage(points,cycle,start,end)['complete'] else 'partial') if points else 'empty', 'points': len(points)})
            time.sleep(3.1)
            return True
        except Exception as error:
            failure = True
            reason = str(error)
            log({'cycle': cycle, 'start': m.iso(start), 'end': m.iso(end), 'status': 'error',
              'reason': reason if reason.startswith(('API_CODE_', 'HTTP_', 'NETWORK_')) else type(error).__name__})
            return False

    for cycle, start, end in pending_windows(c, device):
        prior = c.execute('SELECT payload FROM ecowitt_history_import_chunks WHERE device_key=? AND cycle_type=? AND start_ts=? AND end_ts=?', (device,cycle,start,end)).fetchone()
        fetch_window(cycle, start, end, prior[0] if prior else None)
    for cycle in m.CYCLES:
        for start,end,payload in c.execute('SELECT start_ts,end_ts,payload FROM ecowitt_history_import_chunks WHERE device_key=? AND cycle_type=? AND end_ts>=? ORDER BY start_ts', (device,cycle,end_ts-86400)).fetchall():
            fetch_window(cycle,start,end,payload)
    for cycle, start, end, payload in c.execute("SELECT cycle_type,start_ts,end_ts,payload FROM ecowitt_history_import_chunks WHERE status IN ('empty','error') AND device_key=? AND end_ts < ? ORDER BY start_ts", (device, end_ts - 3600,)).fetchall():
        fetch_window(cycle, start, end, payload)
    for cycle, span in m.CYCLES.items():
        cursor = c.execute('SELECT MAX(end_ts)+1 FROM ecowitt_history_import_chunks WHERE device_key=? AND cycle_type=?', (device, cycle)).fetchone()[0]
        assert cursor is not None
        while cursor <= end_ts:
            end = min(cursor + span - 1, end_ts)
            if not fetch_window(cycle, cursor, end):
                break
            cursor = end + 1
    repair_plan = os.environ.get('CLIMA_REPAIR_PLAN')
    if repair_plan:
        from history_gap_repair import run_repair
        result = run_repair(c, m, device, auth, mac, Path(repair_plan), ROOT / 'backups', log)
        failure = failure or result['failed']
        if result['earliest_changed'] is not None:
            statistics_since = min(statistics_since, result['earliest_changed'])
    baseline = os.environ.get('CLIMA_REPAIR_BASELINE')
    if baseline:
        from history_gap_repair import restore_checkpoint_provenance
        log({'checkpoint_provenance_restored': restore_checkpoint_provenance(c,m,Path(baseline))})
    from history_statistics import build_statistics
    build_statistics(c, None if '--apply-tested-recovery' in sys.argv else statistics_since)
    check = c.execute('PRAGMA quick_check').fetchone()[0]
    log({'quick_check': check, 'target': m.iso(end_ts), 'failed': failure})
    assert check == 'ok'
    c.close()
    return 1 if failure else 0


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except Exception as error:
        log({'status': 'failed', 'reason': type(error).__name__})
        raise SystemExit(1)
