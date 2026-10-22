from pathlib import Path
import hashlib,json,datetime,tarfile,shutil,subprocess,time,urllib.request
base=Path('/root/CLIMA/Clima');app=base/'app';release=base/'releases/20261005-performance'
manifest=json.loads((release/'expected-source-hashes.json').read_text())
for name,digest in manifest.items():assert hashlib.sha256((app/name).read_bytes()).hexdigest()==digest,'SOURCE_CHANGED:'+name
stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ');backup=base/'backups'/('code-before-'+stamp+'.tar.gz')
files=list(manifest)+['scripts/weather-database-only.test.mjs','scripts/history-point-merge.test.py']
with tarfile.open(backup,'w:gz') as t:
    for name in files:
        if (app/name).exists():t.add(app/name,arcname=name)
old_dist=base/'backups'/('dist-before-'+stamp)
print('CODE_BACKUP',backup,flush=True)
try:
    (app/'dist').rename(old_dist)
    shutil.copytree(release/'dist',app/'dist')
    for name in files:
        (app/name).parent.mkdir(parents=True,exist_ok=True);shutil.copy2(release/name,app/name)
    subprocess.run(['chown','-R','clima:clima',str(app/'dist')],check=True)
    for name in files:subprocess.run(['chown','clima:clima',str(app/name)],check=True)
    subprocess.run(['systemctl','restart','clima-antaisolar.service'],check=True)
    for attempt in range(30):
        try:
            urllib.request.urlopen('http://127.0.0.1:8787/confere',timeout=2).read();break
        except Exception:time.sleep(1)
    for period in ('7d','30d','1y'):
        start=time.monotonic()
        with urllib.request.urlopen('http://127.0.0.1:8787/api/weather?view=current&range='+period+'&date=2026-09-24',timeout=30) as response:
            result=json.load(response)
        assert result['historySource']=='database'
        assert any(x['points'] for x in result['history'].values())
        print(json.dumps({'range':period,'source':result['historySource'],'incomplete':result['historyIncomplete'],'series':len(result['history']),'seconds':round(time.monotonic()-start,3)}),flush=True)
    print('DEPLOY_OK',flush=True)
except Exception as error:
    print('DEPLOY_FAILED',type(error).__name__,flush=True)
    failed=base/'backups'/('dist-failed-'+stamp);(app/'dist').rename(failed);old_dist.rename(app/'dist')
    with tarfile.open(backup) as t:t.extractall(app,filter='data')
    subprocess.run(['systemctl','restart','clima-antaisolar.service'],check=True)
    raise
