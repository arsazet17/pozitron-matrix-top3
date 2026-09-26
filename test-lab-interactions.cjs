'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');

(async () => {
  const root = __dirname;
  const times = Array.from({length:48},(_,i)=>String(Math.floor(i/2)).padStart(2,'0')+':'+(i%2?'55':'25'));
  const draws = [];
  let id = 267756;
  for(let day=1;day<=26;day++)for(const time of times){
    if(day===26 && time>'12:25')break;
    draws.push({id:id++,date:String(day).padStart(2,'0')+'.09.26',time,a:1,b:2,c:3});
  }
  const server = http.createServer((req,res)=>{
    const file = new URL(req.url,'http://localhost').pathname;
    if(file==='/top3-data.js'){res.setHeader('Content-Type','text/javascript');res.end('window.TOP3_SEED='+JSON.stringify(draws));return;}
    if(file==='/top3-live.json'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({draws}));return;}
    const target=path.join(root,file==='/'?'index.html':file);
    if(!target.startsWith(root+path.sep)||!fs.existsSync(target)){res.writeHead(404);res.end();return;}
    res.setHeader('Content-Type',file.endsWith('.css')?'text/css':file.endsWith('.js')?'text/javascript':'text/html');
    res.end(fs.readFileSync(target));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let browser;
  try { browser=await chromium.launch({headless:true,...(process.env.TEST_BROWSER_CHANNEL?{channel:process.env.TEST_BROWSER_CHANNEL}:{})}); }
  catch(error){server.close();throw error;}
  const errors=[];
  try{
    for(const mobile of [false,true]){
      const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1280,height:900},isMobile:mobile,hasTouch:mobile,serviceWorkers:'block'});
      const page=await context.newPage();
      page.on('pageerror',e=>errors.push(e.message));
      await page.clock.setFixedTime(new Date('2026-09-26T09:30:00Z'));
      const url='http://127.0.0.1:'+server.address().port;
      await page.goto(url);
      await page.locator('#app:not(.hidden)').waitFor();
      await page.locator('.tab[data-tab="lab"]').click();
      await page.locator('#branchArrowToggle').waitFor({state:'attached'});
      const click=async selector=>mobile?page.locator(selector).tap():page.locator(selector).click();
      const shown=async selector=>{await page.locator(selector).waitFor({state:'visible'});assert.equal(await page.locator(selector).isVisible(),true,selector+' visible')};
      const hidden=async selector=>assert.equal(await page.locator(selector).isVisible(),false,selector+' hidden');
      await hidden('#branchDetail');
      const frozen=await page.evaluate(()=>LabBranch.readArchive()[0]);
      assert.ok(frozen,'automatic frozen created');
      // UI actions must never run the forecasting engine.
      await page.evaluate(()=>{window.planCalls=0;const original=LabBranchCore.forecastPlan;LabBranchCore.forecastPlan=(...args)=>{window.planCalls++;return original(...args)}});
      await click('#branchToggle');
      await shown('#branchDetail');
      await hidden('#branchArrows');
      await click('#branchArrowToggle');
      await shown('#branchArrows');
      await click('#branchArchiveToggle');
      await shown('#branchArchiveBody');
      assert.ok(await page.locator('.branch-archive-row').count());
      await page.evaluate(()=>LabBranch.render());
      assert.equal(await page.evaluate(()=>window.planCalls),0);
      assert.deepEqual(await page.evaluate(()=>LabBranch.readArchive()[0]),frozen);
      await page.reload();
      await page.locator('#app:not(.hidden)').waitFor();
      await page.locator('#branchArrowToggle').waitFor({state:'attached'});
      await page.locator('.tab[data-tab="lab"]').click();
      await shown('#branchDetail');await shown('#branchArrows');await shown('#branchArchiveBody');
      await click('#branchArrowToggle');await hidden('#branchArrows');
      await click('#branchToggle');await hidden('#branchDetail');
      await click('#branchArchiveToggle');await hidden('#branchArchiveBody');
      await page.locator('#branchToggle').focus();await page.keyboard.press('Enter');await shown('#branchDetail');
      await page.keyboard.press('Space');await hidden('#branchDetail');
      for(const tab of ['horizontal','matrix','lab']){
        await page.locator('.tab[data-tab="'+tab+'"]').click();
        await shown('#'+tab+'View');
      }
      // Reconcile each result without changing the frozen payload or duplicating it.
      for(const hit of [0,1,2]){
        const result=await page.evaluate(({frozen,hit})=>{
          const record=JSON.parse(JSON.stringify(frozen));
          const absent=[0,4,5,6,7,8,9].filter(x=>!record.prediction.includes(x));
          const fact=record.prediction.slice(0,hit).concat(absent).slice(0,3);
          localStorage.setItem('pozitron.lab.branch.archive.v1',JSON.stringify([record]));
          state.draws=state.draws.filter(d=>d.id!==record.target.id);
          state.draws.unshift({...record.target,a:fact[0],b:fact[1],c:fact[2]});
          LabBranch.render();
          return LabBranch.readArchive().find(r=>r.key===record.key);
        },{frozen,hit});
        assert.equal(result.result,hit+'/2');
        assert.deepEqual(result.prediction,frozen.prediction);
        assert.equal(result.savedAt,frozen.savedAt);
      }
      await page.reload();await page.locator('#app:not(.hidden)').waitFor();
      assert.equal(await page.evaluate(key=>LabBranch.readArchive().find(r=>r.key===key).result,frozen.key),'2/2');
      await page.locator('.tab[data-tab="lab"]').click();
      await page.evaluate(()=>{Storage.prototype.setItem=function(){throw new Error('blocked storage')};});
      await click('#branchToggle');await shown('#branchDetail');
      await click('#branchArchiveToggle');await shown('#branchArchiveBody');
      await context.close();
      console.log((mobile?'Mobile touch':'Desktop')+': PASS');
    }
    for(const scenario of ['empty','late','storage']){
      const context=await browser.newContext({serviceWorkers:'block'});
      const page=await context.newPage();
      page.on('pageerror',e=>errors.push(e.message));
      await page.clock.setFixedTime(new Date(scenario==='late'?'2026-09-27T09:30:00Z':'2026-09-26T09:30:00Z'));
      if(scenario==='empty'){
        await page.route('**/top3-data.js*',route=>route.fulfill({contentType:'text/javascript',body:'window.TOP3_SEED=[]'}));
        await page.route('**/top3-live.json*',route=>route.fulfill({contentType:'application/json',body:'{"draws":[]}'}));
      }
      if(scenario==='storage')await page.addInitScript(()=>{Storage.prototype.setItem=function(){throw new Error('blocked storage')}});
      await page.goto('http://127.0.0.1:'+server.address().port);
      await page.locator('#app:not(.hidden)').waitFor();
      await page.locator('.tab[data-tab="lab"]').click();
      await page.locator('#branchToggle').click();
      await page.locator('#branchDetail').waitFor({state:'visible'});
      await page.locator('#branchArchiveToggle').click();
      assert.equal(await page.locator('#branchArchiveBody').isVisible(),true);
      assert.equal(await page.evaluate(()=>LabBranch.readArchive().length),0);
      if(scenario==='storage'){
        await page.waitForFunction(()=>document.querySelector('#branchDetail')?.textContent.includes('Не удалось сохранить'));
      }
      await context.close();
      console.log(scenario+': PASS');
    }
    assert.deepEqual(errors,[]);
  } finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exitCode=1});
