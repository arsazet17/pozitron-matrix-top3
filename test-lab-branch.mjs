import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const Core=require('./lab-branch-core.js');
const Server=require('./scripts/branch-archive-top3-server.cjs');

const self=Core.selfTest();
assert.equal(self.pass,true,JSON.stringify(self.checks));

const times=['07:25','07:55','08:25','08:55','09:25','09:55','10:25','10:55','11:25','11:55','12:25','12:55','13:25','13:55','14:25','14:55'];
let id=267756;
const draws=[];
for(let day=1;day<=20;day++){
  const date=String(day).padStart(2,'0')+'.09.26';
  for(let ti=0;ti<times.length;ti++)draws.push({id:id++,date,time:times[ti],a:(day+ti)%10,b:(day*2+ti)%10,c:(day+ti*3)%10});
}
const map=Core.buildMap(draws);
for(let d=1;d<=14;d++)for(let s=-2;s<=2;s++)for(const t of ['08:25','10:55','13:55']){
  const target={date:'20.09.26',time:t};
  const src=Core.sourceFor(target,d,s,map,times),shifted=Core.shiftTime(t,s,times);
  if(!shifted){assert.equal(src,null);continue}
  assert.ok(src,`missing D${d} S${s} ${t}`);
  assert.equal(src.date,Core.addDays(target.date,-d));
  assert.equal(src.time,shifted);
}
assert.equal(Core.overlapCount([8,5,0],[8,0,5]),3);
assert.equal(Core.overlapCount([9,0],[2,3,8]),0);
assert.deepEqual(Core.matchedDigits([1,5],[5,1,6]).sort(),[1,5]);

const liveDraws=draws.filter(d=>d.date!=='20.09.26'||d.time<='13:25');
const first=Server.updateArchive({draws:liveDraws},{records:[]},new Date('2026-09-20T10:30:00Z'));
assert.equal(first.changed,true);
const frozen=first.archive.records.find(r=>r.status==='pending');
assert.ok(frozen,'server frozen created');
assert.equal(frozen.serverFrozen,true);
assert.equal(frozen.storage,'branch-archive-top3.json');
assert.equal(frozen.target.date,'20.09.26');
assert.equal(frozen.target.time,'13:55');
assert.ok(frozen.savedAt);
const frozenPrediction=[...frozen.prediction],frozenSavedAt=frozen.savedAt;
const absent=[0,1,2,3,4,5,6,7,8,9].filter(x=>!frozenPrediction.includes(x));
const factCombo=[frozenPrediction[0],...absent].slice(0,3);
const fact={id:frozen.target.id,date:frozen.target.date,time:frozen.target.time,a:factCombo[0],b:factCombo[1],c:factCombo[2]};
const second=Server.updateArchive({draws:[fact,...liveDraws]},first.archive,new Date('2026-09-20T10:56:00Z'));
const closed=second.archive.records.find(r=>r.key===frozen.key);
assert.equal(closed.status,'closed');
assert.equal(closed.result,'1/2');
assert.deepEqual(closed.prediction,frozenPrediction,'server must not rewrite frozen prediction');
assert.equal(closed.savedAt,frozenSavedAt,'server must not rewrite savedAt');
assert.deepEqual(closed.fact.combo,factCombo);
assert.ok(second.archive.records.some(r=>r.status==='pending'&&r.key!==frozen.key),'next server frozen created after fact');

const html=fs.readFileSync('index.html','utf8');
const app=fs.readFileSync('app.js','utf8');
const js=fs.readFileSync('lab-branch.js','utf8');
const css=fs.readFileSync('lab-branch.css','utf8');
const sw=fs.readFileSync('sw.js','utf8');
const serverScript=fs.readFileSync('scripts/branch-archive-top3-server.cjs','utf8');
const archive=JSON.parse(fs.readFileSync('branch-archive-top3.json','utf8'));
for(const needle of ['id="branchForecast"','id="branchArchive"','id="branchArchiveToggle"','id="branchArchiveBody"','Ступени','Три столба','ПОКА НЕАКТИВНО','branch-archive-top3.json','app.js?v=1.8.1','lab-branch-core.js?v=1.8.0','lab-branch.js?v=1.8.0'])assert.ok(html.includes(needle),`index missing ${needle}`);
for(const legacy of ['LAB MATRIX LEGACY','id="labForecast"','id="labSignals"','id="saveForecastBtn"','id="labArchive"','lab-detector.js','archive-delete.js'])assert.ok(!html.includes(legacy),`legacy HTML/script still present: ${legacy}`);
for(const legacy of ['pozitron.labMatrix.predictions.v1','state.predictions','function labForecast','function renderLab','function saveForecast','function applyFacts','function renderArchive','function renderStats'])assert.ok(!app.includes(legacy),`legacy app runtime still present: ${legacy}`);
assert.equal(fs.existsSync('lab-detector.js'),false,'lab-detector.js must be deleted');
assert.equal(fs.existsSync('archive-delete.js'),false,'archive-delete.js must be deleted');
for(const needle of ["ARCHIVE_URL='./branch-archive-top3.json'",'loadServerArchive','serverFrozen','previewFrozen','branchArrowToggle','branchArchiveToggle','branchTargetDraw','targetOpen','+03:00','branchMatrixHtml','Схема ветки по матрице','Контроль того же D с S0','Контрольные цифры','bm-line main','bm-line control'])assert.ok(js.includes(needle),`branch js missing ${needle}`);
assert.ok(!js.includes('pozitron.lab.branch.archive.v1'),'browser must not use legacy local branch archive');
assert.ok(js.startsWith("'use strict';"),'lab-branch.js must use strict mode');
assert.ok(!js.includes('!window.state'),'lab-branch.js must not require window.state');
assert.ok(js.includes("Number(d.id)>=CUTOVER_ID"),'branch target must use the new 48-draw era');
assert.ok(js.includes('Date.now()<ms'),'late target guard must block post-draw preview creation');
assert.ok(js.includes('НАЖАТЬ, ЧТОБЫ'),'branch card must explain its click action');
for(const needle of ['serverFrozen:true','closePending','branch-archive-top3.json','updateArchive'])assert.ok(serverScript.includes(needle),`server archive generator missing ${needle}`);
assert.equal(archive.schema,1);assert.ok(Array.isArray(archive.records));
for(const needle of ['.branch-control-card','.branch-visual','.branch-matrix-scroll','.bm-line.main','.bm-line.control','.branch-pair.control'])assert.ok(css.includes(needle),`css missing ${needle}`);
assert.ok(sw.includes("matrix-top3-v1.8.1-lab-clean"));
assert.ok(!sw.includes('lab-detector.js'),'service worker must not cache legacy detector');
for(const asset of ['./lab-branch.css','./lab-branch-core.js','./lab-branch.js','./branch-archive-top3.json'])assert.ok(sw.includes(asset),`sw missing ${asset}`);

console.log('LAB MATRIX BRANCH CONTROL: PASS');
console.log(`Core ${Core.VERSION}; legacy LAB removed; matrix/horizontal + shared server branch archive remain.`);
