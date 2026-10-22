#!/usr/bin/env python3
"""Stage an immutable Clima release. Promotion requires a healthy candidate.
No service/timer/proxy commands and no writes to configuration/database/cache.
"""
import argparse, json, os, sys, urllib.request
from pathlib import Path
from release import stage, sha

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('archive',type=Path);p.add_argument('--root',type=Path,required=True)
    p.add_argument('--promote',action='store_true');p.add_argument('--candidate-url')
    a=p.parse_args();root=a.root.resolve()
    release=stage(a.archive.resolve(),root/'releases')
    if not a.promote:
        print('Staged only. No process, configuration or data changed.');return
    if not a.candidate_url or not a.candidate_url.startswith('http://127.0.0.1:'):
        p.error('Promotion requires a separately running and tested loopback candidate')
    # Candidate must identify the exact package to prevent promoting a different server.
    with urllib.request.urlopen(a.candidate_url.rstrip('/')+'/healthz',timeout=10) as r:health=json.load(r)
    if health.get('releaseSha256') != sha(a.archive):
        p.error('Candidate hash does not match package (set CLIMA_RELEASE_SHA256 on candidate)')
    current=root/'current';previous=root/'previous'
    if current.exists() and not current.is_symlink():p.error('current must be a release symlink; preserve legacy app manually')
    if current.is_symlink():
        if previous.exists() and not previous.is_symlink():p.error('previous must be a symlink')
        temp=root/'.previous.next'
        temp.symlink_to(current.resolve());os.replace(temp,previous)
    temp=root/'.current.next';temp.symlink_to(release);os.replace(temp,current)
    print('Release link changed. Existing processes keep serving; switch proxy only after validation.')
if __name__=='__main__':main()
