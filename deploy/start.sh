#!/bin/sh
set -eu
: "${CLIMA_SQLITE_PATH:?Set the persistent database path}"
: "${CLIMA_SECRETS_FILE:?Set the external secrets file}"
: "${CLIMA_CAMERA_CACHE_DIR:?Set the persistent camera cache}"
cd "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
exec ./node/bin/node --max-old-space-size=160 --import ./runtime/register-loader.mjs ./runtime/server.mjs
