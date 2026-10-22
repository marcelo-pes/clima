#!/usr/bin/env python3
"""Fresh lockfile install, portable between macOS and Linux."""
import argparse,json,re,subprocess,hashlib
from pathlib import Path

def install(source,work):
 source=source.resolve();work=work.resolve()
 if (source/'node_modules').exists():raise ValueError('Clean install requires a source tree without node_modules')
 work.mkdir(parents=True,exist_ok=False)
 spec=json.loads((source/'package.json').read_text())['packageManager']
 if not re.fullmatch(r'pnpm@\d+\.\d+\.\d+',spec):raise ValueError('Pin pnpm explicitly')
 subprocess.run(['npm','--prefix',str(work/'tools'),'--cache',str(work/'npm-cache'),'install','--ignore-scripts','--no-audit','--no-fund',spec],check=True)
 command=['node',str(work/'tools/node_modules/pnpm/bin/pnpm.cjs'),'install','--frozen-lockfile','--store-dir',str(work/'pnpm-store'),'--cache-dir',str(work/'pnpm-cache')]
 with (work/'install.log').open('w') as log:
  process=subprocess.Popen(command,cwd=source,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True)
  for line in process.stdout:
   print(line,end='',flush=True);log.write(line)
  if process.wait():raise subprocess.CalledProcessError(process.returncode,command)
 (work/'install-report.json').write_text(json.dumps(dict(package_manager=spec,lock_sha256=hashlib.sha256((source/'pnpm-lock.yaml').read_bytes()).hexdigest(),node_modules_initially_absent=True,fresh_store=True),indent=2))
if __name__=='__main__':
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--source',type=Path,default=Path(__file__).resolve().parents[2]);p.add_argument('--work',type=Path,required=True);a=p.parse_args();install(a.source,a.work)
