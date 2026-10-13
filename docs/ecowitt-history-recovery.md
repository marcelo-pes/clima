# Ecowitt archive coverage and recovery

The production archive is collected by the existing VPS timer, not GitHub Actions.
The public archive endpoint remains blocked. Archived views must preserve missing
observations and must never interpolate readings.

## Completeness

`lib/weather-history-store.ts` merges imported checkpoints and checks the expected
sampling phase for every required sensor. An empty administrative interval between
checkpoints is not a missing observation when no sample is scheduled in that
interval. A missing sensor, missing/invalid sample, invalid checkpoint payload,
unknown cycle, or failed database read must remain incomplete.

The repository API uses exact epoch boundaries in cache keys and clips provider
spillover before checking coverage. The production API already uses these keys.
The source implementation is now versioned with the corrected reader.

## Daily archive

`scripts/ecowitt-history-sync.py` is deployed on the VPS as
`/opt/clima-antaisolar/scripts/ecowitt_history_sync.py`. It keeps the existing
exclusive lock, verified backup, pending-window tracking and daily timer. It
revisits three recent days and partial checkpoints from the last seven days.
This prevents small execution-time variations from permanently skipping a
previous day's still-incomplete aggregates. Older partial data at coarse source
resolution is not retried indefinitely.

Merging preserves existing valid numeric observations and original payload
members. Real numeric values can replace invalid markers, including a valid zero.
A later aggregate cannot replace an already valid, finer archived measurement.

The importer, coverage checker, statistics and gap-repair dependencies are
included because these operational scripts were deployed on the VPS but absent
from the default repository branch. Do not run the legacy importer concurrently
with the locked daily synchronizer.

## Real-source recovery

Preserve successful provider responses without authentication parameters as
`source-24h.json.gz`, `source-7d.json.gz`, `source-30d.json.gz` and
`source-1y.json.gz`. Each contains the exact window, fetch time, provider code and
unaltered data. Create a SHA-256 manifest. Queries of old coarse-resolution
history are diagnosis probes and must not be used to replace a fine archive.

Test on a separate database copy first:

```bash
python3 scripts/archive-revisit.test.py
python3 scripts/recovery-preservation.test.py BASELINE.sqlite EVIDENCE_DIR NEW_TEST.sqlite
node scripts/history-completeness.test.mjs NEW_TEST.sqlite --recovered
npx tsc --noEmit
npm run build
```

The recovery test checks idempotency, all preexisting observations and cycle
indexes, original checkpoint payload members, uniqueness and SQLite integrity.
The completeness regression cases distinguish full sample grids from genuine
upstream gaps. Recovery creates a checkpoint for a new tail so indexed readings
also become visible to archived API queries.

For the controlled production recovery, `scripts/recover-history.py` requires
the exact tested source hashes and a successful isolated preservation report.
It acquires the existing archive lock, prepares a fresh consistent backup,
checks SQLite integrity, compresses it and verifies the decompressed SHA-256
before any database recovery. It preserves the compressed backup, applies only
real source data, rebuilds affected statistics and verifies preservation again.
Only its own redundant temporary backup copy is removed after verification.

Requery unavailable recent aggregates later. If an observation remains absent
from the source, leave the gap and the warning. The source's coarser historical
resolution cannot reconstruct missing finer measurements.

The published frontend, credentials, shared database path, timer configuration
and public route block are outside the deployment scope of these corrections.
