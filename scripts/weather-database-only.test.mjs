import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ts from 'typescript';
const root = new URL('../', import.meta.url);
const dir = await mkdtemp(join(tmpdir(), 'clima-db-test-'));
try {
  await writeFile(join(dir, 'env.mjs'), 'export const env = {};');
  const files = {
    'route.mjs': 'app/api/weather/route.ts',
    'store.mjs': 'lib/weather-history-store.ts',
    'window.mjs': 'lib/weather-history-window.ts',
    'rules.mjs': 'lib/weather-rules.ts',
    'statistics.mjs': 'lib/weather-statistics.ts',
    'lightning.mjs': 'lib/lightning-totals.ts',
    'chart-extrema.mjs':'lib/chart-extrema.ts',
    'weather-chart-extrema.mjs':'lib/weather-chart-extrema.ts',
    'climatempo-current.mjs':'lib/climatempo-current.ts',
    'aviation-current.mjs':'lib/aviation-current.ts',
    'current-weather.mjs':'lib/current-weather.ts',
  };
  for (const [name, path] of Object.entries(files)) {
    let source = await readFile(new URL(path, root), 'utf8');
    source = source.replaceAll('"cloudflare:workers"', '"./env.mjs"')
      .replaceAll('"@/lib/weather-history-store"', '"./store.mjs"')
      .replaceAll('"@/lib/weather-history-window"', '"./window.mjs"')
      .replaceAll('"@/lib/weather-rules"', '"./rules.mjs"')
      .replaceAll('"@/lib/weather-statistics"', '"./statistics.mjs"')
      .replaceAll('"@/lib/lightning-totals"', '"./lightning.mjs"')
      .replaceAll('"@/lib/weather-chart-extrema"', '"./weather-chart-extrema.mjs"')
      .replaceAll('"@/lib/climatempo-current"', '"./climatempo-current.mjs"')
      .replaceAll('"@/lib/current-weather"', '"./current-weather.mjs"')
      .replaceAll('"./climatempo-current"', '"./climatempo-current.mjs"')
      .replaceAll('"./aviation-current"', '"./aviation-current.mjs"')
      .replaceAll('"./weather-condition"', '"./weather-condition.mjs"')
      .replaceAll('"@/lib/chart-extrema"', '"./chart-extrema.mjs"')
      .replaceAll("'./chart-extrema'", "'./chart-extrema.mjs'")
      .replaceAll("'cloudflare:workers'", "'./env.mjs'");
    await writeFile(join(dir, name), ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText);
  }
  const { env } = await import(join(dir, 'env.mjs'));
  const { GET } = await import(join(dir, 'route.mjs'));
  let requests = 0;
  globalThis.fetch = async () => { requests++; throw new Error('External request forbidden by test'); };
  let gap = false;
  env.DB = { prepare(sql) {
    let bindings;
    return { bind(...args) { bindings = args; return this; },
      async first() { return null; },
      async all() {
        if (sql.startsWith("SELECT metric_path")) return {results: []};
        if (sql === 'SELECT key FROM weather_history') return { results: [{ key: 'saved-station|5min|sensors|0|1' }] };
        const [, , , start, end] = bindings;
        return { results: [{ start_ts: start + (gap ? 3600 : 0), end_ts: end,
          payload: JSON.stringify({ outdoor: { temperature: { unit: 'C', list: { [start + 3600]: '20' } } } }) }] };
      } };
  } };
  for (const range of ['7d', '30d', '1y']) {
    for (const view of ['history', 'current', 'solar']) {
      const response = await GET(new Request(`http://localhost/api/weather?range=${range}&date=2026-09-24&view=${view}`));
      assert.equal(response.status, 200, `${range}/${view}`);
      const data = await response.json();
      assert.equal(data.historyIncomplete, true, "A populated checkpoint with one observation is incomplete");
      if (view !== 'solar') assert.equal(data.historySource, 'database');
      assert.equal(requests, 0, 'Archived views must not call Ecowitt, even without credentials or configured MAC');
    }
  }
  gap = true;
  const partial = await GET(new Request('http://localhost/api/weather?range=7d&date=2026-09-24&view=history'));
  assert.equal((await partial.json()).historyIncomplete, true, 'A coverage gap must be reported');
  gap = false;
  const closed = await GET(new Request('http://localhost/api/weather?range=24h&date=2026-09-24&view=current'));
  assert.equal(closed.status, 200);
  assert.equal(requests, 0);
  env.ECOWITT_MAC = 'saved-station'; env.ECOWITT_APPLICATION_KEY = 'test'; env.ECOWITT_API_KEY = 'test';
  globalThis.fetch = async () => { requests++; return Response.json({ code: 0, data: {} }); };
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  await GET(new Request(`http://localhost/api/weather?range=24h&date=${today}&view=history`));
  assert.ok(requests > 0, 'Today must continue to request current API data');
  requests = 0;
  await GET(new Request(`http://localhost/api/weather?range=24h&date=${today}&view=current`));
  assert.ok(requests <= 2, 'Current dashboard must request only live readings and current daily history; aggregates come from SQLite');
  requests = 0;
  await GET(new Request('http://localhost/api/weather?range=7d&date=2026-09-24&view=history&source=api'));
  assert.ok(requests > 0, 'Explicit /confere API comparison must remain available');
  console.log('PASS: archived views use only SQLite; gaps reported; today and explicit API comparisons preserved');
  requests = 0;
  const observedAt = new Date(Date.now() - 60_000);
  const currentDate = observedAt.toLocaleDateString('en-GB', { timeZone: 'UTC' });
  const currentTime = observedAt.toLocaleTimeString('en-GB', { timeZone: 'UTC', hour12: false });
  globalThis.fetch = async (input, options) => {
    requests++;
    if (String(input).includes('aviationweather.gov')) {
      return Response.json([{icaoId:'SBBU',reportTime:new Date(Date.now()-30_000).toISOString(),rawOb:'METAR SBBU 070100Z 10002KT 9999 SCT020 22/18 Q1017',cover:'SCT',clouds:[{cover:'SCT'}],temp:22}]);
    }
    assert.equal(String(input), 'https://www.climatempo.com.br/json/myclimatempo/user/weatherNow?idlocale=6655');
    assert.equal(options.method, 'POST');
    return Response.json({ status_code: 200, data: { getWeatherNow: [{ data: [{ locale: { idlocale: 6655, idcity: 406, city: 'Bauru' }, weather: { id: 6655, name: 'Bauru', date: currentDate, dateUpdate: currentTime, condition: 'Nublado', icon: '3', temperature: 23, sensation: 24 } }] }] } });
  };
  const extras = await GET(new Request('http://localhost/api/weather?view=extras'));
  const extrasData = await extras.json();
  assert.equal(extras.status, 200);
  assert.equal(extrasData.currentWeather.code, '3');
  assert.equal(extrasData.currentWeather.sourceCondition, 'Nublado');
  assert.equal(requests, 2, 'Current-condition refresh queries only Climatempo Now and the NOAA METAR fallback; it does not request Ecowitt');
  console.log('PASS: current-condition endpoint selects fresh Climatempo over the independent METAR fallback and does not request Ecowitt');
} finally { await rm(dir, { recursive: true, force: true }); }
