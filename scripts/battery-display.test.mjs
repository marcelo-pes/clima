import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const source=await readFile(new URL('../lib/battery-display.ts',import.meta.url),'utf8');
const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const {batteryDisplay:display,batterySegments:segments}=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
const reading=(value,unit='')=>({value,unit,time:1791286123});
assert.equal(display(null,'wh57').percent,null);
for(const v of ['','-','NaN','Infinity',9,-1,2.5])assert.equal(display(reading(v),'wh57').percent,null);
for(let level=0;level<=5;level++){
 const d=display(reading(level),'wh57');assert.equal(d.percent,level*20);
 assert.equal(segments(d.percent).reduce((a,b)=>a+b,0)/4,d.percent);
}
for(const v of [0,1,25,60,75,100]){assert.equal(display(reading(v,'%')).percent,v);assert.equal(segments(v).reduce((a,b)=>a+b,0)/4,v)}
for(const v of [-1,101])assert.equal(display(reading(v,'%')).percent,null);
for(const v of [0,2.5,5.2]){assert.equal(display(reading(v,'V')).percent,null);assert.equal(display(reading(v,'V'),'wh57').percent,null);}
for(const v of ['Normal','Low','Offline'])assert.equal(display(reading(v),'wh57').percent,null);
assert.deepEqual(segments(null),[0,0,0,0]);assert.deepEqual(segments(60),[100,100,40,0]);
console.log('PASS battery: documented 0–5 normalization, explicit percent, proportional segments, missing/invalid/status/voltage never fabricated as percent');
