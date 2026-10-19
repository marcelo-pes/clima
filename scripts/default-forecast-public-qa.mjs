import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const dir=process.env.QA_OUTPUT || '/tmp/forecast-start-qa-20261019';await mkdir(dir,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const results=[];
try {
for(const host of ['clima.antaisolar.com.br','clima2.antaisolar.com.br'])for(const width of [1440,390]){
 const page=await browser.newPage({viewport:{width,height:1000}});const row={host,width,visits:[],tabs:[],errors:[]};
 page.on('pageerror',e=>row.errors.push(e.message));
 for(const suffix of ['/','/#current','/#profile']){
  await page.goto('about:blank');
  await page.goto(`https://${host}${suffix}`,{waitUntil:'domcontentloaded',timeout:90000});
  await page.locator('.map-layout').waitFor({timeout:60000});
  await page.waitForFunction(()=>location.hash==='#map',{},{timeout:60000});await assertTab('Previsão');assert.equal(new URL(page.url()).hash,'#map');
  row.visits.push({url:suffix,selected:'Previsão'});console.log(host,width,suffix,'Previsão OK');
 }
 for(const label of ['Dados Atuais','Satélite','Ventos','Histórico','Perfil','Previsão']){
  await page.getByRole('tab',{name:label,exact:true}).click();await assertTab(label);
  const panel=label==='Satélite'?page.locator('.satellite-panel'):page.locator('[role="tabpanel"][data-state="active"]');await panel.waitFor({timeout:60000});
  assert((await panel.innerText()).length>0 || await panel.locator('iframe,img,svg').count()>0);
  row.tabs.push(label);console.log(host,width,label,'OK');
 }
 await page.screenshot({path:`${dir}/${host}-${width}.png`,fullPage:true});
 await page.getByRole('tab',{name:'Dados Atuais',exact:true}).click();await assertTab('Dados Atuais');
 await page.reload({waitUntil:'domcontentloaded',timeout:90000});await page.locator('.map-layout').waitFor({timeout:60000});await assertTab('Previsão');
 row.reloadFromCurrent='Previsão';results.push(row);await writeFile(`${dir}/report.json`,JSON.stringify(results,null,2));console.log(JSON.stringify(row));await page.close();
 async function assertTab(label){await page.getByRole('tab',{name:label,exact:true}).and(page.locator('[aria-selected="true"]')).waitFor({timeout:60000});}
}
}finally{await browser.close();}
