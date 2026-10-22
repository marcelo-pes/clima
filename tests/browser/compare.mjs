import {chromium} from 'playwright';
import {PNG} from 'pngjs';
import pixelmatch from 'pixelmatch';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const out=process.argv[2],browser=await chromium.launch({headless:true,...(process.env.CLIMA_TEST_CHROMIUM_PATH?{executablePath:process.env.CLIMA_TEST_CHROMIUM_PATH}:{})});
const results=[];
try {
 for(const viewport of [{width:1440,height:1000},{width:390,height:844}]){
  const pages=[];
  for(const port of [18987,18989]){
   const context=await browser.newContext({viewport,timezoneId:'America/Sao_Paulo',locale:'pt-BR',serviceWorkers:'block',reducedMotion:'reduce'});
   await context.addInitScript(()=>{const fixed=Date.parse('2026-10-22T12:00:00Z'),D=Date;globalThis.Date=class extends D{constructor(...a){super(...(a.length?a:[fixed]));}static now(){return fixed;}};});
   await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
   const page=await context.newPage();
   const issues=[];
   page.on('response',r=>{if(r.status()>=400)issues.push(r.status()+' '+r.url())});page.on('console',m=>{if(m.type()==='error')issues.push(m.text())});page.on('pageerror',e=>issues.push(e.message));page.on('requestfailed',r=>{if(new URL(r.url()).hostname==='127.0.0.1')issues.push(r.url()+' '+r.failure()?.errorText)});
   await page.goto(`http://127.0.0.1:${port}/#evolution`);
   try{await page.waitForSelector('.camera-observation',{timeout:15000});}catch(error){
    await page.screenshot({path:`${out}/startup-${port}-${viewport.width}.png`,fullPage:true});
    await writeFile(`${out}/startup-${port}-${viewport.width}.txt`,JSON.stringify({issues,text:await page.locator('body').innerText()},null,2));
    throw error;
   }
   await page.waitForTimeout(1500);
   assert.equal(new URL(page.url()).hash,'#map','Forecast must be initial view, even with saved hash');
   pages.push(page);
  }
  for(const tab of ['map','current','evolution','wind','satellite','profile']){
   const shots=[],texts=[],layouts=[];
   for(const [i,page] of pages.entries()){
    if(tab!=='map'){
     const keys={current:'Dados Atuais',evolution:'Histórico',wind:'Vento',satellite:'Satélite',profile:'Perfil'};
     // Select the application navigation by data from its click handler anchor hash.
     const nav=await page.locator('nav button,nav a').all();let clicked=false;
     for(const el of nav){const text=await el.innerText();if(text.toLowerCase().includes(keys[tab].toLowerCase())){await el.click();clicked=true;break;}}
     if(!clicked){
      const buttons=await page.locator('button').all();
      for(const el of buttons){const text=await el.innerText();if(text.trim()===keys[tab]){await el.click();clicked=true;break;}}
     }
     assert(clicked,'Navigation missing: '+tab);
    }
    await page.waitForTimeout(900);
    texts.push((await page.locator('body').innerText()).replace(/\s+/g,' ').trim());
    assert(!await page.locator('.history-window').count());
    layouts.push(await page.locator('body').evaluate(el=>({width:el.scrollWidth,height:el.scrollHeight})));
    const image=await page.screenshot({fullPage:true,animations:'disabled'});shots.push(PNG.sync.read(image));
    await writeFile(`${out}/${viewport.width}-${tab}-${i}.png`,image);
   }
   assert.equal(texts[0],texts[1],`Visible text ${viewport.width}/${tab}`);
   assert.deepEqual(layouts[0],layouts[1],`Layout ${viewport.width}/${tab}`);
   const [a,b]=shots;assert.equal(a.width,b.width);assert.equal(a.height,b.height);
   const diff=new PNG({width:a.width,height:a.height});const ratio=pixelmatch(a.data,b.data,diff.data,a.width,a.height,{threshold:.15})/(a.width*a.height);
   await writeFile(`${out}/${viewport.width}-${tab}-diff.png`,PNG.sync.write(diff));
   assert(ratio<.01,`Screenshot differs: ${viewport.width}/${tab}: ${ratio}`);
   results.push({viewport:viewport.width,tab,pixelDifference:ratio,visibleTextEqual:true});
  }
  for(const page of pages)await page.context().close();
 }
 await writeFile(`${out}/browser-report.json`,JSON.stringify(results,null,2));console.log('PASS browser comparisons',results.length);
}finally{await browser.close();}
