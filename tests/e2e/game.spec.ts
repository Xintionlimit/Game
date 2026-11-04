import { expect, test, type Page } from '@playwright/test';

interface SavedGame {
  runtime: { totalSeconds: number; paused: boolean };
  world: { scene: string; beaconStage: number };
  inventory: { carrots: number; stew: number; scrap: number; parts: number };
  kitchen: { board: string; bowlPieces: number; pot: string; plateReady: boolean; cookStartedAt: number };
  factory: { phase: string; progress: number };
  defense: { turretBlueprint: boolean; turretBuilt: boolean; turretPlaced: boolean; zombies: unknown[] };
  tutorial: { step: string };
}

async function openFreshGame(page: Page): Promise<void> {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('canvas')).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(700);
}

async function readSave(page: Page): Promise<SavedGame> {
  return page.evaluate(() => {
    const value = localStorage.getItem('mori-courtyard-save');
    if (!value) throw new Error('存档尚未写入');
    return JSON.parse(value) as SavedGame;
  });
}

async function readLiveState(page: Page): Promise<SavedGame> {
  return page.evaluate(() => {
    const debug = (
      window as typeof window & { __MORI_DEBUG__?: { getState: () => SavedGame; setState: (state: SavedGame) => void } }
    ).__MORI_DEBUG__;
    if (!debug) throw new Error('开发测试桥尚未就绪');
    return debug.getState();
  });
}

async function drag(page: Page, from: [number, number], to: [number, number], steps = 12): Promise<void> {
  await page.mouse.move(from[0], from[1]);
  await page.mouse.down();
  await page.mouse.move(to[0], to[1], { steps });
  await page.mouse.up();
  await page.waitForTimeout(350);
}

async function setLiveState(page: Page, mutate: (state: SavedGame) => void): Promise<void> {
  await page.evaluate((source) => {
    const debug = (
      window as typeof window & {
        __MORI_DEBUG__?: { getState: () => SavedGame; setState: (state: SavedGame) => void };
      }
    ).__MORI_DEBUG__;
    if (!debug) throw new Error('开发测试桥尚未就绪');
    const state = debug.getState();
    const apply = new Function('state', `return (${source})(state)`) as (state: SavedGame) => void;
    apply(state);
    debug.setState(state);
  }, mutate.toString());
  await page.waitForTimeout(250);
}

async function completeFactoryJob(page: Page): Promise<void> {
  await drag(page, [58, 680], [82, 515]);
  for (let cut = 0; cut < 3; cut += 1) await drag(page, [55, 515], [120, 515], 5);
  await drag(page, [82, 515], [306, 510]);
  await page.mouse.move(306, 510);
  await page.mouse.down();
  await page.waitForTimeout(1_750);
  await page.mouse.up();
  await page.waitForTimeout(250);
  await drag(page, [306, 510], [205, 615]);
  for (let bolt = 0; bolt < 3; bolt += 1) {
    await page.mouse.click(205, 615);
    await page.waitForTimeout(150);
  }
}

test('支持手册规定的四种竖屏尺寸', async ({ page }) => {
  const sizes = [
    { width: 320, height: 568 },
    { width: 375, height: 667 },
    { width: 390, height: 844 },
    { width: 430, height: 932 },
  ];
  for (const size of sizes) {
    await page.setViewportSize(size);
    await page.goto('/');
    const canvas = page.locator('canvas');
    await expect(canvas).toBeVisible();
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeLessThanOrEqual(size.width);
    expect(box!.height).toBeLessThanOrEqual(size.height);
  }
});

test('四向世界滑动、农田收获和刷新读档可用', async ({ page }) => {
  await openFreshGame(page);
  await drag(page, [315, 690], [70, 690]);
  await page.waitForTimeout(5_100);
  let save = await readSave(page);
  expect(save.world.scene).toBe('farm');
  expect(save.tutorial.step).toBe('harvest');

  await page.mouse.click(98, 382);
  await page.waitForTimeout(5_100);
  save = await readSave(page);
  expect(save.inventory.carrots).toBe(2);
  expect(save.tutorial.step).toBe('plant');

  await page.reload();
  await expect(page.locator('canvas')).toBeVisible();
  await page.waitForTimeout(700);
  save = await readSave(page);
  expect(save.world.scene).toBe('farm');
  expect(save.inventory.carrots).toBe(2);
});

test('厨房需要真实拖拽、划切、下锅、装盘和入柜', async ({ page }) => {
  test.setTimeout(60_000);
  await openFreshGame(page);
  await page.evaluate(() => {
    const debug = (
      window as typeof window & {
        __MORI_DEBUG__?: { getState: () => SavedGame; setState: (state: SavedGame) => void };
      }
    ).__MORI_DEBUG__;
    if (!debug) throw new Error('开发测试桥尚未就绪');
    const state = debug.getState();
    state.world.scene = 'kitchen';
    state.inventory.carrots = 1;
    state.tutorial.step = 'cook';
    debug.setState(state);
  });
  await page.waitForTimeout(250);

  await drag(page, [58, 535], [233, 610]);
  expect(await readLiveState(page)).toMatchObject({ inventory: { carrots: 0 }, kitchen: { board: 'whole' } });
  for (let cut = 0; cut < 3; cut += 1) await drag(page, [195, 610], [275, 610], 5);
  expect(await readLiveState(page)).toMatchObject({ kitchen: { board: 'chopped' } });
  await drag(page, [233, 610], [95, 618]);
  expect(await readLiveState(page)).toMatchObject({ kitchen: { board: 'empty', bowlPieces: 1 } });
  await drag(page, [95, 618], [205, 405]);
  expect(await readLiveState(page)).toMatchObject({ kitchen: { bowlPieces: 0, pot: 'cooking' } });
  await page.waitForTimeout(10_500);
  const cooked = await readLiveState(page);
  const cookElapsed = cooked.runtime.totalSeconds - cooked.kitchen.cookStartedAt;
  expect(cooked.kitchen.pot).toBe('ready');
  expect(cooked.runtime.paused).toBe(false);
  expect(cookElapsed).toBeGreaterThanOrEqual(10);
  expect(cookElapsed).toBeLessThan(22);
  await page.mouse.click(205, 405);
  await page.waitForTimeout(250);
  expect(await readLiveState(page)).toMatchObject({ kitchen: { pot: 'empty', plateReady: true } });
  await drag(page, [300, 534], [342, 325]);
  expect(await readLiveState(page)).toMatchObject({ inventory: { stew: 1 }, kitchen: { plateReady: false } });
  await page.waitForTimeout(5_100);

  const save = await readSave(page);
  expect(save).toMatchObject({
    inventory: { carrots: 0, stew: 1 },
    kitchen: { board: 'empty', bowlPieces: 0, pot: 'empty', plateReady: false },
    tutorial: { step: 'serve' },
  });
});

test('出餐、工厂、信标、两只教学僵尸和自动炮塔形成闭环', async ({ page }) => {
  test.setTimeout(60_000);
  await openFreshGame(page);
  await setLiveState(page, (state) => {
    state.world.scene = 'front';
    state.inventory.stew = 1;
    state.inventory.scrap = 2;
    state.tutorial.step = 'serve';
  });

  await drag(page, [96, 675], [195, 390]);
  expect(await readLiveState(page)).toMatchObject({ inventory: { stew: 0 }, tutorial: { step: 'make-part' } });

  await setLiveState(page, (state) => {
    state.world.scene = 'factory';
  });
  await completeFactoryJob(page);
  expect(await readLiveState(page)).toMatchObject({ inventory: { parts: 1 }, tutorial: { step: 'start-beacon' } });

  await drag(page, [235, 280], [195, 165]);
  expect(await readLiveState(page)).toMatchObject({ inventory: { parts: 0 }, tutorial: { step: 'tap-zombie' } });

  await drag(page, [195, 700], [195, 180]);
  await drag(page, [90, 650], [315, 650]);
  expect((await readLiveState(page)).world.scene).toBe('defense');
  await page.mouse.click(340, 345);
  await page.mouse.click(340, 345);
  await page.waitForTimeout(350);
  expect(await readLiveState(page)).toMatchObject({ tutorial: { step: 'hold-zombie' } });

  await page.mouse.move(340, 487);
  await page.mouse.down();
  await page.waitForTimeout(1_800);
  await page.mouse.up();
  await page.waitForTimeout(350);
  expect(await readLiveState(page)).toMatchObject({ tutorial: { step: 'repair-beacon' } });

  await drag(page, [315, 650], [75, 650]);
  await drag(page, [195, 180], [195, 700]);
  expect((await readLiveState(page)).world.scene).toBe('factory');
  await drag(page, [235, 280], [195, 165]);
  expect(await readLiveState(page)).toMatchObject({
    world: { beaconStage: 1 },
    defense: { turretBlueprint: true },
    tutorial: { step: 'make-turret' },
  });

  await completeFactoryJob(page);
  expect(await readLiveState(page)).toMatchObject({ defense: { turretBuilt: true }, tutorial: { step: 'place-turret' } });

  await drag(page, [195, 700], [195, 180]);
  await drag(page, [90, 650], [315, 650]);
  await drag(page, [286, 716], [108, 500]);
  expect(await readLiveState(page)).toMatchObject({
    defense: { turretPlaced: true },
    tutorial: { step: 'complete' },
  });
});
