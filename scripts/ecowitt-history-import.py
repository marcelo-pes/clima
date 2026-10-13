#!/usr/bin/env python3
"""Resumable local Ecowitt backfill. Logs counts and dates only."""
import datetime as dt
import glob
import hashlib
import json
import os
import sqlite3
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

UTC = dt.timezone.utc
BAURU = dt.timezone(dt.timedelta(hours=-3))
APP = Path("/opt/clima-antaisolar/app")
VARS = APP / ".dev.vars"
BACKUP = Path("/opt/clima-antaisolar/backups/ecowitt-before-full-load-20260924T231338Z.sqlite")
API = "https://api.ecowitt.net/api/v3"
CALLBACKS = "outdoor,indoor,pressure,wind,solar_and_uvi,rainfall,rainfall_piezo,lightning,battery"
UNITS = {"temp_unitid": "1", "pressure_unitid": "3", "wind_speed_unitid": "7", "rainfall_unitid": "12", "solar_irradiance_unitid": "16"}
CYCLES = {"5min": 86400, "30min": 7 * 86400, "4hour": 30 * 86400, "1day": 365 * 86400}
PRIORITY = {"1day": 1, "4hour": 2, "30min": 3, "5min": 4}
START = int(dt.datetime(2025, 5, 12, 0, 0, tzinfo=BAURU).timestamp())


def read_vars():
    values = {}
    for line in VARS.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            name, value = line.split("=", 1)
            values[name.strip()] = value.strip().strip("\"'")
    return values


def request_api(path, params):
    request = urllib.request.Request(API + path + "?" + urllib.parse.urlencode(params), headers={"Accept": "application/json"})
    for attempt in range(5):
        try:
            with urllib.request.urlopen(request, timeout=25) as response:
                body = response.read()
            result = json.loads(body)
            code = str(result.get("code", "unknown"))
            if code != "0":
                if code == "-1" and attempt < 4:
                    time.sleep(60 * (attempt + 1))
                    continue
                raise RuntimeError("API_CODE_" + code)
            return result
        except urllib.error.HTTPError as error:
            if error.code not in (429, 500, 502, 503, 504) or attempt == 4:
                raise RuntimeError("HTTP_" + str(error.code)) from None
            time.sleep(min(60, 2 ** (attempt + 1)))
        except urllib.error.URLError:
            if attempt == 4:
                raise RuntimeError("NETWORK_ERROR") from None
            time.sleep(min(30, 2 ** (attempt + 1)))
    raise RuntimeError("REQUEST_FAILED")


def find_devices(node, result):
    if isinstance(node, dict):
        if any(k in node for k in ("mac", "mac_address")) and any(k in node for k in ("id", "device_id")):
            result.append(node)
        for value in node.values():
            find_devices(value, result)
    elif isinstance(node, list):
        for value in node:
            find_devices(value, result)


def iter_series(node, path=()):
    if isinstance(node, dict):
        series = node.get("list")
        if isinstance(series, dict):
            metric = "/".join(path) or "root"
            unit = str(node.get("unit", ""))
            for timestamp, value in series.items():
                try:
                    yield metric, int(timestamp), str(value), unit
                except (ValueError, TypeError):
                    pass
        for name, value in node.items():
            if name not in ("list", "value", "unit", "time"):
                yield from iter_series(value, path + (str(name),))
    elif isinstance(node, list):
        for index, value in enumerate(node):
            yield from iter_series(value, path + (str(index),))


def selected_db():
    for path in glob.glob("/opt/clima-antaisolar/database/**/*.sqlite", recursive=True):
        try:
            connection = sqlite3.connect("file:" + path + "?mode=ro", uri=True, timeout=2)
            found = connection.execute("SELECT 1 FROM sqlite_master WHERE type=? AND name=?", ("table", "weather_history")).fetchone()
            connection.close()
            if found:
                return path
        except sqlite3.Error:
            pass
    raise RuntimeError("LOCAL_DATABASE_NOT_FOUND")


def iso(timestamp):
    return dt.datetime.fromtimestamp(timestamp, UTC).astimezone(BAURU).isoformat(timespec="seconds") if timestamp is not None else "none"


def schema(connection):
    connection.executescript("""
    CREATE TABLE IF NOT EXISTS ecowitt_history_points(
      device_key TEXT NOT NULL, metric_path TEXT NOT NULL, observed_at INTEGER NOT NULL,
      value TEXT NOT NULL, unit TEXT NOT NULL, cycle_type TEXT NOT NULL, priority INTEGER NOT NULL,
      PRIMARY KEY(device_key, metric_path, observed_at));
    CREATE TABLE IF NOT EXISTS ecowitt_history_cycle_points(
      device_key TEXT NOT NULL, cycle_type TEXT NOT NULL, metric_path TEXT NOT NULL, observed_at INTEGER NOT NULL,
      PRIMARY KEY(device_key, cycle_type, metric_path, observed_at));
    CREATE TABLE IF NOT EXISTS ecowitt_history_import_chunks(
      device_key TEXT NOT NULL, cycle_type TEXT NOT NULL, start_ts INTEGER NOT NULL, end_ts INTEGER NOT NULL,
      status TEXT NOT NULL, api_points INTEGER NOT NULL DEFAULT 0, payload TEXT,
      PRIMARY KEY(device_key, cycle_type, start_ts, end_ts));
    CREATE TABLE IF NOT EXISTS ecowitt_history_import_meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
    """)


def merge_point(connection, device_key, cycle, metric, timestamp, value, unit):
    connection.execute("INSERT OR IGNORE INTO ecowitt_history_cycle_points VALUES(?,?,?,?)", (device_key, cycle, metric, timestamp))
    connection.execute("""INSERT INTO ecowitt_history_points VALUES(?,?,?,?,?,?,?)
      ON CONFLICT(device_key,metric_path,observed_at) DO UPDATE SET value=excluded.value,unit=excluded.unit,cycle_type=excluded.cycle_type,priority=excluded.priority
      WHERE excluded.priority>ecowitt_history_points.priority""", (device_key, metric, timestamp, value, unit, cycle, PRIORITY[cycle]))


def main():
    probe = "--probe" in sys.argv[1:]
    if not BACKUP.is_file():
        raise RuntimeError("PREIMPORT_BACKUP_MISSING")
    values = read_vars()
    application_key, api_key = values.get("ECOWITT_APPLICATION_KEY"), values.get("ECOWITT_API_KEY")
    if not application_key or not api_key:
        raise RuntimeError("ECOWITT_CREDENTIALS_MISSING")
    app_id = values.get("ECOWITT_DEVICE_ID", "251816")
    auth = {"application_key": application_key, "api_key": api_key}
    devices = []
    find_devices(request_api("/device/list", auth).get("data"), devices)
    selected = next((d for d in devices if str(d.get("id", d.get("device_id", ""))) == str(app_id)), None)
    if selected is None:
        raise RuntimeError("APPLICATION_DEVICE_NOT_FOUND_IN_ECOWITT_ACCOUNT")
    mac = selected.get("mac", selected.get("mac_address"))
    if not mac:
        raise RuntimeError("APPLICATION_DEVICE_ADDRESS_MISSING")
    device_key = hashlib.sha256(str(mac).encode()).hexdigest()

    db = selected_db()
    connection = sqlite3.connect(db, timeout=60)
    connection.execute("PRAGMA busy_timeout=60000")
    connection.execute("PRAGMA journal_mode=WAL")
    current_cache = connection.execute("SELECT count(*) FROM weather_history").fetchone()[0]
    cache_timestamps = []
    for raw, in connection.execute("SELECT payload FROM weather_history"):
        try:
            cache_timestamps.extend(stamp for _, stamp, _, _ in iter_series(json.loads(raw)))
        except (ValueError, TypeError):
            pass
    backup = sqlite3.connect("file:" + str(BACKUP) + "?mode=ro", uri=True)
    backup_cache = backup.execute("SELECT count(*) FROM weather_history").fetchone()[0]
    backup.close()
    if backup_cache != 5 or current_cache != 5:
        raise RuntimeError("EXPECTED_FIVE_CACHE_ROWS_OR_BACKUP_MISMATCH")
    print("BACKUP_CACHE_ROWS", backup_cache, "BEFORE_CACHE_ROWS", current_cache,
          "BEFORE_MIN", iso(min(cache_timestamps)) if cache_timestamps else "none",
          "BEFORE_MAX", iso(max(cache_timestamps)) if cache_timestamps else "none", flush=True)
    print("STATION_MATCHES_APPLICATION", "yes", flush=True)

    schema(connection)
    # Seed five existing cache records into the unique point index; original rows remain untouched.
    for key, raw in connection.execute("SELECT key,payload FROM weather_history").fetchall():
        parts = key.split("|")
        if len(parts) < 2 or parts[0] != mac or parts[1] not in PRIORITY:
            continue
        try:
            for metric, stamp, value, unit in iter_series(json.loads(raw)):
                merge_point(connection, device_key, parts[1], metric, stamp, value, unit)
        except (ValueError, TypeError):
            pass
    connection.commit()

    if probe:
        cycle = "5min"
        start = START
        end = start + CYCLES[cycle] - 1
        period = (start, end)
        existing = connection.execute("SELECT 1 FROM ecowitt_history_import_chunks WHERE device_key=? AND cycle_type=? AND start_ts=? AND end_ts=?", (device_key, cycle, *period)).fetchone()
        if existing:
            print("PROBE_ALREADY_CHECKPOINTED", cycle, iso(start), iso(end), flush=True)
        else:
            payload = request_api("/device/history", {**auth, "mac": mac,
                "start_date": dt.datetime.fromtimestamp(start, UTC).strftime("%Y-%m-%d %H:%M:%S"),
                "end_date": dt.datetime.fromtimestamp(end, UTC).strftime("%Y-%m-%d %H:%M:%S"),
                "cycle_type": cycle, "call_back": CALLBACKS, **UNITS})
            data = payload.get("data") or {}
            points = [(m, t, v, u) for m, t, v, u in iter_series(data) if start <= t <= end]
            with connection:
                for metric, stamp, value, unit in points:
                    merge_point(connection, device_key, cycle, metric, stamp, value, unit)
                connection.execute("INSERT INTO ecowitt_history_import_chunks VALUES(?,?,?,?,?,?,?)", (device_key, cycle, start, end, "complete" if points else "empty", len(points), json.dumps(data, separators=(",", ":"))))
        print("PROBE_WRITTEN", cycle, iso(start), iso(end), "points", len(points) if not existing else 0, flush=True)
        connection.close()
        return 0

    # This annual boundary check documents why the initial range starts at the oldest known observation.
    prior = request_api("/device/history", {**auth, "mac": mac,
        "start_date": "2024-01-01 03:00:00", "end_date": "2025-01-01 02:59:59",
        "cycle_type": "1day", "call_back": CALLBACKS, **UNITS}).get("data") or {}
    prior_count = sum(1 for _ in iter_series(prior))
    print("OLDER_YEAR_2024_API_POINTS", prior_count, flush=True)
    end_ts = int(time.time())
    fixed_end = connection.execute("SELECT value FROM ecowitt_history_import_meta WHERE key='fixed_end_ts'").fetchone()
    if fixed_end:
        end_ts = int(fixed_end[0])
    else:
        connection.execute("INSERT INTO ecowitt_history_import_meta VALUES('fixed_end_ts',?)", (str(end_ts),))
        connection.commit()

    for cycle, span in CYCLES.items():
        cursor = START
        completed_points = 0
        queried = 0
        while cursor <= end_ts:
            end = min(cursor + span - 1, end_ts)
            already = connection.execute("SELECT 1 FROM ecowitt_history_import_chunks WHERE device_key=? AND cycle_type=? AND start_ts=? AND end_ts=?", (device_key, cycle, cursor, end)).fetchone()
            if already:
                cursor = end + 1
                continue
            params = {**auth, "mac": mac,
                "start_date": dt.datetime.fromtimestamp(cursor, UTC).strftime("%Y-%m-%d %H:%M:%S"),
                "end_date": dt.datetime.fromtimestamp(end, UTC).strftime("%Y-%m-%d %H:%M:%S"),
                "cycle_type": cycle, "call_back": CALLBACKS, **UNITS}
            try:
                result = request_api("/device/history", params)
            except Exception as error:
                print("IMPORT_STOPPED", cycle, "period", iso(cursor), iso(end), "reason", str(error), flush=True)
                connection.close()
                return 2
            data = result.get("data") or {}
            points = [(m, t, v, u) for m, t, v, u in iter_series(data) if cursor <= t <= end]
            with connection:
                for metric, stamp, value, unit in points:
                    merge_point(connection, device_key, cycle, metric, stamp, value, unit)
                connection.execute("INSERT INTO ecowitt_history_import_chunks VALUES(?,?,?,?,?,?,?)", (device_key, cycle, cursor, end, "complete" if points else "empty", len(points), json.dumps(data, separators=(",", ":"))))
            completed_points += len(points)
            queried += 1
            if queried % 20 == 0:
                print("PROGRESS", cycle, "chunks", queried, "api_points", completed_points, "period_end", iso(end), flush=True)
            cursor = end + 1
            time.sleep(3.1)
        count = connection.execute("SELECT count(*) FROM ecowitt_history_cycle_points WHERE device_key=? AND cycle_type=?", (device_key, cycle)).fetchone()[0]
        print("CYCLE_DONE", cycle, "unique_cycle_points", count, "new_chunks", queried, flush=True)

    print("CYCLE_POINT_TOTALS")
    for cycle in CYCLES:
        count = connection.execute("SELECT count(*) FROM ecowitt_history_cycle_points WHERE device_key=? AND cycle_type=?", (device_key, cycle)).fetchone()[0]
        print(cycle, count)
    count, low, high = connection.execute("SELECT count(*),min(observed_at),max(observed_at) FROM ecowitt_history_points WHERE device_key=?", (device_key,)).fetchone()
    print("DEDUPLICATED_POINT_TOTAL", count, "POINT_MIN", iso(low), "POINT_MAX", iso(high))
    print("EMPTY_CHUNK_COUNTS")
    for cycle in CYCLES:
        empties = connection.execute("SELECT count(*) FROM ecowitt_history_import_chunks WHERE device_key=? AND cycle_type=? AND status='empty'", (device_key, cycle)).fetchone()[0]
        print(cycle, empties)
        rows = connection.execute("SELECT start_ts,end_ts FROM ecowitt_history_import_chunks WHERE device_key=? AND cycle_type=? AND status='empty' ORDER BY start_ts", (device_key, cycle)).fetchall()
        for start, end in rows:
            print("EMPTY_PERIOD", cycle, iso(start), iso(end))
    print("AFTER_CACHE_ROWS", connection.execute("SELECT count(*) FROM weather_history").fetchone()[0])
    connection.close()
    print("TIMER_AND_SERVICE", os.popen("systemctl is-active clima-antaisolar.service clima-antaisolar-archive.timer").read().strip().replace("\n", " "))
    print("TIMER_ENABLED", os.popen("systemctl is-enabled clima-antaisolar-archive.timer").read().strip())
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main() or 0)
    except Exception as error:
        print("IMPORT_FAILED", type(error).__name__, str(error) if str(error).isupper() and len(str(error)) < 80 else "details-withheld", flush=True)
        sys.exit(1)
