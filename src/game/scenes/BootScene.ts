import Phaser from 'phaser';

import { sceneLabels, scenePositions, type WorldScene } from '../world/sceneGraph';

export class BootScene extends Phaser.Scene {
  constructor() {
    super('boot');
  }

  create(): void {
    this.add
      .text(195, 92, '末日小院', {
        color: '#f7efd2',
        fontFamily: 'sans-serif',
        fontSize: '38px',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);

    this.add
      .text(195, 132, '开发环境基线 · v0.1.0', {
        color: '#c5d5b8',
        fontFamily: 'sans-serif',
        fontSize: '16px',
      })
      .setOrigin(0.5);

    this.drawWorldMap();

    this.add
      .text(195, 742, '十字世界已建立，玩法正在开发中', {
        color: '#f0c879',
        fontFamily: 'sans-serif',
        fontSize: '17px',
      })
      .setOrigin(0.5);
  }

  private drawWorldMap(): void {
    const centerX = 195;
    const centerY = 418;
    const step = 132;

    (Object.entries(scenePositions) as [WorldScene, { x: number; y: number }][]).forEach(
      ([scene, position]) => {
        const x = centerX + position.x * step;
        const y = centerY + position.y * step;
        const isFront = scene === 'front';

        this.add
          .rectangle(x, y, 112, 86, isFront ? 0xc47b3f : 0x48694f, 1)
          .setStrokeStyle(3, 0xf7efd2, 0.8);
        this.add
          .text(x, y, sceneLabels[scene], {
            align: 'center',
            color: '#ffffff',
            fontFamily: 'sans-serif',
            fontSize: '18px',
            fontStyle: isFront ? 'bold' : 'normal',
          })
          .setOrigin(0.5);
      },
    );
  }
}
