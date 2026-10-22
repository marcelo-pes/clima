#!/usr/bin/python3
import getpass
import os
import pwd
import re
import subprocess
import sys
import tempfile
from pathlib import Path

secret_file = Path('/root/CLIMA/Clima/app/.dev.vars')
if os.geteuid() != 0:
    print('Run this setup with sudo so the app and timer can be restarted safely.')
    sys.exit(2)
if not sys.stdin.isatty():
    print('Run this setup from an interactive SSH terminal; secret input must be hidden.')
    sys.exit(2)
application_key = getpass.getpass('Ecowitt Application Key (hidden): ').strip()
api_key = getpass.getpass('Ecowitt API Key (hidden): ').strip()
if not application_key or not api_key or any(c.isspace() for c in application_key + api_key):
    print('Ecowitt keys are missing or contain whitespace; no file was changed.')
    sys.exit(2)

values = {}
if secret_file.exists():
    for line in secret_file.read_text().splitlines():
        if '=' in line and not line.lstrip().startswith('#'):
            key, value = line.split('=', 1)
            values[key] = value.strip().strip('"').strip("'")
values['ECOWITT_APPLICATION_KEY'] = application_key
values['ECOWITT_API_KEY'] = api_key
if not re.fullmatch(r'[0-9a-fA-F]{64}', values.get('ECOWITT_LOCAL_ARCHIVE_TOKEN', '')):
    print('Local archive token is missing or invalid; no file was changed.')
    sys.exit(2)
if not re.fullmatch(r'[A-Za-z0-9._-]+', application_key) or not re.fullmatch(r'[A-Za-z0-9._-]+', api_key):
    print('Unexpected key format; no file was changed.')
    sys.exit(2)

clima = pwd.getpwnam('clima')
body = ''.join(f'{key}={value}\n' for key, value in values.items())
fd, temp_name = tempfile.mkstemp(prefix='.dev.vars.', dir=secret_file.parent)
try:
    os.fchmod(fd, 0o600)
    os.fchown(fd, clima.pw_uid, clima.pw_gid)
    with os.fdopen(fd, 'w') as stream:
        stream.write(body)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temp_name, secret_file)
except Exception:
    try: os.unlink(temp_name)
    except FileNotFoundError: pass
    raise

restart = subprocess.run(['systemctl', 'restart', 'clima-antaisolar.service'], check=False)
if restart.returncode != 0:
    print('Secrets saved securely, but the local app did not restart; archive timer remains disabled.')
    sys.exit(restart.returncode)
archive = subprocess.run(['systemctl', 'start', 'clima-antaisolar-archive.service'], check=False)
if archive.returncode != 0:
    print('Secrets saved securely; live Ecowitt archive check failed and the timer remains disabled. Review service logs.')
    sys.exit(archive.returncode)
timer = subprocess.run(['systemctl', 'enable', '--now', 'clima-antaisolar-archive.timer'], check=False)
if timer.returncode != 0:
    print('Live archive succeeded, but the 23:59 Bauru timer could not be enabled.')
    sys.exit(timer.returncode)
print('Credentials saved with mode 0600; a live local archive succeeded and the 23:59 Bauru timer is active.')
