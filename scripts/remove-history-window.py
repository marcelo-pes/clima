#!/usr/bin/env python3
"""Remove only the obsolete history banner from the existing VPS frontend.

Run on the VPS with --apply; without it, validate and report the planned edits.
The GitHub frontend predates this production-only component. Do not replace the
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

SOURCE = re.compile(r'\{needsHistory && data\?\.historyWindow && <div className="history-window">.*?</div>\}')
BUNDLE = re.compile(
    r'[A-Za-z_$][\w$]*&&[A-Za-z_$][\w$]*\?\.historyWindow&&'
    r'\(0,[A-Za-z_$][\w$]*\.jsxs\)\(`div`,\{className:`history-window`,children:\['
    r'[^\n]*?Marcadores de mínimo e máximo: todos os registros disponíveis no período\.`\]\}\),'
)
ROOTS = [(Path('/opt/clima-antaisolar'), 'clima-antaisolar', 8787),
         (Path('/opt/clima2-antaisolar'), 'clima2-antaisolar', 8788)]
NODE = '/opt/clima-antaisolar/runtime/node-v22/bin/node'
SUFFIX = '-no-history-window20261016'


def transform(path, text):
    if path.suffix == '.tsx':
        result, count = SOURCE.subn('', text)
    elif path.suffix == '.js':
        result, count = BUNDLE.subn('', text)
    elif path.suffix == '.css':
        # Preserve section-loading styling while deleting the obsolete selector.
        result = text.replace('.section-loading,.history-window', '.section-loading')
        count = int(result != text)
    else:
        return text
    if re.search(r'className[:=][`"]history-window|\.history-window[ {,]', result):
        raise ValueError(f'Unexpected banner shape: {path}')
    if count > 1:
        raise ValueError(f'Multiple banner components: {path}')
    return result


def plan(root):
    app = root / 'app'
    files = [app / 'app/weather-dashboard.tsx', app / 'app/globals.css']
    repo_source = root / 'repository/app/weather-dashboard.tsx'
    if repo_source.exists():
        files.append(repo_source)
    files += [p for p in (app / 'dist').rglob('*')
              if p.is_file() and p.suffix in ('.js', '.json', '.html', '.css')]
    originals = {p: p.read_text() for p in files}
    names = {p.name: p.stem + SUFFIX + p.suffix for p, s in originals.items()
             if p.suffix in ('.js', '.css') and transform(p, s) != s}
    changes = {}
    for path, before in originals.items():
        after = transform(path, before)
        for old, new in names.items():
            after = after.replace(old, new)
        if after != before:
            changes[path] = (before, after)
    return changes, names


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    # Validate both services before making any edits.
    plans = [(root, service, port, *plan(root)) for root, service, port in ROOTS]
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    for root, service, port, changes, names in plans:
        print(json.dumps({'service': service, 'changed_files': len(changes),
                          'cache_busted_assets': len(names), 'apply': args.apply}), flush=True)
        if not args.apply or not changes:
            continue
        backup = root / 'backups' / ('remove-history-window-' + stamp)
        backup.mkdir(mode=0o700)
        with tarfile.open(backup / 'before.tar.gz', 'w:gz') as archive:
            for path in changes:
                archive.add(path, arcname=str(path.relative_to(root)))
        created = []
        try:
            for path, (_, after) in changes.items():
                path.write_text(after)
                if path.name in names:
                    target = path.with_name(names[path.name])
                    if target.exists():
                        raise ValueError(f'Cache-busted asset already exists: {target}')
                    target.write_text(after)
                    stat = path.stat()
                    import os
                    os.chown(target, stat.st_uid, stat.st_gid)
                    target.chmod(stat.st_mode & 0o777)
                    created.append(target)
                if path.suffix == '.js':
                    subprocess.run([NODE, '--check', str(path)], check=True,
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
            for path, (before, _) in changes.items():
                path.write_text(before)
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
