import type { WorldScene } from '../world/sceneGraph';

export const SAVE_VERSION = 1;

export type CropStage = 'empty' | 'growing' | 'ready';
export type PotState = 'empty' | 'cooking' | 'ready' | 'burnt';
export type FactoryPhase = 'idle' | 'cutting' | 'cut' | 'welding' | 'welded' | 'assembly' | 'complete';
export type TutorialStep =
  | 'go-farm'
  | 'harvest'
  | 'plant'
  | 'cook'
  | 'serve'
  | 'make-part'
  | 'start-beacon'
  | 'tap-zombie'
  | 'hold-zombie'
  | 'repair-beacon'
  | 'make-turret'
  | 'place-turret'
  | 'complete';

export interface FarmPlot {
  stage: CropStage;
  plantedAt: number;
  growSeconds: number;
  watered: boolean;
}

export interface ZombieState {
  id: number;
  lane: number;
  x: number;
  hp: number;
  maxHp: number;
  kind: 'tap-tutorial' | 'hold-tutorial' | 'walker' | 'brute';
  speed: number;
}

export interface GameState {
  saveVersion: number;
  runtime: {
    totalSeconds: number;
    day: number;
    timeInDay: number;
    dayLength: number;
    paused: boolean;
    bloodMoon: boolean;
  };
  world: {
    scene: WorldScene;
    houseLevel: number;
    houseXp: number;
    houseHp: number;
    houseMaxHp: number;
    beaconStage: number;
    threatFromDay: number;
  };
  inventory: {
    carrots: number;
    stew: number;
    scrap: number;
    parts: number;
    repairTools: number;
  };
  farm: {
    plots: FarmPlot[];
    automationLevel: number;
  };
  kitchen: {
    board: 'empty' | 'whole' | 'chopped';
    cuts: number;
    bowlPieces: number;
    pot: PotState;
    cookStartedAt: number;
    plateReady: boolean;
    cabinetCapacity: number;
  };
  front: {
    visitorId: number;
    patience: number;
    maxPatience: number;
    served: number;
    failed: number;
  };
  factory: {
    phase: FactoryPhase;
    progress: number;
    turretJob: boolean;
  };
  beacon: {
    initialSignal: boolean;
    nextThreatDay: number | null;
  };
  defense: {
    zombies: ZombieState[];
    nextZombieId: number;
    turretBlueprint: boolean;
    turretBuilt: boolean;
    turretPlaced: boolean;
    turretCooldown: number;
    spawnCooldown: number;
    kills: number;
  };
  tutorial: {
    step: TutorialStep;
    completed: boolean;
  };
  checkpoint: {
    state: GameState | null;
  };
}
