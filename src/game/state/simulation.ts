import type { GameState, ZombieState } from './model';

const COOK_SECONDS = 10;
const BURN_SECONDS = 22;

function createZombie(state: GameState, kind: ZombieState['kind'], lane: number): ZombieState {
  const brute = kind === 'brute';
  const tutorial = kind === 'tap-tutorial' || kind === 'hold-tutorial';
  return {
    id: state.defense.nextZombieId++,
    lane,
    x: 340,
    hp: brute ? 12 : tutorial ? (kind === 'tap-tutorial' ? 2 : 5) : 4,
    maxHp: brute ? 12 : tutorial ? (kind === 'tap-tutorial' ? 2 : 5) : 4,
    kind,
    speed: tutorial ? 3 : brute ? 4 : 7,
  };
}

export function spawnTutorialZombie(state: GameState, kind: 'tap-tutorial' | 'hold-tutorial'): void {
  state.defense.zombies.push(createZombie(state, kind, kind === 'tap-tutorial' ? 0 : 1));
}

export function tickSimulation(state: GameState, deltaSeconds: number): void {
  if (state.runtime.paused || deltaSeconds <= 0) return;
  const delta = deltaSeconds;

  state.runtime.totalSeconds += delta;
  state.runtime.timeInDay += delta;
  while (state.runtime.timeInDay >= state.runtime.dayLength) {
    state.runtime.timeInDay -= state.runtime.dayLength;
    state.runtime.day += 1;
  }
  const hour = state.runtime.timeInDay / state.runtime.dayLength * 24;
  // A night belongs to the day on which it began, including after midnight.
  const nightDay = hour < 6 ? state.runtime.day - 1 : state.runtime.day;
  state.runtime.bloodMoon = nightDay > 0 && nightDay % 7 === 0 && (hour >= 19 || hour < 6);

  for (const plot of state.farm.plots) {
    if (plot.stage !== 'growing') continue;
    if (state.progression.watering) plot.watered = true;
    const effectiveGrowSeconds = plot.watered ? plot.growSeconds * 0.65 : plot.growSeconds;
    if (state.runtime.totalSeconds - plot.plantedAt >= effectiveGrowSeconds) plot.stage = 'ready';
  }

  if (state.progression.cutter && state.kitchen.board === 'whole') {
    state.kitchen.cuts += delta * 2;
    if (state.kitchen.cuts >= 3) state.kitchen.board = 'chopped';
  }

  if (state.kitchen.pot === 'cooking' || state.kitchen.pot === 'ready') {
    const elapsed = state.runtime.totalSeconds - state.kitchen.cookStartedAt;
    if (elapsed >= BURN_SECONDS) state.kitchen.pot = 'burnt';
    else if (elapsed >= COOK_SECONDS) state.kitchen.pot = 'ready';
  }

  if (state.tutorial.completed) {
    const front = state.front;
    if (front.quotaDay !== state.runtime.day) {
      front.quotaDay = state.runtime.day;
      front.dayServed = 0;
      front.nextAt = state.runtime.totalSeconds + 3;
    }
    const night = hour >= 19 || hour < 6;
    if (front.active) {
      front.patience -= delta;
      if (front.patience <= 0 || night) {
        front.failed += 1;
        front.active = false;
        front.nextAt = state.runtime.totalSeconds + 3;
        if (state.beacon.initialSignal) state.defense.zombies.push(createZombie(state, 'refugee', state.defense.nextZombieId % 3));
      }
    } else if (!night && front.dayServed < Math.min(6, state.world.houseLevel + 2) && state.runtime.totalSeconds >= front.nextAt) {
      front.active = true;
      front.visitorId += 1;
      front.patience = front.maxPatience;
    }
  }

  const tutorialActive = state.tutorial.step === 'tap-zombie' || state.tutorial.step === 'hold-zombie';
  if (!tutorialActive && state.beacon.initialSignal) {
    const beaconThreat = state.beacon.nextThreatDay !== null && state.runtime.day >= state.beacon.nextThreatDay
      ? state.world.beaconStage * 0.15 : 0;
    state.defense.spawnCooldown -= delta * (state.runtime.bloodMoon ? 2 : 1);
    if (state.defense.spawnCooldown <= 0) {
      const kind = state.runtime.bloodMoon && state.defense.nextZombieId % 5 === 0 ? 'brute' : 'walker';
      state.defense.zombies.push(createZombie(state, kind, (state.defense.nextZombieId - 1) % 3));
      const night = hour >= 19 || hour < 6;
      state.defense.spawnCooldown = (state.runtime.bloodMoon ? 10 : night ? 12 : 15) / (1 + Math.min(0.5, beaconThreat));
    }
  }

  for (const zombie of state.defense.zombies) {
    const tower = state.defense.towers.find(item => item.lane === zombie.lane && item.hp > 0);
    if (tower && zombie.x <= 115) {
      tower.hp = Math.max(0, tower.hp - delta * (zombie.kind === 'brute' ? 4 : 2));
      continue;
    }
    const barrier = state.defense.barricades[zombie.lane] ?? 0;
    if (barrier > 0 && zombie.x <= 70) {
      state.defense.barricades[zombie.lane] = Math.max(0, barrier - delta * (zombie.kind === 'brute' ? 6 : 3));
      continue;
    }
    zombie.x = Math.max(32, zombie.x - zombie.speed * delta);
    if (zombie.x <= 32) {
      state.world.houseHp = Math.max(0, state.world.houseHp - delta * (zombie.kind === 'brute' ? 7 : 3));
    }
  }

  for (const tower of state.defense.towers) {
    if (tower.repairAt !== null && state.runtime.totalSeconds >= tower.repairAt) {
      tower.hp = tower.maxHp;
      tower.repairAt = null;
    }
    if (tower.hp <= 0) continue;
    tower.cooldown -= delta;
    const targets = state.defense.zombies.filter(zombie => zombie.lane === tower.lane && zombie.hp > 0);
    if (tower.cooldown <= 0 && targets.length > 0) {
      const target = targets.reduce((closest, zombie) => (zombie.x < closest.x ? zombie : closest));
      target.hp -= 1;
      tower.cooldown = 0.48 / (1 + (tower.level - 1) * 0.2);
    }
  }
  if (state.defense.houseRepairAt !== null && state.runtime.totalSeconds >= state.defense.houseRepairAt) {
    state.world.houseHp = state.world.houseMaxHp;
    state.defense.barricades = [60, 60, 60];
    state.defense.houseRepairAt = null;
  }
  if (state.defense.reloadAt !== null && state.runtime.totalSeconds >= state.defense.reloadAt) {
    state.defense.ammo = 10;
    state.defense.reloadAt = null;
  }
  if (state.progression.rescueAt !== null && state.runtime.totalSeconds >= state.progression.rescueAt) state.progression.rescued = true;
}

export function removeDefeatedZombies(state: GameState): ZombieState[] {
  const defeated = state.defense.zombies.filter((zombie) => zombie.hp <= 0);
  if (defeated.length === 0) return defeated;
  state.defense.zombies = state.defense.zombies.filter((zombie) => zombie.hp > 0);
  state.defense.kills += defeated.length;
  state.inventory.scrap += defeated.filter((zombie) => zombie.kind !== 'refugee' && (!zombie.kind.includes('tutorial') || zombie.kind === 'hold-tutorial')).length;
  return defeated;
}
