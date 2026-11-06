import type { GameState, Product, ZombieState } from './model';
import { createCheckpoint } from './storage';

export const products: Record<Product, { name: string; icon: string; cost: number; beacon: number }> = {
  part: { name: '信标零件', icon: 'part', cost: 1, beacon: 0 },
  turret: { name: '机枪塔', icon: 'turret', cost: 2, beacon: 1 },
  tools: { name: '维修工具', icon: 'toolbox', cost: 1, beacon: 1 },
  cutter: { name: '自动切菜', icon: 'chopped', cost: 3, beacon: 2 },
  watering: { name: '自动灌溉', icon: 'seeds', cost: 3, beacon: 2 },
};

export function startProduction(state: GameState): string | null {
  const step = state.tutorial.step;
  if (!['make-part', 'make-turret', 'complete'].includes(step)) return '先完成种菜、做饭和出餐';
  if (state.factory.phase !== 'idle') return '当前加工尚未完成';
  const product = step === 'make-turret' ? 'turret' : step === 'make-part' ? 'part' : state.factory.selected;
  const spec = products[product];
  if (state.world.beaconStage < spec.beacon) return `信标达到 ${spec.beacon} 阶后解锁`;
  if (product === 'turret' && state.defense.towers.length + state.defense.kits >= 3) return '三座炮塔已备齐';
  if (product === 'cutter' && state.progression.cutter) return '自动切菜机已安装';
  if (product === 'watering' && state.progression.watering) return '自动灌溉已安装';
  // The first tower uses the last tutorial material; later towers cost two scrap.
  const cost = step === 'make-turret' ? 1 : spec.cost;
  if (state.inventory.scrap < cost) return `需要 ${cost} 份废料，去防线击杀僵尸收集`;
  state.inventory.scrap -= cost;
  state.factory.product = product;
  state.factory.turretJob = product === 'turret';
  state.factory.phase = 'cutting';
  state.factory.progress = 0;
  return null;
}

export function cancelProduction(state: GameState): boolean {
  if (state.factory.phase === 'idle') return false;
  const cost = state.tutorial.step === 'make-turret' ? 1 : products[state.factory.product].cost;
  state.inventory.scrap += cost;
  state.factory.phase = 'idle';
  state.factory.progress = 0;
  return true;
}

export function finishProduction(state: GameState): string {
  const product = state.factory.product;
  if (product === 'turret') {
    state.defense.kits += 1;
    state.defense.turretBuilt = true;
    if (state.tutorial.step === 'make-turret') state.tutorial.step = 'place-turret';
  } else if (product === 'tools') state.inventory.repairTools += 3;
  else if (product === 'watering') state.progression.watering = true;
  else if (product === 'cutter') state.progression.cutter = true;
  else {
    state.inventory.parts += 1;
    if (state.tutorial.step === 'make-part') state.tutorial.step = 'start-beacon';
  }
  state.factory.phase = 'idle';
  state.factory.progress = 0;
  state.factory.turretJob = false;
  return `${products[product].name}${product === 'cutter' || product === 'watering' ? '已安装' : '制作完成'}`;
}

export function placeTower(state: GameState, lane: number): boolean {
  if (state.defense.kits <= 0 || state.defense.towers.some(tower => tower.lane === lane)) return false;
  state.defense.kits -= 1;
  state.defense.towers.push({ lane, hp: 80, maxHp: 80, level: 1, cooldown: 0, repairAt: null });
  state.defense.turretPlaced = true;
  state.defense.turretLane = lane;
  if (state.tutorial.step === 'place-turret') {
    state.tutorial.step = 'complete';
    state.tutorial.completed = true;
  }
  return true;
}

export function serveMeal(state: GameState): boolean {
  if (!state.front.active || state.inventory.stew <= 0) return false;
  state.inventory.stew -= 1;
  state.front.served += 1;
  state.front.dayServed += 1;
  state.front.active = false;
  state.front.nextAt = state.runtime.totalSeconds + 3;
  state.front.patience = state.front.maxPatience;
  state.world.houseXp += 20;
  if (state.front.dayServed === Math.min(6, state.world.houseLevel + 2)) state.world.houseXp += 15;
  while (state.world.houseXp >= state.world.houseLevel * 60) {
    state.world.houseXp -= state.world.houseLevel * 60;
    state.world.houseLevel += 1;
    state.world.houseMaxHp += 20;
    state.world.houseHp = Math.min(state.world.houseMaxHp, state.world.houseHp + 20);
  }
  if (state.tutorial.step === 'serve') state.tutorial.step = 'make-part';
  return true;
}

export function upgradeBeacon(state: GameState): string {
  const next = state.world.beaconStage + 1;
  const cost = next === 2 ? 3 : 5;
  if (!state.tutorial.completed) return '先完成第一座炮塔';
  if (next > 3) return state.progression.rescued ? '救援已抵达，小院可以继续经营' : '信号已发出，守住防线等待救援';
  if (state.front.served < (next === 2 ? 3 : 8)) return `先累计救助 ${next === 2 ? 3 : 8} 位伙伴`;
  if (state.inventory.parts < cost) return `需要 ${cost} 个信标零件，当前 ${state.inventory.parts}`;
  state.inventory.parts -= cost;
  state.world.beaconStage = next;
  state.beacon.nextThreatDay = state.runtime.day + 1;
  if (next === 3) state.progression.rescueAt = state.runtime.totalSeconds + 90;
  createCheckpoint(state);
  return next === 2 ? '信标Ⅱ完成：自动切菜和灌溉图纸已解锁' : '求救信号已发出，守住防线 90 秒';
}

export function startRepair(state: GameState, lane?: number): string {
  const tower = lane === undefined ? null : state.defense.towers.find(item => item.lane === lane);
  if (tower?.repairAt !== null && tower?.repairAt !== undefined) return '正在维修，请稍候';
  if (!tower && state.defense.houseRepairAt !== null) return '房屋正在维修';
  if (state.inventory.repairTools <= 0) return '去工厂制作维修工具（1废料制作3份）';
  if (tower) {
    if (tower.repairAt !== null) return '正在维修，请稍候';
    if (tower.hp >= tower.maxHp) return '炮塔状态良好';
    tower.repairAt = state.runtime.totalSeconds + 6;
  } else {
    if (state.defense.houseRepairAt !== null) return '房屋正在维修';
    if (state.world.houseHp >= state.world.houseMaxHp && state.defense.barricades.every(hp => hp >= 60)) return '房屋和路障状态良好';
    state.defense.houseRepairAt = state.runtime.totalSeconds + 6;
  }
  state.inventory.repairTools -= 1;
  return '维修已开始，6秒后恢复耐久';
}

export function shoot(state: GameState, zombie: ZombieState): boolean {
  const d = state.defense;
  if (d.reloadAt !== null || state.runtime.totalSeconds < d.nextShotAt) return false;
  if (d.ammo <= 0) { d.reloadAt = state.runtime.totalSeconds + 1.5; return false; }
  d.ammo -= 1;
  d.nextShotAt = state.runtime.totalSeconds + 0.12;
  zombie.hp -= 1;
  if (d.ammo === 0) d.reloadAt = state.runtime.totalSeconds + 1.5;
  return true;
}

export function currentObjective(state: GameState): string {
  if (state.world.houseHp < state.world.houseMaxHp * 0.6) return '房屋受损：工厂制作工具，回防线点院门维修';
  if (state.runtime.bloodMoon) return '血月来袭 · 守住三条路，备好维修工具';
  if (state.front.served < 3) {
    const hour = state.runtime.timeInDay / state.runtime.dayLength * 24;
    if (hour >= 19 || hour < 6) return '夜间备餐、巡逻，清晨伙伴们会来用餐';
    return `安顿伙伴 · 累计出餐 ${state.front.served}/3`;
  }
  if (state.world.beaconStage < 2) return `修信标Ⅱ · 零件 ${Math.min(3, state.inventory.parts)}/3，工厂加工后点信标`;
  if (!state.progression.watering) return '解锁轻松种田 · 工厂选择自动灌溉并加工';
  if (!state.progression.cutter) return '厨房升级 · 工厂选择自动切菜并加工';
  if (state.defense.towers.length < 3) return `三路布防 · 机枪塔 ${state.defense.towers.length}/3，工厂继续制造`;
  if (state.front.served < 8) return `建立新家 · 累计救助伙伴 ${state.front.served}/8`;
  if (state.world.beaconStage < 3) return `发出求救 · 信标零件 ${Math.min(5, state.inventory.parts)}/5`;
  if (!state.progression.rescued) return `等待救援 · 坚守 ${Math.max(0, Math.ceil((state.progression.rescueAt ?? 0) - state.runtime.totalSeconds))} 秒`;
  return `伙伴已获救 · 第${state.runtime.day}天，继续经营和守护小院`;
}
