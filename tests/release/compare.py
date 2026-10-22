#!/usr/bin/env python3
"""Run the standalone release and published baseline with identical synthetic inputs."""
import argparse,json,os,subprocess,sys,time,urllib.request,urllib.error,hashlib,shutil
from pathlib import Path
from fixture import create
from baseline_proxy import start as start_baseline_proxy
SOURCE=Path(__file__).resolve().parents[2]
def request(port,path):
 try:
  with urllib.request.urlopen(f'http://127.0.0.1:{port}{path}',timeout=30) as r:return r.status,r.read()
 except urllib.error.HTTPError as e:return e.code,e.read()
def main():
 p=argparse.ArgumentParser();p.add_argument('--release',type=Path,required=True);p.add_argument('--baseline',type=Path,required=True);p.add_argument('--output',type=Path,required=True);p.add_argument('--node');p.add_argument('--browser',action='store_true');p.add_argument('--provider-mode',choices=['healthy','fallback','unavailable'],default='healthy');a=p.parse_args()
 out=a.output.resolve();out.mkdir(parents=True,exist_ok=False);processes=[];files=[];proxy=None
 node=Path(a.node).resolve() if a.node else (a.release/'node/bin/node').resolve()
 try:
  for name,root,port in [('baseline',a.baseline.resolve(),18988),('release',a.release.resolve(),18989)]:
   data=out/name;db=create(data,SOURCE);(data/'before.sha256').write_text(hashlib.sha256(db.read_bytes()).hexdigest());env=os.environ.copy();env.update(PORT=str(port),NODE_ENV='production',CLIMA_SQLITE_PATH=str(db),CLIMA_SECRETS_FILE=str(data/'runtime.vars'),CLIMA_CAMERA_CACHE_DIR=str(data/'cache'),CLIMA_TEST_FETCH_LOG=str(data/'upstream.jsonl'),CLIMA_TEST_PROVIDER_MODE=a.provider_mode)
   assert not (root/'node_modules').exists(), 'Standalone test must not have node_modules'
   env.pop('NODE_PATH',None)
   log=(data/'server.log').open('w');files.append(log)
   process=subprocess.Popen([str(node),'--import',str(SOURCE/'tests/release/preload.mjs'),'--import','./runtime/register-loader.mjs','./runtime/server.mjs'],cwd=root,env=env,stdout=log,stderr=subprocess.STDOUT);processes.append(process)
   for _ in range(100):
    if process.poll() is not None:raise RuntimeError((data/'server.log').read_text())
    try:
     if request(port,'/healthz')[0]==200 and json.loads(request(port,'/api/camera')[1]).get('status')=='fresh':break
    except Exception:pass
    time.sleep(.2)
   else:raise RuntimeError('Startup/camera failed: '+(data/'server.log').read_text())
  results=[]
  for path,expected in [('/healthz',200),('/api/weather?range=24h&view=summary',200),('/api/weather?range=24h&view=current',200),('/api/weather?range=7d',200),('/api/weather?range=30d',200),('/api/weather?range=1y',200),('/api/weather?range=24h&date=2026-10-01',200),('/api/weather?range=7d&view=statistics',200),('/api/weather?view=extras',200),('/api/camera',200),('/api/camera/sequence',200),('/api/camera/image',200),('/api/weather/archive',403),('/api/generation',401)]:
   pair=[request(port,path) for port in [18988,18989]]
   assert all(s==expected for s,b in pair),(path,[(s,b[:400]) for s,b in pair])
   try:
    bodies=[json.loads(b) for s,b in pair]
    if path=='/healthz':
     for obj in bodies:obj.pop('releaseSha256',None)
    assert bodies[0]==bodies[1],(path,'JSON differs',bodies)
    if path=='/api/weather?view=extras':
     condition=bodies[1].get('currentWeather')
     if a.provider_mode=='healthy':assert condition and condition['source']=='Climatempo',condition
     elif a.provider_mode=='fallback':assert condition and 'METAR' in condition['source'],condition
     else:assert condition is None,condition
   except (json.JSONDecodeError, UnicodeDecodeError):assert pair[0][1]==pair[1][1],path
   results.append(dict(path=path,status=expected,equivalent=True));print('PASS',path,flush=True)
  for name in ['baseline','release']:
   logs=[json.loads(line) for line in (out/name/'server.log').read_text().splitlines() if line.startswith('{')]
   archived=[line for line in logs if line.get('sqliteOnly')]
   assert archived and all(line['ecowittRequests']==0 for line in archived)
   # Requests must never mutate the persistent SQLite file.
   assert hashlib.sha256((out/name/'weather.sqlite').read_bytes()).hexdigest()==(out/name/'before.sha256').read_text()
   import sqlite3
   db=sqlite3.connect(out/name/'weather.sqlite');assert db.execute('pragma quick_check').fetchone()==('ok',);db.close()
  if a.browser:
   import re
   proxy=start_baseline_proxy(a.baseline.resolve())
   for port in [18987,18989]:
    html=request(port,'/')[1].decode()
    assets=list(dict.fromkeys(re.findall(r'(?:src|href)="(/_next/static/[^"]+)"',html)))
    print('STATIC CHECK',port,[(url,request(port,url)[0]) for url in assets[:10]],flush=True)
    assert assets and all(request(port,url)[0]==200 for url in assets)
   subprocess.run(['node',str(SOURCE/'tests/browser/compare.mjs'),str(out)],check=True)
  (out/'report.json').write_text(json.dumps(dict(platform=sys.platform,node=subprocess.check_output([str(node),'--version'],text=True).strip(),node_modules=False,provider_mode=a.provider_mode,api_results=results,archived_external_requests=0),indent=2))
 finally:
  if proxy:proxy.shutdown();proxy.server_close()
  for process in processes:process.terminate()
  for process in processes:
   try:process.wait(timeout=10)
   except subprocess.TimeoutExpired:process.kill();process.wait()
  for f in files:f.close()
if __name__=='__main__':main()
