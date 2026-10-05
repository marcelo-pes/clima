import assert from 'node:assert/strict';import ts from 'typescript';import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../lib/weather-rules.ts',import.meta.url),'utf8');const rules=await import('data:text/javascript;base64,'+Buffer.from(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText).toString('base64'));
const now=Date.UTC(2026,9,5,18);
assert.equal(rules.recentLightning(5,(now-86400000)/1000,now),false);assert.equal(rules.recentLightning(5,(now-1800000)/1000,now),true);assert.equal(rules.recentLightning(5,(now-1800001)/1000,now),false);assert.equal(rules.recentLightning(5,null,now),false);assert.equal(rules.recentLightning(21,now/1000,now),false);
assert.equal(rules.compassSector(117),5);assert.equal(rules.COMPASS_NAMES[5],'Leste-sudeste');
const direction=rules.circularDirection([{time:now-300000,value:350},{time:now,value:10}],now);assert.ok(direction<1e-8||direction>359.999999);assert.equal(rules.circularDirection([{time:now-600001,value:90}],now),null);assert.equal(rules.circularDirection([{time:now,value:0},{time:now,value:180}],now),null);
console.log('PASS: lightning expiry, 16-sector compass and circular ten-minute direction');
