import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = fileURLToPath(new URL('../', import.meta.url));
const temp = await mkdtemp(join(root, '.aviation-current-test-'));
try {
  const compilerOptions = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 };
  for (const [file, output] of [['lib/sun-time.ts','sun-time.mjs'],['lib/weather-condition.ts','weather-condition.mjs'],['lib/aviation-current.ts','aviation-current.mjs'],['lib/climatempo-current.ts','climatempo-current.mjs'],['lib/current-weather.ts','current-weather.mjs']]) {
    let source = await readFile(join(root,file),'utf8');
    source = source.replaceAll('"./sun-time"','"./sun-time.mjs"').replaceAll('"./climatempo-current"','"./climatempo-current.mjs"').replaceAll('"./aviation-current"','"./aviation-current.mjs"').replaceAll('"./weather-condition"','"./weather-condition.mjs"');
    await (await import('node:fs/promises')).writeFile(join(temp,output),ts.transpileModule(source,{compilerOptions}).outputText);
  }
  const { parseAviationCurrent } = await import(join(temp,'aviation-current.mjs'));
  const { currentConditionPresentation } = await import(join(temp,'weather-condition.mjs'));
  const { selectCurrentWeather } = await import(join(temp,'current-weather.mjs'));
  const now = Date.parse('2026-10-07T01:17:00Z');
  const report = {icaoId:'SBBU',reportTime:'2026-10-07T01:00:00.000Z',rawOb:'METAR SBBU 070100Z 10002KT 9999 SCT005 BKN070 OVC080 22/22 Q1017',cover:'OVC',clouds:[{cover:'SCT'},{cover:'BKN'},{cover:'OVC'}],temp:22};
  const metar = parseAviationCurrent([report],now);
  assert.equal(metar.source,'NOAA Aviation Weather Center · METAR SBBU');
  assert.equal(metar.observedAt,'2026-10-07T01:00:00.000Z');
  assert.equal(metar.code,'cloudy');
  assert.equal(metar.temperature,22);
  assert.equal(parseAviationCurrent([{...report,icaoId:'SBGR'}],now),null,'another airport is never treated as Bauru');
  assert.equal(parseAviationCurrent([{...report,reportTime:'not a date'}],now),null,'invalid observation time is rejected');
  assert.equal(parseAviationCurrent([{...report,rawOb:'METAR SBBU 070100Z 10002KT 9999 22/22 Q1017',cover:null,clouds:[]}],now),null,'no sky report stays unavailable');
  const stale = parseAviationCurrent([report],Date.parse('2026-10-07T03:00:00Z'));
  assert.equal(currentConditionPresentation(stale,Date.parse('2026-10-07T03:00:00Z')).status,'stale');
  assert.equal(currentConditionPresentation(stale,Date.parse('2026-10-07T03:00:00Z')).photo,null);
  const night = currentConditionPresentation(metar,now,-22.345,-49.054);
  assert.equal(night.period,'night');
  assert.equal(night.photo,'/weather-cloudy-night.webp');
  const dayNow = Date.parse('2026-10-07T15:17:00Z');
  const dayReport = parseAviationCurrent([{...report,reportTime:'2026-10-07T15:00:00.000Z',cover:'SCT',clouds:[{cover:'SCT'}]}],dayNow);
  const day = currentConditionPresentation(dayReport,dayNow,-22.345,-49.054);
  assert.equal(day.period,'day');
  assert.equal(day.photo,'/weather-partial-day.webp');
  const oldClimatempo = {kind:'current',source:'Climatempo',cityId:406,localeId:6655,code:'5n',sourceCondition:'Chuvoso',observedAt:'2026-10-06T00:44:00.000Z',fetchedAt:new Date(now).toISOString(),sourceDate:'06/10/2026',sourceTime:'00:44:00',sourceTimeZone:'UTC',temperature:21,apparentTemperature:22};
  assert.equal(selectCurrentWeather(oldClimatempo,metar,now),metar,'fresh SBBU observation replaces stale Climatempo condition without changing its timestamp');
  assert.equal(selectCurrentWeather(oldClimatempo,null,now),oldClimatempo,'when every feed is stale, retain the timestamp for a stale warning');
  assert.equal(selectCurrentWeather(null,null,now),null,'no valid source remains unavailable');
  const rain = parseAviationCurrent([{...report,rawOb:'METAR SBBU 070100Z 10002KT 3000 TSRA BKN010 22/22 Q1017',wxString:'TSRA',cover:'BKN'}],now);
  assert.equal(rain.code,'storm','METAR thunderstorm code is classified from present-weather tokens');
  console.log('PASS: SBBU source identity, observed timestamp, cloud/precipitation mapping, freshness fallback, and safe unknown/stale behavior');
} finally { await rm(temp,{recursive:true,force:true}); }
