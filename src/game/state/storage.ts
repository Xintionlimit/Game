import { createInitialState } from './createInitialState';
import { SAVE_VERSION, type GameState } from './model';

export const SAVE_KEY = 'mori-courtyard-save';
const BACKUP_KEY = `${SAVE_KEY}-backup`;
let persistent = true;
const memory = new Map<string, string>();
function defaultStorage(): Pick<Storage, 'getItem' | 'setItem'> {
  try { const storage = globalThis.localStorage; storage.getItem(SAVE_KEY); return storage; }
  catch { persistent = false; return { getItem: key => memory.get(key) ?? null, setItem: (key, value) => { memory.set(key, value); } }; }
}
export function storageIsPersistent(): boolean { return persistent; }

function migrateState(value: unknown, depth = 0): GameState | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as GameState;
  if (![1, SAVE_VERSION].includes(candidate.saveVersion) || !candidate.runtime || !candidate.world || !candidate.inventory || !candidate.farm?.plots || !candidate.kitchen || !candidate.front || !candidate.factory || !candidate.defense || !candidate.tutorial) return null;
  if (!Array.isArray(candidate.farm.plots) || candidate.farm.plots.length !== 9) return null;
  const defaults = createInitialState();
  const state: GameState = {
    ...defaults, ...candidate, saveVersion: SAVE_VERSION,
    runtime: { ...defaults.runtime, ...candidate.runtime, paused: false },
    world: { ...defaults.world, ...candidate.world },
    inventory: { ...defaults.inventory, ...candidate.inventory },
    farm: { ...defaults.farm, ...candidate.farm },
    kitchen: { ...defaults.kitchen, ...candidate.kitchen },
    front: { ...defaults.front, ...candidate.front },
    factory: { ...defaults.factory, ...candidate.factory },
    beacon: { ...defaults.beacon, ...candidate.beacon },
    defense: { ...defaults.defense, ...candidate.defense },
    progression: { ...defaults.progression, ...candidate.progression },
    checkpoint: { state: depth < 1 && candidate.checkpoint?.state ? migrateState(candidate.checkpoint.state, depth + 1) : null },
  };
  if (!Object.values(state.inventory).every(number => Number.isFinite(number) && number >= 0)) return null;
  if (candidate.saveVersion === 1) {
    if (candidate.defense.turretPlaced && state.defense.towers.length === 0) {
      state.defense.towers.push({ lane: candidate.defense.turretLane ?? 1, hp: 80, maxHp: 80, level: 1, cooldown: 0, repairAt: null });
    }
    if (candidate.defense.turretBuilt && !candidate.defense.turretPlaced) state.defense.kits = 1;
    if (state.factory.turretJob) state.factory.product = 'turret';
    state.front.active = !state.tutorial.completed;
    state.front.nextAt = state.runtime.totalSeconds + 3;
  }
  return state;
}

export function loadGame(storage: Pick<Storage, 'getItem' | 'setItem'> = defaultStorage()): GameState {
  for (const key of [SAVE_KEY, BACKUP_KEY]) {
    try {
      const raw = storage.getItem(key);
      if (!raw) continue;
      const migrated = migrateState(JSON.parse(raw));
      if (migrated) return migrated;
    } catch { /* Try the retained backup before starting a new world. */ }
  }
  return createInitialState();
}

export function saveGame(state: GameState, storage: Pick<Storage, 'getItem' | 'setItem'> = defaultStorage()): boolean {
  try {
  const previous = storage.getItem(SAVE_KEY);
  if (previous) {
    try { if (migrateState(JSON.parse(previous))) storage.setItem(BACKUP_KEY, previous); } catch { /* Keep the last valid backup. */ }
  }
  storage.setItem(SAVE_KEY, JSON.stringify(state));
  return true;
  } catch { persistent = false; return false; }
}

export function createCheckpoint(state: GameState): void {
  const snapshot = structuredClone(state);
  snapshot.checkpoint.state = null;
  state.checkpoint.state = snapshot;
}

export function restoreCheckpoint(state: GameState): GameState {
  const checkpoint = state.checkpoint.state;
  if (!checkpoint) {
    return createInitialState();
  }

  const restored = structuredClone(checkpoint);
  restored.checkpoint.state = structuredClone(checkpoint);
  return restored;
}
