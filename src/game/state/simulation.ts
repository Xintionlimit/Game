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
  state.runtime.bloodMoon = state.runtime.day % 7 === 0 && (hour >= 19 || hour < 6);

  for (const plot of state.farm.plots) {
    if (plot.stage !== 'growing') continue;
    const effectiveGrowSeconds = plot.watered ? plot.growSeconds * 0.65 : plot.growSeconds;
    if (state.runtime.totalSeconds - plot.plantedAt >= effectiveGrowSeconds) plot.stage = 'ready';
  }

  if (state.kitchen.pot === 'cooking' || state.kitchen.pot === 'ready') {
    const elapsed = state.runtime.totalSeconds - state.kitchen.cookStartedAt;
    if (elapsed >= BURN_SECONDS) state.kitchen.pot = 'burnt';
    else if (elapsed >= COOK_SECONDS) state.kitchen.pot = 'ready';
  }

  if (state.tutorial.step !== 'go-farm' && state.tutorial.step !== 'harvest') {
    state.front.patience -= delta;
    if (state.front.patience <= 0) {
      state.front.failed += 1;
      state.front.visitorId += 1;
      state.front.patience = state.front.maxPatience;
    }
  }

  const tutorialActive = state.tutorial.step === 'tap-zombie' || state.tutorial.step === 'hold-zombie';
  if (!tutorialActive && state.beacon.initialSignal) {
    const beaconThreat = state.beacon.nextThreatDay !== null && state.runtime.day >= state.beacon.nextThreatDay
      ? state.world.beaconStage * 0.15 : 0;
    state.defense.spawnCooldown -= delta * (state.runtime.bloodMoon ? 2 : 1);
    if (state.defense.spawnCooldown <= 0) {
      const kind = state.runtime.bloodMoon && state.defense.kills % 4 === 0 ? 'brute' : 'walker';
      state.defense.zombies.push(createZombie(state, kind, Math.floor(Math.random() * 3)));
      state.defense.spawnCooldown = (state.runtime.bloodMoon ? 7 : 14) / (1 + beaconThreat);
    }
  }

  for (const zombie of state.defense.zombies) {
    zombie.x = Math.max(32, zombie.x - zombie.speed * delta);
    if (zombie.x <= 32) {
      state.world.houseHp = Math.max(0, state.world.houseHp - delta * (zombie.kind === 'brute' ? 7 : 3));
    }
  }

  if (state.defense.turretPlaced && state.defense.zombies.length > 0) {
    state.defense.turretCooldown -= delta;
    if (state.defense.turretCooldown <= 0) {
      const target = state.defense.zombies.reduce((closest, zombie) => (zombie.x < closest.x ? zombie : closest));
      target.hp -= 1;
      state.defense.turretCooldown = 0.6;
    }
  }
}

export function removeDefeatedZombies(state: GameState): ZombieState[] {
  const defeated = state.defense.zombies.filter((zombie) => zombie.hp <= 0);
  if (defeated.length === 0) return defeated;
  state.defense.zombies = state.defense.zombies.filter((zombie) => zombie.hp > 0);
  state.defense.kills += defeated.length;
  state.inventory.scrap += defeated.filter((zombie) => !zombie.kind.includes('tutorial') || zombie.kind === 'hold-tutorial').length;
  return defeated;
}
