import { describe, expect, it } from 'vitest';
import { createInitialState } from './createInitialState';
import { cancelProduction, finishProduction, placeTower, serveMeal, startProduction, startRepair, upgradeBeacon } from './rules';
import { tickSimulation } from './simulation';
import { loadGame, SAVE_KEY, saveGame } from './storage';

describe('生产与资源安全', () => {
  it('教学前不允许消耗废料，取消任务准确返还', () => {
    const state = createInitialState();
    expect(startProduction(state)).not.toBeNull();
    expect(state.inventory.scrap).toBe(2);
    state.tutorial.step = 'make-part';
    expect(startProduction(state)).toBeNull();
    expect(state.inventory.scrap).toBe(1);
    expect(cancelProduction(state)).toBe(true);
    expect(state.inventory.scrap).toBe(2);
    expect(cancelProduction(state)).toBe(false);
  });

  it('完成炮塔后必须实际放置，占用槽位不能重复吞塔', () => {
    const state = createInitialState();
    state.tutorial.step = 'make-turret';
    state.world.beaconStage = 1;
    expect(startProduction(state)).toBeNull();
    finishProduction(state);
    expect(state.defense.turretPlaced).toBe(false);
    expect(placeTower(state, 2)).toBe(true);
    expect(state.defense.towers[0]?.lane).toBe(2);
    state.defense.kits = 1;
    expect(placeTower(state, 2)).toBe(false);
    expect(state.defense.kits).toBe(1);
  });

  it('没有顾客时不允许扣餐，下一位顾客延迟到达', () => {
    const state = createInitialState();
    state.inventory.stew = 2;
    expect(serveMeal(state)).toBe(true);
    expect(serveMeal(state)).toBe(false);
    expect(state.inventory.stew).toBe(1);
    state.tutorial.completed = true;
    tickSimulation(state, 2);
    expect(state.front.active).toBe(false);
    tickSimulation(state, 1.1);
    expect(state.front.active).toBe(true);
  });
});

describe('持续经营与维修', () => {
  it('夜晚不继续刷新客人，过夜出餐保留', () => {
    const state = createInitialState();
    state.tutorial.completed = true;
    state.runtime.timeInDay = state.runtime.dayLength * 20 / 24;
    state.inventory.stew = 2;
    tickSimulation(state, 1);
    expect(state.front.active).toBe(false);
    expect(state.inventory.stew).toBe(2);
  });

  it('损坏炮塔保留归属，工具只扣一次且六秒后恢复', () => {
    const state = createInitialState();
    state.defense.kits = 1;
    placeTower(state, 0);
    state.defense.towers[0]!.hp = 0;
    state.inventory.repairTools = 1;
    startRepair(state, 0);
    startRepair(state, 0);
    expect(state.inventory.repairTools).toBe(0);
    tickSimulation(state, 5);
    expect(state.defense.towers[0]!.hp).toBe(0);
    tickSimulation(state, 1.1);
    expect(state.defense.towers[0]!.hp).toBe(80);
  });

  it('自动切菜只处理玩家投入的食材，不决定做饭或扣库存', () => {
    const state = createInitialState();
    state.progression.cutter = true;
    state.inventory.carrots = 4;
    tickSimulation(state, 5);
    expect(state.kitchen.board).toBe('empty');
    state.kitchen.board = 'whole';
    tickSimulation(state, 2);
    expect(state.kitchen.board).toBe('chopped');
    expect(state.kitchen.pot).toBe('empty');
    expect(state.inventory.carrots).toBe(4);
  });

  it('信标升级要求玩家交付部件，并建立可恢复检查点', () => {
    const state = createInitialState();
    state.tutorial.completed = true;
    state.world.beaconStage = 1;
    state.front.served = 3;
    state.inventory.parts = 3;
    upgradeBeacon(state);
    expect(state.world.beaconStage).toBe(2);
    expect(state.inventory.parts).toBe(0);
    expect(state.checkpoint.state?.world.beaconStage).toBe(2);
  });
});

describe('存档兼容', () => {
  const memory = () => {
    const data = new Map<string, string>();
    return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
  };
  it('v1存档保留资源与塔位，补齐v2系统', () => {
    const storage = memory();
    const legacy = createInitialState();
    legacy.saveVersion = 1;
    legacy.inventory.carrots = 23;
    legacy.defense.turretPlaced = true;
    legacy.defense.turretLane = 2;
    storage.setItem(SAVE_KEY, JSON.stringify(legacy));
    const loaded = loadGame(storage);
    expect(loaded.saveVersion).toBe(2);
    expect(loaded.inventory.carrots).toBe(23);
    expect(loaded.defense.towers[0]?.lane).toBe(2);
  });
  it('主档损坏时恢复最近有效备份，不清掉玩家进度', () => {
    const storage = memory();
    const state = createInitialState();
    state.inventory.parts = 7;
    saveGame(state, storage);
    state.inventory.parts = 8;
    saveGame(state, storage);
    storage.setItem(SAVE_KEY, '{damaged');
    expect(loadGame(storage).inventory.parts).toBe(7);
  });
});
