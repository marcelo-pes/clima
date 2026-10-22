import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync(new URL('../lib/weather-history-window.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const { completedSevenDayWindow, shiftCalendarDate, saoPauloMidnight, historyCacheKey } = await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));

for (const [anchor, first, last] of [
  ['2026-10-22','2026-10-15','2026-10-21'],
  ['2024-03-01','2024-02-23','2024-02-29'],
  ['2026-01-01','2025-12-25','2025-12-31'],
]) {
  const window = completedSevenDayWindow(anchor);
  assert.equal(window.startDate,first);
  assert.equal(window.endDate,last);
  assert.equal(window.start.toISOString(),first+'T03:00:00.000Z');
  assert.equal(window.end.getTime(),saoPauloMidnight(anchor).getTime()-1000);
  assert.equal(window.end.getTime()-window.start.getTime()+1000,7*86400000);
  const key = historyCacheKey('synthetic','30min','outdoor',window.start,window.end);
  assert.deepEqual(key.split('|').slice(-2),[String(window.start.getTime()/1000),String(window.end.getTime()/1000)]);
}
assert.equal(shiftCalendarDate('2024-02-29',1),'2024-03-01');
assert.throws(()=>shiftCalendarDate('2026-02-29',0),/inválida/);
assert.throws(()=>completedSevenDayWindow('2026-13-01'),/inválida/);
console.log('PASS: completed seven-day windows, Brasília boundaries, leap days, year boundaries, exact cache keys and invalid dates');
