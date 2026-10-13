import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import ts from 'typescript';

const paths = ['outdoor/temperature','outdoor/humidity','indoor/temperature','indoor/humidity','pressure/relative','wind/wind_speed','wind/wind_gust','wind/wind_direction','solar_and_uvi/solar','solar_and_uvi/uvi','rainfall_piezo/daily'];
const env = { WEATHER_HISTORY_READ_ONLY: 'true' };
globalThis.__historyTestEnv = env;
const source = readFileSync(new URL('../lib/weather-history-store.ts', import.meta.url), 'utf8')
  .replace('import { env } from "cloudflare:workers";', 'const env = globalThis.__historyTestEnv;');
const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const reader = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));

function dataset(times) {
  const data = {};
  for (const path of paths) {
    const [group, metric] = path.split('/');
    data[group] ??= {};
    data[group][metric] = { unit: 'test', list: Object.fromEntries(times.map(t => [t, '0'])) };
  }
  return data;
}
function database(db) {
  return { prepare(sql) {
    const statement = db.prepare(sql); let args = [];
    return { bind(...values) { args = values; return this; },
      async all() { return { results: statement.all(...args) }; },
      async first() { return statement.get(...args) ?? null; } };
  } };
}
for (const [cycle, step] of [['5min',300],['30min',1800],['4hour',14400],['1day',86400]]) {
  const data = dataset([step, step * 2, step * 3]);
  assert.equal(reader.hasHistoryCoverageGaps(data, cycle, step, step * 4 - 1), false);
  data.outdoor.temperature.list[step * 2] = '-';
  assert.equal(reader.hasHistoryCoverageGaps(data, cycle, step, step * 4 - 1), true);
  delete data.outdoor.temperature.list[step * 2];
  assert.equal(reader.hasHistoryCoverageGaps(data, cycle, step, step * 4 - 1), true);
  data.outdoor.temperature.list[step * 2] = '0';
  delete data.indoor.humidity;
  assert.equal(reader.hasHistoryCoverageGaps(data, cycle, step, step * 4 - 1), true);
}

const memory = new DatabaseSync(':memory:');
memory.exec('CREATE TABLE ecowitt_history_import_chunks(device_key TEXT,cycle_type TEXT,start_ts INTEGER,end_ts INTEGER,status TEXT,payload TEXT); CREATE TABLE weather_history(key TEXT,payload TEXT,updated_at INTEGER,expires_at INTEGER)');
const station = 'test-station';
const digest = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(station))).toString('hex');
const insert = memory.prepare('INSERT INTO ecowitt_history_import_chunks VALUES(?,?,?,?,?,?)');
insert.run(digest,'30min',0,1805,'complete',JSON.stringify(dataset([0,1800])));
insert.run(digest,'30min',3595,5400,'complete',JSON.stringify(dataset([3600,5400])));
env.DB = database(memory);
const key = station + '|30min|outdoor|0|5400';
assert.equal((await reader.readWeatherHistory(key,new Date(0),new Date(5400000))).incomplete,false,'A gap between checkpoints with no sample slot is not missing data');
memory.exec("UPDATE ecowitt_history_import_chunks SET payload='{bad json' WHERE start_ts=3595");
assert.equal((await reader.readWeatherHistory(key,new Date(0),new Date(5400000))).incomplete,true,'Malformed checkpoint must stay incomplete');
memory.close();

if (process.argv[2]) {
  const db = new DatabaseSync(process.argv[2], { readOnly: true });
  env.DB = database(db);
  const saved = db.prepare('SELECT key FROM weather_history LIMIT 1').get().key;
  const mac = saved.split('|')[0];
  const cases = [
    ['30min','2026-09-30T00:00:00-03:00','2026-10-06T23:59:59-03:00',false],
    ['4hour','2026-09-06T00:00:00-03:00','2026-10-05T23:59:59-03:00',false],
    ['5min','2026-10-12T00:00:00-03:00','2026-10-12T23:59:59-03:00',true],
  ];
  if (process.argv.includes('--recovered')) cases.push(['30min','2026-10-06T00:00:00-03:00','2026-10-12T23:59:59-03:00',false]);
  const compiled = [];
  if (process.env.HISTORY_COMPILED_DIR) {
    for (const [filename, first, last, read, gaps] of [
      ['route-BIEY6Myn.js','function A(','var L=', 'F','N'],
      ['route-DdgxE8W8.js','function w(','var j=', 'k','D'],
    ]) {
      const artifact = readFileSync(process.env.HISTORY_COMPILED_DIR + '/' + filename,'utf8');
      const start = artifact.indexOf(first), end = artifact.indexOf(last,start);
      assert(start >= 0 && end > start);
      const body = 'const e=globalThis.__historyTestEnv;' + artifact.slice(start,end) + `;export {${read} as readWeatherHistory,${gaps} as hasHistoryCoverageGaps};`;
      compiled.push(await import('data:text/javascript;base64,' + Buffer.from(body).toString('base64')));
    }
  }
  for (const [cycle,a,b,incomplete] of cases) {
    const start = new Date(a), end = new Date(b);
    const key = [mac,cycle,'test',Math.floor(start.getTime()/1000),Math.floor(end.getTime()/1000)].join('|');
    const actual = await reader.readWeatherHistory(key,start,end);
    assert(actual && actual.incomplete === incomplete, `${cycle} ${a}: ${actual?.incomplete}`);
    for (const module of compiled) {
      const result = await module.readWeatherHistory(key,start,end);
      assert.equal(result.incomplete,incomplete,'Compiled route must match tested source');
      assert.deepEqual(result.data,actual.data,'Compiled route data must match source exactly');
    }
    console.log(JSON.stringify({cycle,start:a,end:b,incomplete,compiled_modules_verified:compiled.length}));
  }
  db.close();
}
console.log('PASS: sample-aware completeness, genuine gaps, invalid payloads and missing sensors');
