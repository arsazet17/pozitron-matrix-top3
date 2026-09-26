import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const Core=require('./lab-branch-core.js');

const self=Core.selfTest();
assert.equal(self.pass,true,JSON.stringify(self.checks));

const times=['07:25','07:55','08:25','08:55','09:25','09:55','10:25','10:55','11:25','11:55','12:25','12:55','13:25','13:55','14:25','14:55'];
let id=1;
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

const html=fs.readFileSync('index.html','utf8');
const js=fs.readFileSync('lab-branch.js','utf8');
const css=fs.readFileSync('lab-branch.css','utf8');
const sw=fs.readFileSync('sw.js','utf8');
for(const needle of ['id="branchForecast"','id="branchArchive"','id="branchArchiveToggle"','id="branchArchiveBody"','Ступени','Три столба','ПОКА НЕАКТИВНО','lab-branch-core.js?v=1.7.4','lab-branch.js?v=1.7.4'])assert.ok(html.includes(needle),`index missing ${needle}`);
for(const needle of ['pozitron.lab.branch.archive.v1','status:\'pending\'','closePending','branchArrowToggle','branchArchiveToggle','branchTargetDraw','targetOpen','+03:00','branchMatrixHtml','Схема ветки по матрице','Контроль того же D с S0','Контрольные цифры','bm-line main','bm-line control'])assert.ok(js.includes(needle),`branch js missing ${needle}`);
assert.ok(js.startsWith("'use strict';"),'lab-branch.js must use strict mode');
assert.ok(!js.includes('!window.state'),'lab-branch.js must not require window.state');
assert.ok(js.includes("Number(d.id)>=CUTOVER_ID"),'branch target must use the new 48-draw era');
assert.ok(js.includes('Date.now()<ms'),'late target guard must block post-draw frozen creation');
assert.ok(js.includes('НАЖАТЬ, ЧТОБЫ'),'branch card must explain its click action');
for(const needle of ['.branch-control-card','.branch-visual','.branch-matrix-scroll','.bm-line.main','.bm-line.control','.branch-pair.control','.lab-legacy-runtime{display:none!important}'])assert.ok(css.includes(needle),`css missing ${needle}`);
assert.ok(sw.includes("matrix-top3-v1.7.4-lab-branch-matrix"));
for(const asset of ['./lab-branch.css','./lab-branch-core.js','./lab-branch.js'])assert.ok(sw.includes(asset),`sw missing ${asset}`);

console.log('LAB MATRIX BRANCH CONTROL: PASS');
console.log(`Core ${Core.VERSION}; D/date, S/time, honest-freeze, mobile S0 card, visual matrix arrows, archive and cache checked.`);
