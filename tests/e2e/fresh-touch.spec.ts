import { expect, test } from '@playwright/test';

test('全新存档：真实触摸完成烧糊重做、出餐、加工、两尸、上路建塔与读档', async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  const cdp = await page.context().newCDPSession(page);
  const state = () => page.evaluate(() => {
    const debug = (window as typeof window & { __MORI_DEBUG__: { getState: () => {
      world: { scene: string }; inventory: { stew: number; carrots: number };
      kitchen: { pot: string }; tutorial: { step: string };
      defense: { turretLane: number; turretPlaced: boolean; kills: number; zombies: { x: number; lane: number }[] };
    } } }).__MORI_DEBUG__;
    return debug.getState();
  });
  const touch = async (type: 'touchStart' | 'touchMove' | 'touchEnd', x: number, y: number) => {
    await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
  };
  const drag = async (from: [number, number], to: [number, number]) => {
    await touch('touchStart', ...from);
    for (let i = 1; i <= 12; i += 1) {
      await touch('touchMove', from[0] + (to[0] - from[0]) * i / 12, from[1] + (to[1] - from[1]) * i / 12);
      await page.waitForTimeout(20);
    }
    await touch('touchEnd', ...to);
    await page.waitForTimeout(400);
  };
  const tap = async (x: number, y: number) => { await page.touchscreen.tap(x, y); await page.waitForTimeout(150); };
  const screenshot = async (name: string) => {
    await page.screenshot({ path: testInfo.outputPath(name + '.png') });
  };
  const cook = async () => {
    await drag([58, 535], [233, 610]);
    for (let i = 0; i < 3; i += 1) await drag([195, 610], [275, 610]);
    await drag([233, 610], [95, 618]);
    await drag([95, 618], [205, 405]);
    expect((await state()).kitchen.pot).toBe('cooking');
  };
  const factory = async () => {
    await drag([58, 680], [82, 420]);
    for (let i = 0; i < 3; i += 1) await drag([55, 420], [120, 420]);
    await drag([82, 420], [306, 420]);
    await touch('touchStart', 306, 420);
    await page.waitForTimeout(1800);
    await touch('touchEnd', 306, 420);
    await page.waitForTimeout(200);
    await drag([306, 420], [205, 550]);
    for (let i = 0; i < 3; i += 1) await tap(205, 550);
  };
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  // Fresh Playwright context: no localStorage injection and no debug setState calls.
  await page.goto('/');
  await page.waitForFunction(() => '__MORI_DEBUG__' in window);
  await screenshot('01-front');
  await drag([315, 690], [70, 690]);
  await tap(98, 382);
  await tap(98, 382);
  expect((await state()).tutorial.step).toBe('cook');
  await screenshot('02-farm');
  await drag([90, 690], [315, 690]);
  await drag([195, 700], [195, 180]);
  await screenshot('03-kitchen');
  await cook();
  // Leave the kitchen while cooking: food must still burn after becoming ready.
  await drag([195, 150], [195, 700]);
  await page.waitForTimeout(23000);
  expect((await state()).kitchen.pot).toBe('burnt');
  await drag([195, 700], [195, 180]);
  await tap(205, 405);
  await cook();
  await page.waitForTimeout(10500);
  expect((await state()).kitchen.pot).toBe('ready');
  await screenshot('04-cooking');
  await tap(205, 405);
  await drag([300, 534], [342, 325]);
  expect((await state()).inventory.stew).toBe(1);
  await drag([195, 150], [195, 700]);
  await drag([96, 675], [195, 390]);
  expect((await state()).tutorial.step).toBe('make-part');
  await drag([195, 180], [195, 700]);
  await factory();
  expect((await state()).tutorial.step).toBe('start-beacon');
  await screenshot('05-factory');
  await drag([235, 280], [195, 165]);
  await drag([195, 700], [195, 180]);
  await drag([90, 740], [315, 740]);
  let zombie = (await state()).defense.zombies[0]!;
  await tap(zombie.x, 345 + zombie.lane * 142);
  zombie = (await state()).defense.zombies[0]!;
  await tap(zombie.x, 345 + zombie.lane * 142);
  await page.waitForTimeout(250);
  expect((await state()).tutorial.step).toBe('hold-zombie');
  zombie = (await state()).defense.zombies[0]!;
  await touch('touchStart', zombie.x, 345 + zombie.lane * 142);
  await page.waitForTimeout(1800);
  await touch('touchEnd', zombie.x, 345 + zombie.lane * 142);
  await page.waitForTimeout(250);
  expect((await state()).tutorial.step).toBe('repair-beacon');
  await drag([315, 740], [75, 740]);
  await drag([195, 180], [195, 700]);
  await drag([235, 280], [195, 165]);
  await factory();
  expect((await state()).tutorial.step).toBe('place-turret');
  await drag([195, 700], [195, 180]);
  await drag([90, 740], [315, 740]);
  await drag([286, 716], [108, 356]);
  expect((await state()).defense).toMatchObject({ turretPlaced: true, turretLane: 0 });
  expect((await state()).tutorial.step).toBe('complete');
  await screenshot('06-defense');
  await page.waitForTimeout(5500);
  await page.reload();
  await page.waitForFunction(() => '__MORI_DEBUG__' in window);
  expect((await state()).defense).toMatchObject({ turretPlaced: true, turretLane: 0 });
  expect(errors).toEqual([]);
});
