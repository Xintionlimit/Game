import { expect, test, type Page } from '@playwright/test';

// A damaged-save fixture isolates repair input and cross-scene timing. The separate
// 22-minute production playthrough never injects resources, damage or progress.
async function snapshot(page: Page) {
  return page.evaluate(() => (window as typeof window & { __MORI_DEBUG__: { getState: () => {
    world: { scene: string; beaconStage: number };
    tutorial: { step: string; completed: boolean };
    inventory: { scrap: number; repairTools: number; carrots: number };
    factory: { phase: string };
    kitchen: { board: string; pot: string };
    progression: { cutter: boolean };
    defense: { towers: { lane: number; hp: number; maxHp: number; level: number; cooldown: number; repairAt: number | null }[]; turretPlaced: boolean };
  } } }).__MORI_DEBUG__.getState());
}
async function setup(page: Page) {
  await page.goto('/');
  await page.waitForFunction(() => '__MORI_DEBUG__' in window);
}
async function drag(page: Page, a: [number, number], b: [number, number]) {
  await page.mouse.move(...a); await page.mouse.down(); await page.mouse.move(...b, { steps: 10 }); await page.mouse.up(); await page.waitForTimeout(400);
}
test('受损炮塔点击维修：只扣一份工具，切场景后六秒恢复且保留等级', async ({ page }) => {
  test.setTimeout(60_000);
  await setup(page);
  await page.evaluate(() => {
    const debug = (window as typeof window & { __MORI_DEBUG__: { getState: () => FixtureState; setState: (state: FixtureState) => void } }).__MORI_DEBUG__;
    const state = debug.getState();
    state.world.scene = 'defense'; state.tutorial.step = 'complete'; state.tutorial.completed = true;
    state.inventory.repairTools = 1; state.defense.turretPlaced = true;
    state.defense.towers = [{ lane: 0, hp: 0, maxHp: 80, level: 2, cooldown: 0, repairAt: null }];
    debug.setState(state);
  });
  await page.waitForTimeout(200);
  await page.mouse.click(108, 356);
  await page.mouse.click(108, 356);
  expect((await snapshot(page)).inventory.repairTools).toBe(0);
  expect((await snapshot(page)).defense.towers[0]?.hp).toBe(0);
  await drag(page, [320, 740], [70, 740]);
  expect((await snapshot(page)).world.scene).toBe('front');
  await page.waitForTimeout(6500);
  const repaired = (await snapshot(page)).defense.towers[0];
  expect(repaired).toMatchObject({ hp: 80, level: 2, lane: 0, repairAt: null });
});

type FixtureState = Awaited<ReturnType<typeof snapshot>>;

test('后续生产选择、取消返料与自动切菜不能擅自下锅', async ({ page }) => {
  test.setTimeout(90_000);
  await setup(page);
  await page.evaluate(() => {
    const debug = (window as typeof window & { __MORI_DEBUG__: { getState: () => FixtureState; setState: (state: FixtureState) => void } }).__MORI_DEBUG__;
    const state = debug.getState();
    state.world.scene = 'factory'; state.world.beaconStage = 2;
    state.tutorial.step = 'complete'; state.tutorial.completed = true;
    state.inventory.scrap = 3; state.inventory.carrots = 2;
    debug.setState(state);
  });
  await page.waitForTimeout(250);
  await page.mouse.click(339, 675);
  await drag(page, [58, 680], [82, 420]);
  expect((await snapshot(page)).inventory.scrap).toBe(0);
  await page.mouse.click(335, 610);
  expect((await snapshot(page)).inventory.scrap).toBe(3);
  await page.mouse.click(287, 675);
  await drag(page, [58, 680], [82, 420]);
  for (let i = 0; i < 3; i++) await drag(page, [55, 420], [120, 420]);
  await drag(page, [82, 420], [306, 420]);
  await page.mouse.move(306, 420); await page.mouse.down(); await page.waitForTimeout(1800); await page.mouse.up(); await page.waitForTimeout(250);
  await drag(page, [306, 420], [205, 550]);
  for (let i = 0; i < 3; i++) { await page.mouse.click(205, 550); await page.waitForTimeout(170); }
  expect((await snapshot(page)).progression.cutter).toBe(true);
  await drag(page, [195, 740], [195, 180]);
  await drag(page, [195, 710], [195, 180]);
  await drag(page, [58, 535], [233, 610]);
  await page.waitForTimeout(2000);
  const cooked = await snapshot(page);
  expect(cooked.kitchen.board).toBe('chopped');
  expect(cooked.kitchen.pot).toBe('empty');
  expect(cooked.inventory.carrots).toBe(1);
});
