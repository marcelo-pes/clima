"""Apply tested real-source recovery under the existing archive lock and backup.

Run as the archive owner. Source files must match the manifest tested offline.
Keeps a verified compressed backup and removes only this run's temporary copy.
"""
import argparse
import datetime
import fcntl
import gzip
import hashlib
import importlib.util
import json
from pathlib import Path
import shutil
import sqlite3

from recover_real_history import recover_sources, SOURCE_FILES
from verify_history_preservation import verify
from history_statistics import build_statistics


def log(value):
    print(json.dumps(value), flush=True)


def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        for block in iter(lambda: f.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--evidence', type=Path, required=True)
    parser.add_argument('--sha-manifest', type=Path, required=True)
    parser.add_argument('--isolated-report', type=Path, required=True)
    args = parser.parse_args()
    hashes = json.loads(args.sha_manifest.read_text())
    for filename in SOURCE_FILES:
        assert digest(args.evidence / filename) == hashes[filename], 'SOURCE_NOT_TESTED'
    tested = json.loads(args.isolated_report.read_text())
    assert tested['tested_source_sha256'] == {k: hashes[k] for k in SOURCE_FILES}, 'SOURCE_MANIFEST_DIFFERS_FROM_TEST'
    assert tested['integrity_check'] == 'ok'
    for key in ['lost_observations','changed_valid_observations','lost_cycle_indexes','duplicates','lost_checkpoints','missing_original_payload_members','changed_original_valid_payload_members']:
        assert tested[key] == 0, 'PRESERVATION_TEST_FAILED'
    root = Path('/opt/clima-antaisolar')
    spec = importlib.util.spec_from_file_location('importer', Path(__file__).with_name('ecowitt-history-import.py'))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    with (root / 'backups/history-import.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        database = Path(m.selected_db())
        assert database.is_relative_to(root / 'database'), 'WRONG_PRODUCTION_DATABASE'
        assert shutil.disk_usage(root).free > database.stat().st_size * 2
        stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
        folder = root / 'backups' / ('history-recovery-' + stamp)
        folder.mkdir()
        baseline = folder / 'production-before.tmp.sqlite'
        compressed = folder / 'production-before.sqlite.gz'
        c = sqlite3.connect(database, timeout=60)
        c.execute('PRAGMA busy_timeout=60000')
        c.execute('PRAGMA cache_size=-16000')
        backup = sqlite3.connect(baseline)
        c.backup(backup)
        assert backup.execute('PRAGMA integrity_check').fetchall() == [('ok',)]
        backup.execute('PRAGMA journal_mode=DELETE')
        backup.close()
        sqlite_hash = digest(baseline)
        with baseline.open('rb') as source, gzip.open(compressed, 'wb', compresslevel=1) as target:
            shutil.copyfileobj(source, target)
        roundtrip = hashlib.sha256()
        with gzip.open(compressed, 'rb') as f:
            for block in iter(lambda: f.read(1024 * 1024), b''):
                roundtrip.update(block)
        assert roundtrip.hexdigest() == sqlite_hash
        manifest = {'source': str(database), 'backup': str(compressed), 'integrity_check': 'ok',
          'sqlite_sha256': sqlite_hash, 'gzip_sha256': digest(compressed), 'decompressed_sha256_matches': True,
          'source_evidence_sha256': {k: hashes[k] for k in SOURCE_FILES}}
        (folder / 'backup-manifest.json').write_text(json.dumps(manifest, indent=2))
        log({'phase': 'fresh_backup_verified', 'folder': str(folder), **manifest})
        devices = c.execute('SELECT DISTINCT device_key FROM ecowitt_history_import_chunks').fetchall()
        assert len(devices) == 1
        results = recover_sources(c, m, devices[0][0], args.evidence)
        log({'phase': 'real_source_applied', 'recovery': results})
        earliest = [x['earliest_changed'] for x in results if x['earliest_changed'] is not None]
        if earliest:
            build_statistics(c, min(earliest))
        c.close()
        report = verify(database, baseline)
        report.update({'recovery': results, 'backup': manifest, 'status': 'verified'})
        (folder / 'recovery-report.json').write_text(json.dumps(report, indent=2))
        log({'phase': 'production_recovery_verified', 'folder': str(folder), **report})
        # This run's temporary baseline is redundant with the verified gzip.
        # Its removal avoids leaving another 1 GB on the production filesystem.
        baseline.unlink()
        log({'phase': 'temporary_copy_removed', 'verified_backup_retained': str(compressed)})


if __name__ == '__main__':
    main()
