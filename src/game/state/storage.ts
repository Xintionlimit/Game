import { createInitialState } from './createInitialState';
import { SAVE_VERSION, type GameState } from './model';

export const SAVE_KEY = 'mori-courtyard-save';
const BACKUP_KEY = `${SAVE_KEY}-backup`;

function isGameState(value: unknown): value is GameState {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<GameState>;
  return candidate.saveVersion === SAVE_VERSION && Boolean(candidate.runtime && candidate.world && candidate.tutorial);
}

export function loadGame(storage: Pick<Storage, 'getItem' | 'setItem'> = localStorage): GameState {
  const raw = storage.getItem(SAVE_KEY);
  if (!raw) return createInitialState();

  try {
    const parsed: unknown = JSON.parse(raw);
    return isGameState(parsed) ? parsed : createInitialState();
  } catch {
    return createInitialState();
  }
}

export function saveGame(state: GameState, storage: Pick<Storage, 'getItem' | 'setItem'> = localStorage): void {
  const previous = storage.getItem(SAVE_KEY);
  if (previous) storage.setItem(BACKUP_KEY, previous);
  storage.setItem(SAVE_KEY, JSON.stringify(state));
}

export function createCheckpoint(state: GameState): void {
  const snapshot = structuredClone(state);
  snapshot.checkpoint.state = null;
  state.checkpoint.state = snapshot;
}

export function restoreCheckpoint(state: GameState): GameState {
  const checkpoint = state.checkpoint.state;
  if (!checkpoint) {
    const fresh = createInitialState();
    fresh.tutorial.step = state.tutorial.step;
    return fresh;
  }

  const restored = structuredClone(checkpoint);
  restored.checkpoint.state = structuredClone(checkpoint);
  return restored;
}
