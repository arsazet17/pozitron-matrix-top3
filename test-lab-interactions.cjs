'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const http=require('node:http');
const path=require('node:path');
const {chromium}=require('playwright');

(async()=>{
  const root=__dirname;
  const times=Array.from({length:48},(_,i)=>String(Math.floor(i/2)).padStart(2,'0')+':'+(i%2?'55':'25'));
  const draws=[];let id=267756;
  for(let day=1;day<=26;day++)for(const time of times){
    if(day===26&&time>'12:25')break;
    draws.push({id:id++,date:String(day).padStart(2,'0')+'.09.26',time,a:1,b:2,c:3});
  }
  const latest=draws[draws.length-1],target={id:latest.id+1,date:'26.09.26',time:'12:55'};
  const record={
    key:`${target.id}|${target.date}|${target.time}`,status:'pending',savedAt:'2026-09-26T09:30:00.000Z',engine:'LAB BRANCH SERVER v1.8.0',serverFrozen:true,storage:'branch-archive-top3.json',
    target,decision:'CONTINUE',streak:1,branch:{d:1,s:-1,score:.4,rate:.3,samples:30},
    source:{date:'25.09.26',time:'12:25',combo:[1,2,3]},prediction:[1,2],
    s0:{source:{date:'25.09.26',time:'12:55',combo:[1,2,3]},prediction:[2,3]},extended:null,ranking:[]
  };
  let archiveRequests=0;
  const archivePayload={schema:1,method:'lab-branch-ds-v1',storage:'github-main',updatedAt:'2026-09-26T09:30:00.000Z',latestHistoryDraw:latest.id,records:[record]};

  const server=http.createServer((req,res)=>{
    const file=new URL(req.url,'http://localhost').pathname;
    if(file==='/top3-data.js'){res.setHeader('Content-Type','text/javascript');res.end('window.TOP3_SEED='+JSON.stringify(draws));return;}
    if(file==='/top3-live.json'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({draws}));return;}
    if(file==='/branch-archive-top3.json'){archiveRequests++;res.setHeader('Content-Type','application/json');res.end(JSON.stringify(archivePayload));return;}
    const targetFile=path.join(root,file==='/'?'index.html':file);
    if(!targetFile.startsWith(root+path.sep)||!fs.existsSync(targetFile)){res.writeHead(404);res.end();return;}
    res.setHeader('Content-Type',file.endsWith('.css')?'text/css':file.endsWith('.js')?'text/javascript':'text/html');
    res.end(fs.readFileSync(targetFile));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({headless:true,...(process.env.TEST_BROWSER_CHANNEL?{channel:process.env.TEST_BROWSER_CHANNEL}:{})});
  const errors=[];
  try{
    for(const mobile of [false,true]){
      const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1280,height:900},isMobile:mobile,hasTouch:mobile,serviceWorkers:'block'});
      const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
      await page.clock.setFixedTime(new Date('2026-09-26T09:31:00Z'));
      await page.addInitScript(()=>localStorage.setItem('pozitron.lab.branch.archive.v1',JSON.stringify([{key:'LOCAL-MUST-NOT-BE-USED'}])));
      const url='http://127.0.0.1:'+server.address().port;
      await page.goto(url);await page.locator('#app:not(.hidden)').waitFor();
      await page.locator('.tab[data-tab="lab"]').click();
      await page.waitForFunction(()=>window.LabBranch&&LabBranch.readArchive().length===1);
      assert.equal(await page.evaluate(()=>LabBranch.archiveSource),'./branch-archive-top3.json');
      assert.equal(await page.evaluate(()=>LabBranch.readArchive()[0].key),record.key,'server record must be authoritative');
      assert.equal(await page.evaluate(()=>LabBranch.readArchive()[0].serverFrozen),true);
      assert.ok(archiveRequests>0,'server archive requested');
      await page.locator('#branchArrowToggle').waitFor({state:'attached'});
      const click=async s=>mobile?page.locator(s).tap():page.locator(s).click();
      const shown=async s=>{await page.locator(s).waitFor({state:'visible'});assert.equal(await page.locator(s).isVisible(),true,s+' visible');};
      const hidden=async s=>assert.equal(await page.locator(s).isVisible(),false,s+' hidden');
      await hidden('#branchDetail');
      await click('#branchToggle');await shown('#branchDetail');
      await hidden('#branchArrows');await click('#branchArrowToggle');await shown('#branchArrows');
      await click('#branchArchiveToggle');await shown('#branchArchiveBody');
      assert.equal(await page.locator('.branch-archive-row').count(),1);
      assert.ok((await page.locator('#branchArchiveStats').textContent()).includes('branch-archive-top3.json'));
      assert.ok((await page.locator('#branchDetail').textContent()).includes('SERVER FROZEN'));
      await page.reload();await page.locator('#app:not(.hidden)').waitFor();await page.locator('.tab[data-tab="lab"]').click();
      await page.waitForFunction(()=>window.LabBranch&&LabBranch.readArchive().length===1);
      await shown('#branchDetail');await shown('#branchArrows');await shown('#branchArchiveBody');
      await context.close();
      console.log((mobile?'Mobile touch':'Desktop')+': PASS');
    }

    // Blocking localStorage writes may affect UI preference persistence, but server archive and controls must still work.
    const context=await browser.newContext({serviceWorkers:'block'});const page=await context.newPage();
    page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(()=>{Storage.prototype.setItem=function(){throw new Error('blocked storage')}});
    await page.goto('http://127.0.0.1:'+server.address().port);await page.locator('#app:not(.hidden)').waitFor();
    await page.locator('.tab[data-tab="lab"]').click();await page.waitForFunction(()=>window.LabBranch&&LabBranch.readArchive().length===1);
    await page.locator('#branchToggle').click();await page.locator('#branchDetail').waitFor({state:'visible'});
    await page.locator('#branchArchiveToggle').click();await page.locator('#branchArchiveBody').waitFor({state:'visible'});
    assert.equal(await page.evaluate(()=>LabBranch.readArchive()[0].key),record.key);
    await context.close();
    console.log('Blocked localStorage writes: PASS');
    assert.deepEqual(errors,[]);
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exitCode=1});