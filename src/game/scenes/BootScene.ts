import Phaser from 'phaser';

const sceneAssets = ['front', 'defense', 'farm', 'factory', 'kitchen'] as const;
const spriteAssets = [
  'refugee',
  'zombie',
  'brute',
  'turret',
  'carrot',
  'chopped',
  'stew',
  'part',
  'seeds',
  'scrap',
  'barricade',
  'toolbox',
] as const;

export class BootScene extends Phaser.Scene {
  constructor() {
    super('boot');
  }

  preload(): void {
    const bar = this.add.rectangle(195, 430, 250, 12, 0x3c4b3e).setOrigin(0.5);
    const fill = this.add.rectangle(70, 430, 0, 12, 0xf0c879).setOrigin(0, 0.5);
    this.add
      .text(195, 378, '末日小院', {
        color: '#f7efd2',
        fontFamily: 'sans-serif',
        fontSize: '40px',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);
    this.add
      .text(195, 468, '正在整理院子……', {
        color: '#c5d5b8',
        fontFamily: 'sans-serif',
        fontSize: '16px',
      })
      .setOrigin(0.5);

    this.load.on('progress', (progress: number) => {
      fill.width = 250 * progress;
    });
    this.load.on('complete', () => {
      bar.destroy();
      fill.destroy();
    });

    for (const scene of sceneAssets) this.load.image(`scene-${scene}`, `assets/scenes/${scene}.webp`);
    for (const sprite of spriteAssets) this.load.image(sprite, `assets/sprites/${sprite}.png`);
  }

  create(): void {
    this.scene.start('main');
  }
}
