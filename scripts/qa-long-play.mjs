import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';

// All game changes below are made through real touch events. The QA bridge is read-only.
const duration = Number(process.env.MORI_QA_MINUTES ?? 22) * 60_000;
const output = resolve(process.env.MORI_QA_OUTPUT ?? '/workspace/scratch/mori-v0.4-long-play');
await mkdir(output, { recursive: true });
const chromiumPath = process.env.PLAYWRIGHT_CHROMIUM_PATH ?? (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
const browser = await chromium.launch({ executablePath: chromiumPath, headless: true, args: ['--no-sandbox'] });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
const errors = [], log = [];
const metrics = { mealsCooked: 0, crafts: 0, repairs: 0, pausesChecked: 0, reloadsChecked: 0, touchActions: 0, bloodMoonSeen: false };
page.on('pageerror', error => errors.push(error.message));
const start = Date.now();
const sleep = ms => page.waitForTimeout(ms);
const state = () => page.evaluate(() => window.__MORI_OBSERVE__());
const assert = (condition, message) => { if (!condition) throw new Error(message); };
async function touch(type, x, y) { await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] }); }
async function tap(x, y) { metrics.touchActions++; await page.touchscreen.tap(x, y); await sleep(170); }
async function drag(from, to) {
  metrics.touchActions++;
  await touch('touchStart', ...from);
  for (let i = 1; i <= 10; i++) { await touch('touchMove', from[0] + (to[0] - from[0]) * i / 10, from[1] + (to[1] - from[1]) * i / 10); await sleep(12); }
  await touch('touchEnd', ...to); await sleep(380);
}
async function go(scene) {
  let current = (await state()).world.scene;
  if (current === scene) return;
  if (current !== 'front') {
    const back = { farm: [[70,740],[320,740]], defense: [[320,740],[70,740]], kitchen: [[195,150],[195,710]], factory: [[195,740],[195,180]] }[current];
    await drag(...back); assert((await state()).world.scene === 'front', `无法从${current}回前台`);
  }
  if (scene !== 'front') {
    const forward = { farm: [[320,740],[70,740]], defense: [[70,740],[320,740]], kitchen: [[195,710],[195,180]], factory: [[195,180],[195,710]] }[scene];
    await drag(...forward); assert((await state()).world.scene === scene, `无法前往${scene}`);
  }
}
const plotPositions = [[98,382],[195,370],[292,382],[98,486],[195,476],[292,486],[98,590],[195,580],[292,590]];
async function farm() {
  await go('farm');
  for (let i=0;i<9;i++) {
    let plot=(await state()).farm.plots[i];
    if(plot.stage==='ready') await tap(...plotPositions[i]);
    plot=(await state()).farm.plots[i];
    if(plot.stage==='empty') await tap(...plotPositions[i]);
  }
}
async function cook() {
  await go('kitchen');
  let s=await state();
  if(s.inventory.stew>=3) return false;
  if(s.kitchen.pot==='burnt') await tap(205,405);
  s=await state();
  if(!s.kitchen.plateReady && s.kitchen.pot==='empty') {
    if(s.kitchen.board==='empty' && s.kitchen.bowlPieces===0) {
      if(s.inventory.carrots===0) return false;
      await drag([58,535],[233,610]);
    }
    s=await state();
    if(s.kitchen.board==='whole') {
      if(s.progression.cutter) await sleep(1800);
      else for(let i=0;i<3;i++) await drag([195,610],[275,610]);
    }
    s=await state();
    if(s.kitchen.board==='chopped') await drag([233,610],[95,618]);
    if((await state()).kitchen.bowlPieces>0) await drag([95,618],[205,405]);
  }
  for(let i=0;i<16 && (await state()).kitchen.pot==='cooking';i++) await sleep(900);
  s=await state();
  if(s.kitchen.pot==='ready') await tap(205,405);
  await sleep(130);
  if((await state()).kitchen.plateReady) {
    const before=(await state()).inventory.stew;
    await drag([300,534],[342,325]);
    assert((await state()).inventory.stew===before+1,'料理入柜失败'); metrics.mealsCooked++; return true;
  }
  return false;
}
async function serve() {
  const s=await state(); if(!s.front.active || s.inventory.stew===0) return false;
  await go('front'); const before=(await state()).front.served;
  await drag([96,675],[195,370]);
  assert((await state()).front.served===before+1,'亲手出餐失败'); return true;
}
const productX={part:131,turret:183,tools:235,cutter:287,watering:339};
async function craft(product) {
  await go('factory'); let s=await state();
  if(s.tutorial.completed) await tap(productX[product],675);
  if(s.factory.phase==='idle') await drag([58,680],[82,420]);
  s=await state(); if(s.factory.phase==='idle') return false;
  if(s.factory.phase==='cutting') for(let i=0;i<3;i++) await drag([55,420],[120,420]);
  if((await state()).factory.phase==='cut') await drag([82,420],[306,420]);
  if((await state()).factory.phase==='welding') { await touch('touchStart',306,420);await sleep(1800);await touch('touchEnd',306,420);await sleep(200); }
  if((await state()).factory.phase==='welded') await drag([306,420],[205,550]);
  if((await state()).factory.phase==='assembly') for(let i=0;i<3;i++) await tap(205,550);
  assert((await state()).factory.phase==='idle',`工厂${product}流程阻断`); metrics.crafts++; return true;
}
async function fight(seconds=5) {
  await go('defense'); const until=Date.now()+seconds*1000;
  while(Date.now()<until) {
    const s=await state(); const z=s.defense.zombies.filter(z=>z.hp>0).sort((a,b)=>a.x-b.x)[0];
    if(!z) break;
    if(z.kind==='tap-tutorial') await tap(z.x,345+z.lane*142);
    else { await touch('touchStart',z.x,345+z.lane*142);await sleep(1500);await touch('touchEnd',z.x,345+z.lane*142);await sleep(180); }
  }
}
async function place(lane) { await go('defense'); await drag([286,716],[108,356+lane*142]); assert((await state()).defense.towers.some(t=>t.lane===lane),'放塔失败'); }
async function report(name, screenshot=false) {
  const s=await state(); metrics.bloodMoonSeen ||= s.runtime.bloodMoon;
  const record={ name, elapsedSeconds:Math.round((Date.now()-start)/1000), day:s.runtime.day, scene:s.world.scene, hp:s.world.houseHp,
    served:s.front.served, failed:s.front.failed, beacon:s.world.beaconStage, towers:s.defense.towers.map(t=>({lane:t.lane,hp:t.hp})), inventory:s.inventory, progression:s.progression, metrics:{...metrics} };
  log.push(record); console.log(JSON.stringify(record)); await writeFile(output+'/progress.json',JSON.stringify({log,errors},null,2));
  if(screenshot) await page.screenshot({path:output+`/${name.replaceAll(/[^\w-]/g,'_')}.png`});
}

try {
  await page.goto((process.env.MORI_QA_URL ?? 'http://127.0.0.1:4173/')+'?qa=1');
  await page.waitForFunction(()=>typeof window.__MORI_OBSERVE__==='function');
  await report('start',true);
  await farm(); await cook(); await serve(); await craft('part');
  assert((await state()).tutorial.step==='start-beacon','首个工厂零件未完成');
  await drag([235,280],[195,165]);
  await fight(10); assert((await state()).tutorial.step==='repair-beacon','教学两尸未完成');
  await go('factory'); await drag([235,280],[195,165]); await craft('turret'); await place(1);
  assert((await state()).tutorial.completed,'新手闭环未完成'); await report('tutorial-complete',true);
  let lastReport=Date.now(), lastFarm=0, reloaded=false, paused=false;
  while(Date.now()-start<duration) {
    let s=await state(); metrics.bloodMoonSeen ||= s.runtime.bloodMoon;
    assert(s.tutorial.completed,'发生失败回退或教学进度丢失');
    assert(s.world.houseHp>0,'房屋失守'); assert(errors.length===0,'脚本异常：'+errors.join(';'));
    assert(Object.values(s.inventory).every(n=>Number.isFinite(n)&&n>=0),'资源出现负值或无效值');
    if(Date.now()-lastReport>=55_000){await report('minute-'+Math.floor((Date.now()-start)/60000),true);lastReport=Date.now();}
    if(!paused && Date.now()-start>300_000) {
      await tap(325,94);let before=(await state()).runtime.totalSeconds;await sleep(2200);
      assert(Math.abs((await state()).runtime.totalSeconds-before)<0.1,'暂停时系统仍在结算');await tap(195,422);metrics.pausesChecked++;paused=true;continue;
    }
    if(!reloaded && Date.now()-start>600_000) {
      await sleep(5100);const before=await state();await page.reload();await page.waitForFunction(()=>typeof window.__MORI_OBSERVE__==='function');const after=await state();
      assert(after.world.beaconStage===before.world.beaconStage && after.defense.towers.length===before.defense.towers.length,'刷新丢失信标或炮塔');metrics.reloadsChecked++;reloaded=true;continue;
    }
    if(s.front.active && s.inventory.stew>0){await serve();continue;}
    if(s.defense.kits>0){const lane=[0,1,2].find(lane=>!s.defense.towers.some(t=>t.lane===lane));if(lane!==undefined)await place(lane);continue;}
    if(s.defense.towers.length<3){if(s.inventory.scrap>=2)await craft('turret');else {await fight(8);await sleep(1500);}continue;}
    const needsRepair=s.world.houseHp<s.world.houseMaxHp-10 || s.defense.barricades.some(hp=>hp<45) || s.defense.towers.some(t=>t.hp<65);
    if(needsRepair && s.inventory.repairTools>0){await go('defense');await tap(25,280);for(const tower of s.defense.towers.filter(t=>t.hp<65))await tap(108,356+tower.lane*142);metrics.repairs++;await sleep(700);continue;}
    if(needsRepair && s.inventory.scrap>0 && s.inventory.repairTools===0){await craft('tools');continue;}
    if(s.inventory.carrots<4 && Date.now()-lastFarm>10_000){await farm();lastFarm=Date.now();continue;}
    if(s.inventory.stew<2 && s.inventory.carrots>0){await cook();continue;}
    if(s.front.served>=3 && s.world.beaconStage===1){if(s.inventory.parts<3 && s.inventory.scrap>0)await craft('part');else if(s.inventory.parts>=3){await go('factory');await tap(195,170);}else await fight(4);continue;}
    if(s.world.beaconStage>=2 && (!s.progression.watering || !s.progression.cutter)){
      if(s.inventory.scrap>=3)await craft(s.progression.watering?'cutter':'watering');else {await fight(4);await sleep(800);}continue;
    }
    if(s.front.served>=8 && s.world.beaconStage===2){if(s.inventory.parts<5 && s.inventory.scrap>0)await craft('part');else if(s.inventory.parts>=5){await go('factory');await tap(195,170);}else await fight(4);continue;}
    if(s.inventory.repairTools<3 && s.inventory.scrap>=2){await craft('tools');continue;}
    if(Date.now()-lastFarm>35_000){await farm();lastFarm=Date.now();continue;}
    await fight(2); await sleep(2000);
  }
  const s=await state();
  assert(s.front.served>=8,'未能连续接待八位伙伴');assert(s.defense.towers.length===3,'未能完成三路布防');
  assert(s.world.beaconStage>=2 && s.progression.cutter && s.progression.watering,'后续成长无法推进');
  assert(metrics.bloodMoonSeen,'持续试玩未覆盖血月');assert(s.runtime.day>=7,'未覆盖多个生存日');
  await report('finished',true);
  await writeFile(output+'/result.json',JSON.stringify({passed:true,wallSeconds:(Date.now()-start)/1000,metrics,errors,finalState:s},null,2));
} catch(error) {
  console.error(error);errors.push(String(error));await page.screenshot({path:output+'/failed.png'}).catch(()=>{});
  await writeFile(output+'/result.json',JSON.stringify({passed:false,error:String(error),metrics,errors,log},null,2));process.exitCode=1;
} finally {await browser.close();}
