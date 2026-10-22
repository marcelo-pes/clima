"""Compare an archive to its verified baseline; never changes either database."""
import json
import sqlite3
from history_statistics import VALID


def flatten(node, path=()):
    if isinstance(node, dict):
        for key, value in node.items():
            yield from flatten(value, path + (key,))
    else:
        yield path, node


def verify(database, baseline):
    c = sqlite3.connect('file:' + str(database) + '?mode=ro', uri=True, timeout=60)
    c.execute('PRAGMA cache_size=-16000')
    c.execute('ATTACH DATABASE ? AS baseline', ('file:' + str(baseline) + '?mode=ro',))
    lost = c.execute('''SELECT COUNT(*) FROM baseline.ecowitt_history_points b
      LEFT JOIN main.ecowitt_history_points n USING(device_key,metric_path,observed_at)
      WHERE n.observed_at IS NULL''').fetchone()[0]
    changed = c.execute('''SELECT COUNT(*) FROM baseline.ecowitt_history_points b
      JOIN main.ecowitt_history_points n USING(device_key,metric_path,observed_at)
      WHERE b.rowid IN (SELECT rowid FROM baseline.ecowitt_history_points WHERE ''' + VALID + ''')
      AND (b.value!=n.value OR b.unit!=n.unit OR b.cycle_type!=n.cycle_type OR b.priority!=n.priority)''').fetchone()[0]
    lost_indexes = c.execute('''SELECT COUNT(*) FROM baseline.ecowitt_history_cycle_points b
      LEFT JOIN main.ecowitt_history_cycle_points n USING(device_key,cycle_type,metric_path,observed_at)
      WHERE n.observed_at IS NULL''').fetchone()[0]
    duplicates = c.execute('''SELECT COUNT(*) FROM (SELECT device_key,metric_path,observed_at
      FROM main.ecowitt_history_points GROUP BY device_key,metric_path,observed_at HAVING COUNT(*)>1)''').fetchone()[0]
    lost_checkpoints = missing_members = changed_members = 0
    for device, cycle, a, b, raw in c.execute('SELECT device_key,cycle_type,start_ts,end_ts,payload FROM baseline.ecowitt_history_import_chunks'):
        row = c.execute('SELECT payload FROM main.ecowitt_history_import_chunks WHERE device_key=? AND cycle_type=? AND start_ts=? AND end_ts=?', (device, cycle, a, b)).fetchone()
        if not row:
            lost_checkpoints += 1
            continue
        old = dict(flatten(json.loads(raw or '{}')))
        new = dict(flatten(json.loads(row[0] or '{}')))
        for path, value in old.items():
            if path not in new:
                missing_members += 1
            elif value not in (None, '', '-') and new[path] != value:
                changed_members += 1
    integrity = c.execute('PRAGMA main.integrity_check').fetchall()
    counts = {}
    for table in ['ecowitt_history_points','ecowitt_history_cycle_points','ecowitt_history_import_chunks']:
        before = c.execute('SELECT COUNT(*) FROM baseline.' + table).fetchone()[0]
        after = c.execute('SELECT COUNT(*) FROM main.' + table).fetchone()[0]
        counts[table] = {'before': before, 'after': after, 'added': after-before}
    report = {'lost_observations': lost, 'changed_valid_observations': changed, 'lost_cycle_indexes': lost_indexes,
      'duplicates': duplicates, 'lost_checkpoints': lost_checkpoints, 'missing_original_payload_members': missing_members,
      'changed_original_valid_payload_members': changed_members, 'integrity_check': 'ok' if integrity == [('ok',)] else integrity, 'counts': counts}
    c.close()
    assert all(report[key] == 0 for key in ['lost_observations','changed_valid_observations','lost_cycle_indexes','duplicates','lost_checkpoints','missing_original_payload_members','changed_original_valid_payload_members']), report
    assert report['integrity_check'] == 'ok', report
    return report
