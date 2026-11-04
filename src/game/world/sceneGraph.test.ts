import { describe, expect, it } from 'vitest';

import { canMoveBetweenScenes, sceneNeighbors, worldScenes } from './sceneGraph';

describe('十字世界邻接规则', () => {
  it('包含手册规定的五个场景', () => {
    expect(worldScenes).toEqual(['front', 'defense', 'farm', 'factory', 'kitchen']);
  });

  it('中心连接四个外围场景', () => {
    expect(sceneNeighbors.front).toHaveLength(4);
    expect(sceneNeighbors.front).toEqual(expect.arrayContaining(['defense', 'farm', 'factory', 'kitchen']));
  });

  it('外围场景只能先回到中心', () => {
    expect(canMoveBetweenScenes('farm', 'front')).toBe(true);
    expect(canMoveBetweenScenes('farm', 'factory')).toBe(false);
    expect(canMoveBetweenScenes('defense', 'kitchen')).toBe(false);
  });
});
