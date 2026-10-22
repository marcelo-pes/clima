"""Restore preserved Ecowitt responses on an explicit database connection.

The caller must hold the archive lock and verify a fresh backup for production.
No estimates, resampling, deletion, or replacement of valid existing readings.
"""
import gzip
import json
from pathlib import Path

from history_gap_repair import apply_response

SOURCE_FILES = ('source-24h.json.gz', 'source-7d.json.gz', 'source-30d.json.gz', 'source-1y.json.gz')


def recover_sources(c, importer, device, evidence_folder):
    report = []
    for filename in SOURCE_FILES:
        path = Path(evidence_folder) / filename
        with gzip.open(path, 'rt') as source:
            evidence = json.load(source)
        if str(evidence.get('provider_code')) != '0':
            raise ValueError('SOURCE_RESPONSE_NOT_SUCCESSFUL')
        window = evidence['window']
        cycle, start, end = window['cycle'], window['start'], window['end']
        if cycle not in importer.CYCLES or not 0 <= end - start <= importer.CYCLES[cycle]:
            raise ValueError('INVALID_SOURCE_WINDOW')
        cursor = c.execute('SELECT MAX(end_ts) FROM ecowitt_history_import_chunks WHERE device_key=? AND cycle_type=?', (device, cycle)).fetchone()[0]
        if cursor is None:
            raise ValueError('EXISTING_ARCHIVE_REQUIRED')
        # New tail observations must be owned by a checkpoint as well as indexed.
        # Split by the provider's maximum inclusive query span if necessary.
        next_start = max(start, cursor + 1)
        while next_start <= end:
            next_end = min(end, next_start + importer.CYCLES[cycle] - 1)
            with c:
                c.execute('INSERT INTO ecowitt_history_import_chunks VALUES(?,?,?,?,?,?,?)',
                  (device, cycle, next_start, next_end, 'empty', 0, '{}'))
            next_start = next_end + 1
        result = apply_response(c, importer, device, cycle, start, end, evidence.get('data') or {})
        report.append({'source': filename, 'cycle': cycle, 'start': start, 'end': end, **result})
    return report
