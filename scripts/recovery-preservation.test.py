"""Offline recovery on a separate copy: baseline, source evidence, test database."""
import importlib.util
import json
from pathlib import Path
import shutil
import sqlite3
import sys

from recover_real_history import recover_sources
from verify_history_preservation import verify
from history_statistics import build_statistics

baseline, evidence, destination = map(Path, sys.argv[1:4])
assert baseline.resolve() != destination.resolve() and not destination.exists()
spec = importlib.util.spec_from_file_location('importer', Path(__file__).with_name('ecowitt-history-import.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
shutil.copyfile(baseline, destination)
c = sqlite3.connect(destination)
devices = c.execute('SELECT DISTINCT device_key FROM ecowitt_history_import_chunks').fetchall()
assert len(devices) == 1
results = recover_sources(c, m, devices[0][0], evidence)
changes = [x['earliest_changed'] for x in results if x['earliest_changed'] is not None]
if changes:
    build_statistics(c, min(changes))
replay = recover_sources(c, m, devices[0][0], evidence)
assert all(x['added_valid'] == x['filled_missing'] == x['indexed'] == 0 for x in replay)
c.close()
print(json.dumps({'preservation': verify(destination, baseline), 'recovery': results, 'idempotency': 'passed'}), flush=True)
