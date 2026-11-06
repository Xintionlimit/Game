import { SAVE_VERSION, type FarmPlot, type GameState } from './model';

function createPlots(): FarmPlot[] {
  return Array.from({ length: 9 }, (_, index) => ({
    stage: index === 0 ? 'ready' : 'empty',
    plantedAt: 0,
    growSeconds: 35,
    watered: false,
  }));
}

export function createInitialState(): GameState {
  return {
    saveVersion: SAVE_VERSION,
    runtime: {
      totalSeconds: 0,
      day: 1,
      timeInDay: 60,
      dayLength: 180,
      paused: false,
      bloodMoon: false,
    },
    world: {
      scene: 'front',
      houseLevel: 1,
      houseXp: 0,
      houseHp: 100,
      houseMaxHp: 100,
      beaconStage: 0,
      threatFromDay: 2,
    },
    inventory: {
      carrots: 0,
      stew: 0,
      scrap: 2,
      parts: 0,
      repairTools: 0,
    },
    farm: {
      plots: createPlots(),
      automationLevel: 0,
    },
    kitchen: {
      board: 'empty',
      cuts: 0,
      bowlPieces: 0,
      pot: 'empty',
      cookStartedAt: 0,
      plateReady: false,
      cabinetCapacity: 3,
    },
    front: {
      visitorId: 1,
      patience: 60,
      maxPatience: 60,
      served: 0,
      failed: 0,
      active: true,
      dayServed: 0,
      quotaDay: 1,
      nextAt: 0,
    },
    factory: {
      phase: 'idle',
      progress: 0,
      turretJob: false,
      selected: 'part',
      product: 'part',
    },
    beacon: {
      initialSignal: false,
      nextThreatDay: null,
    },
    defense: {
      zombies: [],
      nextZombieId: 1,
      turretBlueprint: false,
      turretBuilt: false,
      turretPlaced: false,
      turretCooldown: 0,
      spawnCooldown: 12,
      kills: 0,
      kits: 0,
      towers: [],
      barricades: [60, 60, 60],
      houseRepairAt: null,
      ammo: 10,
      reloadAt: null,
      nextShotAt: 0,
    },
    progression: { watering: false, cutter: false, rescued: false, rescueAt: null },
    tutorial: {
      step: 'go-farm',
      completed: false,
    },
    checkpoint: {
      state: null,
    },
  };
}
