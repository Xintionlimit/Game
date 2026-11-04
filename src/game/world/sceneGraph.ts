export const worldScenes = ['front', 'defense', 'farm', 'factory', 'kitchen'] as const;

export type WorldScene = (typeof worldScenes)[number];

export const sceneLabels: Record<WorldScene, string> = {
  front: '中央前台',
  defense: '左侧防线',
  farm: '右侧农田',
  factory: '上方信标\n＋工厂',
  kitchen: '下方厨房',
};

export const scenePositions: Record<WorldScene, { x: number; y: number }> = {
  front: { x: 0, y: 0 },
  defense: { x: -1, y: 0 },
  farm: { x: 1, y: 0 },
  factory: { x: 0, y: -1 },
  kitchen: { x: 0, y: 1 },
};

export const sceneNeighbors: Record<WorldScene, readonly WorldScene[]> = {
  front: ['defense', 'farm', 'factory', 'kitchen'],
  defense: ['front'],
  farm: ['front'],
  factory: ['front'],
  kitchen: ['front'],
};

export function canMoveBetweenScenes(from: WorldScene, to: WorldScene): boolean {
  return sceneNeighbors[from].includes(to);
}
