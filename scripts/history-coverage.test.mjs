import assert from 'node:assert/strict';
import ts from 'typescript';
import {readFileSync} from 'node:fs';
let source=readFileSync(new URL('../lib/weather-history-store.ts',import.meta.url),'utf8').replace('import { env } from "cloudflare:workers";','const env = {};');
const {hasHistoryCoverageGaps: gaps}=await import('data:text/javascript;base64,'+Buffer.from(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText).toString('base64'));
const paths=['outdoor/temperature','outdoor/humidity','indoor/temperature','indoor/humidity','pressure/relative','wind/wind_speed','wind/wind_gust','wind/wind_direction','solar_and_uvi/solar','solar_and_uvi/uvi','rainfall_piezo/daily'];
for(const [cycle,step] of [['5min',300],['30min',1800],['4hour',14400],['1day',86400]]) {
 const data={}; for(const path of paths){const [group,key]=path.split('/');data[group]??={};data[group][key]={list:{[step]:'0',[2*step]:'1',[3*step]:'2'}};}
 assert.equal(gaps(data,cycle,step,4*step-1),false,'Complete aligned samples including zero are valid');
 data.outdoor.temperature.list[2*step]='-';assert.equal(gaps(data,cycle,step,4*step-1),true,'Missing marker is not an observation');
 delete data.outdoor.temperature.list[2*step];assert.equal(gaps(data,cycle,step,4*step-1),true,'Internal hole must be reported');
 data.outdoor.temperature.list[2*step]='1';delete data.outdoor.temperature.list[step];assert.equal(gaps(data,cycle,step,4*step-1),true,'Missing initial edge must be reported');
}
console.log('PASS: complete cadence, missing markers, internal holes and interval edges');
