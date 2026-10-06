import assert from 'node:assert/strict';import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import ts from 'typescript';import {DatabaseSync} from 'node:sqlite';
const dir=await mkdtemp(join(tmpdir(),'clima-extrema-'));
try{
 for(const name of ['chart-extrema','weather-chart-extrema']){let source=await readFile(new URL('../lib/'+name+'.ts',import.meta.url),'utf8');source=source.replace("'cloudflare:workers'","'./env.mjs'").replace("'./chart-extrema'","'./chart-extrema.mjs'");await writeFile(join(dir,name+'.mjs'),ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText)}
 await writeFile(join(dir,'env.mjs'),'export const env={};');const {env}=await import(join(dir,'env.mjs'));const c=new DatabaseSync(':memory:');
 c.exec('CREATE TABLE ecowitt_history_points(device_key TEXT,metric_path TEXT,observed_at INTEGER,value TEXT,unit TEXT); CREATE TABLE weather_daily_statistics(device_key TEXT,metric_path TEXT,day TEXT,unit TEXT,samples INTEGER,minimum REAL,maximum REAL,minimum_at INTEGER,maximum_at INTEGER);');
 const start=Date.parse('2026-10-01T00:00:00-03:00')/1000,end=start+2*86400-1;
 const add=c.prepare('INSERT INTO ecowitt_history_points VALUES(?,?,?,?,?)');
 for(const [t,v] of [[start-300,'99'],[start,'20'],[start+300,'-'],[start+600,'10'],[start+1200,'30'],[start+1800,'NaN'],[start+86400,'25'],[end+1,'100']])add.run('station','outdoor/temperature',t,v,'C');
 add.run('station','outdoor/temperature_high',start+86400,'35','C');
 c.prepare('INSERT INTO weather_daily_statistics VALUES(?,?,?,?,?,?,?,?,?)').run('station','outdoor/temperature','2026-10-01','C',3,10,30,start+600,start+1200);
 c.prepare('INSERT INTO weather_daily_statistics VALUES(?,?,?,?,?,?,?,?,?)').run('station','outdoor/temperature','2026-10-02','C',1,25,25,start+86400,start+86400);
 c.prepare('INSERT INTO weather_daily_statistics VALUES(?,?,?,?,?,?,?,?,?)').run('station','outdoor/temperature_high','2026-10-02','C',1,35,35,start+86400,start+86400);
 env.DB={prepare(sql){const st=c.prepare(sql);let args=[];return{bind(...a){args=a;return this},async first(){return st.get(...args)||null},async all(){return{results:st.all(...args)}}}}};
 const {sqliteChartExtrema}=await import(join(dir,'weather-chart-extrema.mjs'));const full=await sqliteChartExtrema('station',start,end);
 assert.equal(full.temperature.minimum.value,10);assert.equal(full.temperature.minimum.time,(start+600)*1000);assert.equal(full.temperature.maximum.value,35);assert.equal(full.temperature.maximum.aggregate,true);assert.equal(full.temperature.samples,4);
 const partial=await sqliteChartExtrema('station',start+900,start+1800);assert.equal(partial.temperature.minimum.value,30);assert.equal(partial.temperature.maximum.value,30);assert.equal(partial.temperature.samples,1);
 assert.deepEqual(await sqliteChartExtrema('station',start+2000,start+2500),{});
 const {payloadChartExtrema,extremaOfPoints}=await import(join(dir,'chart-extrema.mjs'));const api=payloadChartExtrema({outdoor:{temperature:{unit:'C',list:{[start-1]:'99',[start]:'0',[start+300]:'-',[start+600]:'30',[end+1]:'100'}}}},start,end);
 assert.equal(api.temperature.minimum.value,0);assert.equal(api.temperature.maximum.value,30);assert.equal(extremaOfPoints([{time:1,value:NaN}],'C'),null);
 console.log('PASS extrema: full-period records, daily summary timestamps, high/low fields, exact partial-day bounds, no zero from missing/invalid, empty and constant series');c.close();
}finally{await rm(dir,{recursive:true,force:true})}
