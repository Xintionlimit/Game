import { describe, expect, it } from 'vitest';

import { createInitialState } from './createInitialState';
import { removeDefeatedZombies, spawnTutorialZombie, tickSimulation } from './simulation';
import { createCheckpoint, loadGame, restoreCheckpoint, saveGame, SAVE_KEY } from './storage';

class MemoryStorage {
  private values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

describe('统一时间与并行系统', () => {
  it('切换场景不会停止作物和烹饪', () => {
    const state = createInitialState();
    state.farm.plots[1] = { stage: 'growing', plantedAt: 0, growSeconds: 2, watered: false };
    state.kitchen.pot = 'cooking';
    state.kitchen.cookStartedAt = 0;
    state.world.scene = 'front';

    for (let index = 0; index < 110; index += 1) tickSimulation(state, 0.1);

    expect(state.farm.plots[1]?.stage).toBe('ready');
    expect(state.kitchen.pot).toBe('ready');
  });

  it('后台暂停时所有有效时间停止', () => {
    const state = createInitialState();
    state.runtime.paused = true;
    tickSimulation(state, 30);
    expect(state.runtime.totalSeconds).toBe(0);
    expect(state.runtime.timeInDay).toBe(60);
  });

  it('第七天白天不触发血月，夜晚才触发且保留残敌', () => {
    const state = createInitialState();
    state.runtime.day = 6;
    state.runtime.timeInDay = state.runtime.dayLength - 0.05;
    tickSimulation(state, 0.1);
    expect(state.runtime.day).toBe(7);
    expect(state.runtime.bloodMoon).toBe(false);
    state.runtime.timeInDay = 80;
    tickSimulation(state, 0.1);
    expect(state.runtime.bloodMoon).toBe(false);
    state.runtime.timeInDay = state.runtime.dayLength * 20 / 24;
    tickSimulation(state, 0.1);
    expect(state.runtime.bloodMoon).toBe(true);
  });

  it('第七夜血月跨午夜持续，到第八天清晨才结束', () => {
    const state = createInitialState();
    state.runtime.day = 7;
    state.runtime.timeInDay = state.runtime.dayLength - 0.05;
    tickSimulation(state, 0.1);
    expect(state.runtime.day).toBe(8);
    expect(state.runtime.bloodMoon).toBe(true);
    state.runtime.timeInDay = state.runtime.dayLength * 6 / 24;
    tickSimulation(state, 0.1);
    expect(state.runtime.bloodMoon).toBe(false);
  });

  it('熟食在跨场景放置超过22秒后会糊锅', () => {
    const state = createInitialState();
    state.kitchen.pot = 'cooking';
    state.kitchen.cookStartedAt = 0;
    for (let i = 0; i < 11; i += 1) tickSimulation(state, 1);
    expect(state.kitchen.pot).toBe('ready');
    state.world.scene = 'farm';
    for (let i = 0; i < 12; i += 1) tickSimulation(state, 1);
    expect(state.kitchen.pot).toBe('burnt');
  });

  it('抵达房屋的僵尸持续攻击而不是被弹回道路', () => {
    const state = createInitialState();
    spawnTutorialZombie(state, 'tap-tutorial');
    state.defense.zombies[0]!.x = 32;
    state.defense.barricades[0] = 0;
    for (let i = 0; i < 60; i += 1) tickSimulation(state, 1 / 60);
    expect(state.world.houseHp).toBeCloseTo(97);
    expect(state.defense.zombies[0]!.x).toBe(32);
  });
});

describe('新手战斗', () => {
  it('严格生成点射和长按两种教学僵尸', () => {
    const state = createInitialState();
    spawnTutorialZombie(state, 'tap-tutorial');
    spawnTutorialZombie(state, 'hold-tutorial');
    expect(state.defense.zombies.map((zombie) => zombie.kind)).toEqual(['tap-tutorial', 'hold-tutorial']);
  });

  it('教学击杀与正常掉落分开结算', () => {
    const state = createInitialState();
    spawnTutorialZombie(state, 'tap-tutorial');
    spawnTutorialZombie(state, 'hold-tutorial');
    state.defense.zombies.forEach((zombie) => {
      zombie.hp = 0;
    });
    const defeated = removeDefeatedZombies(state);
    expect(defeated).toHaveLength(2);
    expect(state.inventory.scrap).toBe(3);
  });
});

describe('版本化存档与检查点', () => {
  it('保存后可以恢复同一份状态', () => {
    const storage = new MemoryStorage();
    const state = createInitialState();
    state.inventory.carrots = 7;
    saveGame(state, storage);
    expect(loadGame(storage).inventory.carrots).toBe(7);
  });

  it('损坏存档安全回到全新状态', () => {
    const storage = new MemoryStorage();
    storage.setItem(SAVE_KEY, '{bad json');
    expect(loadGame(storage).saveVersion).toBe(2);
  });

  it('房屋失败恢复正式信标检查点', () => {
    const state = createInitialState();
    state.world.beaconStage = 1;
    state.inventory.scrap = 5;
    createCheckpoint(state);
    state.inventory.scrap = 0;
    state.world.houseHp = 0;
    const restored = restoreCheckpoint(state);
    expect(restored.world.beaconStage).toBe(1);
    expect(restored.inventory.scrap).toBe(5);
  });
});
