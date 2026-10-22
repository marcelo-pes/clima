#!/usr/bin/env python3
"""Open Forecast on every dashboard launch, including saved tab URLs.

Run on the VPS with --apply; without it, validate and report the planned edits.
The GitHub frontend differs from the production frontend. Do not replace the
published frontend with that older source. Keep data and chart code unchanged.
"""
import argparse
import datetime
import json
from pathlib import Path
import re
import subprocess
import tarfile
import time
import urllib.request

ROOTS = [(Path('/root/CLIMA/Clima'), 'clima-antaisolar', 8787),
         (Path('/root/CLIMA/Clima2'), 'clima2-antaisolar', 8788)]
NODE = '/root/CLIMA/Clima/runtime/node-v22/bin/node'
SUFFIX = '-forecast-start20261019'
SOURCE_OLD = '    const hash = window.location.hash.slice(1) as TabKey;\n    if (["current", "evolution", "wind", "map", "satellite", "profile"].includes(hash)) setTab(hash);'
SOURCE_NEW = '    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#map`);'
BUNDLE = re.compile(r'(?:let|const) ([A-Za-z_$][\w$]*)=window\.location\.hash\.slice\(1\);\[`current`,`evolution`,`wind`,`map`,`satellite`,`profile`\]\.includes\(\1\)&&[A-Za-z_$][\w$]*\(\1\),')


def transform(path, text):
    if path.suffix == '.tsx':
        return text.replace(SOURCE_OLD, SOURCE_NEW)
    if path.suffix == '.js':
        result, count = BUNDLE.subn('window.history.replaceState(null,``,window.location.pathname+window.location.search+`#map`),', text)
        if count > 1:
            raise ValueError(f'Multiple tab initializers: {path}')
        if 'location.hash.slice(1)' in result:
            raise ValueError(f'Unrecognized tab initializer: {path}')
        return result
    return text


def plan(root):
    app = root / 'app'
    files = [app / 'app/weather-dashboard.tsx', app / 'app/globals.css']
    repo_source = root / 'repository/app/weather-dashboard.tsx'
    if repo_source.exists():
        files.append(repo_source)
    files += [p for p in (app / 'dist').rglob('*')
              if p.is_file() and p.suffix in ('.js', '.json', '.html', '.css')]
    names = {path.name.replace(SUFFIX, ''): path.name for path in files
             if SUFFIX in path.name and path.suffix == '.js'}
    for path in files:
        if path.suffix not in ('.js', '.css'):
            continue
        before = path.read_text()
        if transform(path, before) != before:
            names[path.name] = path.stem + SUFFIX + path.suffix
    changes = []
    for path in files:
        before = path.read_text()
        after = transform(path, before)
        for old, new in names.items():
            after = after.replace(old, new)
        if after != before:
            changes.append(path)
    return changes, names


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    # Validate both services with bounded memory before making any edits.
    plans = [(root, service, port, *plan(root)) for root, service, port in ROOTS]
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    for root, service, port, changes, names in plans:
        print(json.dumps({'service': service, 'changed_files': len(changes),
                          'cache_busted_assets': len(names), 'apply': args.apply}), flush=True)
        if not args.apply or not changes:
            continue
        backup = root / 'backups' / ('forecast-start-' + stamp)
        backup.mkdir(mode=0o700)
        with tarfile.open(backup / 'before.tar.gz', 'w:gz') as archive:
            for path in changes:
                archive.add(path, arcname=str(path.relative_to(root)))
        created = []
        try:
            for path in changes:
                after = transform(path, path.read_text())
                for old, new in names.items():
                    after = after.replace(old, new)
                path.write_text(after)
                if path.name in names:
                    target = path.with_name(names[path.name])
                    if target.exists() and target.read_text() != after:
                        raise ValueError(f'Conflicting cache-busted asset: {target}')
                    existed = target.exists()
                    target.write_text(after)
                    stat = path.stat()
                    import os
                    os.chown(target, stat.st_uid, stat.st_gid)
                    target.chmod(stat.st_mode & 0o777)
                    if not existed:
                        created.append(target)
                if path.suffix == '.js':
                    subprocess.run([NODE, '--max-old-space-size=48', '--check', str(path)], check=True,
                                   stdout=subprocess.DEVNULL)
            subprocess.run(['systemctl', 'restart', service], check=True)
            for attempt in range(30):
                try:
                    with urllib.request.urlopen(f'http://127.0.0.1:{port}/', timeout=3) as r:
                        assert r.status == 200
                    break
                except Exception:
                    if attempt == 29:
                        raise
                    time.sleep(1)
        except Exception:
            with tarfile.open(backup / 'before.tar.gz', 'r:gz') as archive:
                for member in archive:
                    (root / member.name).write_bytes(archive.extractfile(member).read())
            for path in created:
                path.unlink()
            subprocess.run(['systemctl', 'restart', service], check=True)
            raise
        (backup / 'result.json').write_text(json.dumps({
            'service': service, 'changed_files': [str(p) for p in changes],
            'new_assets': [str(p) for p in created], 'backup': str(backup)}, indent=2))
        print(f'Published {service}; backup: {backup}', flush=True)


if __name__ == '__main__':
    main()
