import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = fileURLToPath(new URL('../', import.meta.url));
const temp = await mkdtemp(join(root, '.climatempo-test-'));
const compilerOptions = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 };
try {
  for (const [file, output] of [['lib/sun-time.ts', 'sun-time.mjs'], ['lib/weather-condition.ts', 'weather-condition.mjs'], ['lib/climatempo-current.ts', 'climatempo-current.mjs']]) {
    let source = await readFile(join(root, file), 'utf8');
    source = source.replaceAll('"./sun-time"', '"./sun-time.mjs"');
    const js = ts.transpileModule(source, { compilerOptions }).outputText;
    await (await import('node:fs/promises')).writeFile(join(temp, output), js);
  }
  const provider = await import(join(temp, 'climatempo-current.mjs'));
  const visual = await import(join(temp, 'weather-condition.mjs'));
  const now = Date.UTC(2026, 9, 6, 16, 30);
  const payload = (icon, condition, time = '16:28:00', locale = 6655, date = '06/10/2026') => ({
    status_code: 200,
    data: { getWeatherNow: [
      { data: [{ locale: { idcity: 999, idlocale: 1 }, weather: { id: 1, name: 'Nearby', icon: '1', condition: 'Sol' } }] },
      { data: [{ locale: { idcity: 406, idlocale: locale }, weather: { id: locale, name: 'Bauru', date, dateUpdate: time, temperature: 23, sensation: 24, condition, icon } }] },
    ] },
  });

  const current = provider.parseClimatempoCurrent(payload('3', 'Nublado'), now);
  assert.equal(current.cityId, 406);
  assert.equal(current.localeId, 6655);
  assert.equal(current.code, '3');
  assert.equal(current.sourceCondition, 'Nublado');
  assert.equal(current.observedAt, '2026-10-06T16:28:00.000Z');
  assert.equal(current.sourceTimeZone, 'UTC');
  assert.equal(new Date(current.observedAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }), '06/10, 13:28');
  assert.equal(provider.parseClimatempoCurrent(payload('3', 'Nublado', '16:28:00', 1)), null, 'Do not accept another locale or nearby city');
  assert.equal(provider.parseClimatempoCurrent({ status_code: 200, data: { getWeatherNow: [null, { data: 'malformed' }] } }), null, 'Malformed source payloads fail safely');
  assert.equal(provider.parseClimatempoCurrent(payload('3', 'Nublado', '31:99:00')).observedAt, null, 'Invalid source time is retained as unavailable, never replaced with fetch time');

  const cases = [
    ['1', 'Sol', 'clear', 'sun', 'weather-clear-day.webp', false],
    ['1n', 'Noite sem nuvens', 'clear', 'moon', 'weather-clear-night.webp', true],
    ['2', 'Sol com algumas nuvens', 'partial', 'cloud-sun', 'weather-partial-day.webp', false],
    ['2n', 'Noite com algumas nuvens', 'partial', 'cloud-moon', 'weather-partial-night.webp', true],
    ['2r', 'Sol com muitas nuvens', 'partial', 'cloud-sun', 'weather-partial-day.webp', false],
    ['2rn', 'Noite com muitas nuvens', 'partial', 'cloud-moon', 'weather-partial-night.webp', true],
    ['3', 'Nublado', 'cloudy', 'cloud', 'weather-cloudy-day.webp', false],
    ['3n', 'Nublado', 'cloudy', 'cloud', 'weather-cloudy-night.webp', true],
    ['4', 'Sol e chuva', 'rain', 'rain', 'weather-rain-day.webp', false],
    ['4r', 'Sol com muitas nuvens e chuva', 'rain', 'rain', 'weather-rain-day.webp', false],
    ['4n', 'Noite chuvosa', 'rain', 'rain', 'weather-rain-night.webp', true],
    ['4rn', 'Noite nublada e chuvosa', 'rain', 'rain', 'weather-rain-night.webp', true],
    ['4tn', 'Pancadas de chuva durante a noite', 'rain', 'rain', 'weather-rain-night.webp', true],
    ['4t', 'Sol entre nuvens e pancadas de chuva, com trovoadas', 'storm', 'storm', 'weather-storm-day.webp', false],
    ['5', 'Chuvoso', 'rain', 'rain', 'weather-rain-day.webp', false],
    ['5n', 'Chuvoso', 'rain', 'rain', 'weather-rain-night.webp', true],
    ['6', 'Chuva e trovoadas', 'storm', 'storm', 'weather-storm-day.webp', false],
    ['6n', 'Chuva e trovoadas', 'storm', 'storm', 'weather-storm-night.webp', true],
    ['9', 'Nevoeiro', 'fog', 'fog', 'weather-fog-day.webp', false],
  ];
  const nightNow = Date.UTC(2026, 9, 6, 3);
  for (const [code, condition, key, icon, photo, night] of cases) {
    const instant = night ? nightNow : now;
    const observed = new Date(instant - 120_000);
    const date = observed.toLocaleDateString('en-GB', { timeZone:'UTC', day:'2-digit', month:'2-digit', year:'numeric' });
    const time = observed.toLocaleTimeString('en-GB', { timeZone:'UTC', hour12:false });
    const record = provider.parseClimatempoCurrent(payload(code, condition, time, 6655, date), instant);
    const result = visual.currentConditionPresentation(record, instant);
    assert.equal(result.key, key, `${code} key`);
    assert.equal(result.icon, icon, `${code} icon`);
    assert.equal(result.photo, `/${photo}`, `${code} ${night ? 'night' : 'day'} photo`);
  }
  const observedNight = new Date(nightNow - 120_000);
  const nightDate = observedNight.toLocaleDateString('en-GB', { timeZone:'UTC', day:'2-digit', month:'2-digit', year:'numeric' });
  const nightTime = observedNight.toLocaleTimeString('en-GB', { timeZone:'UTC', hour12:false });
  assert.equal(visual.currentConditionPresentation(provider.parseClimatempoCurrent(payload('2', 'Sol com algumas nuvens', nightTime, 6655, nightDate), now), nightNow).icon, 'cloud-moon');

  for (const code of ['7', '7n', '8', '9n', '3tm', 'unknown']) {
    const result = visual.currentConditionPresentation(provider.parseClimatempoCurrent(payload(code, 'Condição sem mapeamento'), now), now);
    assert.equal(result.key, 'unknown', `${code} must stay unmapped rather than invent a category`);
    assert.equal(result.photo, null);
    assert.equal(result.status, 'unknown');
  }
  const mismatch = visual.currentConditionPresentation(provider.parseClimatempoCurrent(payload('3', 'Ensolarado'), now), now);
  assert.equal(mismatch.status, 'unknown', 'Condition text that conflicts with the official icon code stays neutral');
  const stale = visual.currentConditionPresentation(provider.parseClimatempoCurrent(payload('3', 'Nublado', '14:00:00'), now), now);
  assert.equal(stale.status, 'stale');
  assert.equal(stale.photo, null);
  assert.equal(visual.currentConditionPresentation({ ...current, refreshFailed: true }, now).label, 'Falha ao atualizar · dados desatualizados');
  assert.equal(visual.currentConditionPresentation({ ...current, observedAt: null }, now).photo, null);
  assert.equal(visual.currentConditionPresentation(null, now).photo, null);

  let clock = now;
  let requests = 0;
  let fail = false;
  let sourceTime = '16:28:00';
  const loader = provider.createClimatempoCurrentLoader(async (url, options) => {
    requests++;
    assert.equal(url, provider.CLIMATEMPO_CURRENT_URL);
    assert.equal(options.method, 'POST');
    assert.equal(options.cache, 'no-store');
    assert.equal(options.headers['Cache-Control'], 'no-cache');
    if (fail) throw new Error('source unavailable');
    return Response.json(payload('3', 'Nublado', sourceTime));
  }, () => clock);
  assert.equal((await loader()).code, '3');
  await loader();
  assert.equal(requests, 1, 'five minute cache coalesces source requests');
  clock += provider.CURRENT_CACHE_MS + 1;
  fail = true;
  const retained = await loader();
  assert.equal(retained.refreshFailed, true);
  assert.equal(visual.currentConditionPresentation(retained, clock).status, 'stale');
  await loader();
  assert.equal(requests, 2, 'failed refresh is backed off for one minute');
  clock += provider.CURRENT_FAILURE_RETRY_MS + 1;
  fail = false;
  sourceTime = '16:36:00';
  assert.equal((await loader()).refreshFailed, false);
  assert.equal(requests, 3, 'source retries after the failure backoff');

  const publicPhotos = ['weather-clear-day.webp','weather-clear-night.webp','weather-partial-day.webp','weather-partial-night.webp','weather-cloudy-day.webp','weather-cloudy-night.webp','weather-rain-day.webp','weather-rain-night.webp','weather-storm-day.webp','weather-storm-night.webp','weather-fog-day.webp','weather-fog-night.webp'];
  for (const photo of publicPhotos) {
    const file = join(root, 'public', photo);
    const info = await stat(file);
    const bytes = await readFile(file);
    assert.ok(bytes.subarray(0, 4).equals(Buffer.from('RIFF')), `${photo} must be WebP`);
    assert.ok(info.size < 100_000, `${photo} stays lightweight`);
  }
  console.log(`PASS: Climatempo current source, UTC→BRT time, 10 code states, day/night, neutral stale/unknown, five-minute cache and retry; ${publicPhotos.length} WebP assets <100 KB`);
} finally {
  await rm(temp, { recursive: true, force: true });
}
