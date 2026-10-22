#!/usr/bin/env python3
"""Clima: clean Git/lockfile build, Linux runtime package and strict validation."""
import argparse, hashlib, io, json, os, platform, re, shutil, subprocess, tarfile, urllib.request
from pathlib import Path, PurePosixPath
NODE_VERSION = '22.23.3'
NODE_SHA256 = '1084aa36196bba4c3a5e69a1ee388a6e4ff729dad09445fbcd434b28fe3c24af'
SCHEMA = 1

def sha(p):
    h = hashlib.sha256()
    with Path(p).open('rb') as f:
        for block in iter(lambda: f.read(1024 * 1024), b''): h.update(block)
    return h.hexdigest()

def run(args, **kwargs):
    subprocess.run([str(a) for a in args], check=True, **kwargs)

def safe_members(tar):
    seen = set()
    for m in tar.getmembers():
        p = PurePosixPath(m.name)
        if p.is_absolute() or '..' in p.parts or '\\' in m.name or m.name in seen or not p.parts:
            raise ValueError('Invalid/duplicate archive path: ' + m.name)
        if not (m.isfile() or m.isdir()): raise ValueError('Links/devices forbidden: ' + m.name)
        seen.add(m.name)
        yield m

def validate(archive):
    with tarfile.open(archive, 'r:gz') as t:
        members = list(safe_members(t))
        actual = {m.name: m for m in members if m.isfile()}
        manifest = json.load(t.extractfile('release-manifest.json'))
        if manifest.get('schema') != SCHEMA or manifest.get('project') != 'Clima' or manifest.get('target') != 'linux-x64':
            raise ValueError('Not a consolidated Clima Linux release')
        rows = manifest['files']; expected = {r['path']: r for r in rows}
        if len(expected) != len(rows) or set(expected) != set(actual) - {'release-manifest.json'}:
            raise ValueError('Manifest must cover every file exactly once')
        required = {'dist/server/index.js', 'runtime/server.mjs', 'runtime/camera-service.mjs', 'runtime/cloudflare-env.mjs', 'runtime/register-loader.mjs', 'runtime/cloudflare-loader.mjs', 'node/bin/node', 'package.json', 'start.sh', 'collector/ecowitt_history_sync.py', 'collector/ecowitt_history_import.py'}
        if not required <= set(actual): raise ValueError('Incomplete release')
        for name, m in actual.items():
            if name == 'release-manifest.json': continue
            p = PurePosixPath(name)
            allowed = p.parts[0] in ('dist', 'runtime', 'collector', 'licenses') or name in required or name == 'node/LICENSE'
            if not allowed or 'node_modules' in p.parts or p.suffix in ('.sqlite', '.db', '.pem', '.key') or p.name.startswith(('.env', '.dev.vars', '.runtime.vars')):
                raise ValueError('Unexpected/private file: ' + name)
            data = t.extractfile(m).read()
            if hashlib.sha256(data).hexdigest() != expected[name]['sha256'] or len(data) != expected[name]['bytes']:
                raise ValueError('Hash/size mismatch: ' + name)
            if name == 'node/bin/node':
                # ELF64 little endian, x86-64. No Darwin executable can pass.
                if data[:6] != b'\x7fELF\x02\x01' or data[18:20] != b'\x3e\x00': raise ValueError('Wrong Node platform')
                if not m.mode & 0o111: raise ValueError('Node must be executable')
            elif data[:4] in (b'\x7fELF', b'\xcf\xfa\xed\xfe', b'\xfe\xed\xfa\xcf', b'\xca\xfe\xba\xbe'):
                raise ValueError('Unexpected native executable: ' + name)
        if manifest.get('node', {}).get('archive_sha256') != NODE_SHA256:
            raise ValueError('Runtime provenance mismatch')
        return manifest

def build(source, output, ref='HEAD'):
    from install_deps import install
    source = source.resolve(); output = output.resolve()
    output.mkdir(parents=True, exist_ok=False)
    commit = subprocess.check_output(['git', '-C', str(source), 'rev-parse', ref + '^{commit}'], text=True).strip()
    workspace = output / 'source'; workspace.mkdir()
    raw = subprocess.check_output(['git', '-C', str(source), 'archive', commit])
    with tarfile.open(fileobj=io.BytesIO(raw)) as t:
        list(safe_members(t)); t.extractall(workspace)
    if (workspace / 'node_modules').exists(): raise ValueError('Git contains node_modules')
    install(workspace, output/'install')
    env = {k:v for k,v in os.environ.items() if not any(word in k.upper() for word in ('TOKEN', 'SECRET', 'PASSWORD', 'API_KEY'))}
    env.update(NODE_ENV='production', CLOUDFLARE_CF_FETCH_ENABLED='false', WRANGLER_SEND_METRICS='false', WRANGLER_WRITE_LOGS='false')
    run(['node', 'scripts/run-framework.mjs', 'build'], cwd=workspace, env=env)
    package(workspace, output, commit)
    for name in ('install.log', 'install-report.json'):
        shutil.copy2(output/'install'/name, output/name)
    # Only remove scratch dependencies created by this build. Keep source export,
    # package, manifests and proof, without accumulating gigabytes on the Mac.
    shutil.rmtree(workspace/'node_modules')
    shutil.rmtree(output/'install')
    print('Clean source/lockfile build:', commit, flush=True)

def package(workspace, output, commit):
    release = output/'release'; release.mkdir()
    for name in ('dist', 'runtime'): shutil.copytree(workspace/name, release/name)
    shutil.copytree(workspace/'deploy/coleta', release/'collector', ignore=shutil.ignore_patterns('__pycache__', '*.pyc'))
    shutil.copy2(workspace/'deploy/start.sh', release/'start.sh')
    os.chmod(release/'start.sh', 0o755)
    (release/'package.json').write_text('{"name":"clima-runtime","private":true,"type":"module"}\n')
    download = output/'node-linux-x64.tar.gz'
    urllib.request.urlretrieve(f'https://nodejs.org/dist/v{NODE_VERSION}/node-v{NODE_VERSION}-linux-x64.tar.gz', download)
    if sha(download) != NODE_SHA256: raise ValueError('Official Node checksum mismatch')
    prefix = f'node-v{NODE_VERSION}-linux-x64/'
    with tarfile.open(download) as t:
        for name, target in [('bin/node', release/'node/bin/node'), ('LICENSE', release/'node/LICENSE')]:
            m = t.getmember(prefix+name)
            if not m.isfile(): raise ValueError('Node file is not regular')
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(t.extractfile(m).read()); target.chmod(0o755 if name=='bin/node' else 0o644)
    # Licenses are needed even when JS dependencies are bundled.
    license_dir = release/'licenses'; license_dir.mkdir()
    for p in sorted((workspace/'node_modules/.pnpm').glob('*/node_modules/*/LICENSE*')):
        if p.is_file(): shutil.copy2(p, license_dir/(p.parent.parent.parent.name+'-'+p.name))
    files = [{'path': str(p.relative_to(release)), 'sha256': sha(p), 'bytes': p.stat().st_size} for p in sorted(release.rglob('*')) if p.is_file()]
    manifest = dict(schema=SCHEMA, project='Clima', target='linux-x64', source_commit=commit, lock_sha256=sha(workspace/'pnpm-lock.yaml'), build_host=platform.system(), node=dict(version=NODE_VERSION, archive_sha256=NODE_SHA256), dependencies=dict(node_modules=False, python='3.9+ with sqlite3 for collector', linux='x86_64 glibc >=2.28'), files=files)
    (release/'release-manifest.json').write_text(json.dumps(manifest, indent=2)+'\n')
    archive = output/'clima-linux-x64.tar.gz'
    with tarfile.open(archive, 'w:gz') as t:
        for p in sorted(release.rglob('*')):
            if p.is_file(): t.add(p, arcname=str(p.relative_to(release)), recursive=False)
    validate(archive)
    (output/'SHA256SUMS').write_text(sha(archive)+'  '+archive.name+'\n')
    print('Validated package:', archive, flush=True)

def stage(archive, releases):
    manifest = validate(archive)
    releases.mkdir(parents=True, exist_ok=True)
    target = releases/('clima-'+manifest['source_commit'][:12]+'-'+sha(archive)[:12])
    if target.exists():
        if target.is_symlink() or not target.is_dir(): raise ValueError('Release destination is not a regular directory')
        for row in manifest['files']:
            p = target / row['path']
            if p.is_symlink() or not p.is_file() or sha(p) != row['sha256']:
                raise ValueError('Existing release differs: ' + row['path'])
        print(target)
        return target
    target.mkdir()  # Never overwrite an existing release, secrets or data.
    try:
        with tarfile.open(archive) as t: t.extractall(target)
    except BaseException:
        shutil.rmtree(target); raise
    print(target)
    return target

def main():
    p=argparse.ArgumentParser(description=__doc__); commands=p.add_subparsers(dest='command',required=True)
    b=commands.add_parser('build'); b.add_argument('--source',type=Path,default=Path(__file__).resolve().parents[2]); b.add_argument('--output',type=Path,required=True); b.add_argument('--ref',default='HEAD')
    v=commands.add_parser('validate'); v.add_argument('archive',type=Path)
    s=commands.add_parser('stage'); s.add_argument('archive',type=Path); s.add_argument('--releases',type=Path,required=True)
    a=p.parse_args()
    if a.command=='build': build(a.source,a.output,a.ref)
    elif a.command=='validate': print(json.dumps({k:v for k,v in validate(a.archive).items() if k!='files'},indent=2))
    else: stage(a.archive,a.releases)
if __name__=='__main__':main()
