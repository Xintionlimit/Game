import Phaser from 'phaser';

import { createCheckpoint, loadGame, restoreCheckpoint, saveGame } from '../state/storage';
import { removeDefeatedZombies, spawnTutorialZombie, tickSimulation } from '../state/simulation';
import type { GameState, TutorialStep, ZombieState } from '../state/model';
import {
  canMoveBetweenScenes,
  sceneLabels,
  scenePositions,
  type WorldScene,
  worldScenes,
} from '../world/sceneGraph';

const VIEW_WIDTH = 390;
const VIEW_HEIGHT = 844;
const WORLD_OFFSET_X = VIEW_WIDTH;
const WORLD_OFFSET_Y = VIEW_HEIGHT;

const sceneOrigins: Record<WorldScene, { x: number; y: number }> = Object.fromEntries(
  worldScenes.map((scene) => [
    scene,
    {
      x: WORLD_OFFSET_X + scenePositions[scene].x * VIEW_WIDTH,
      y: WORLD_OFFSET_Y + scenePositions[scene].y * VIEW_HEIGHT,
    },
  ]),
) as Record<WorldScene, { x: number; y: number }>;

const tutorialObjectives: Record<TutorialStep, string> = {
  'go-farm': '向左滑动，去右侧农田看看',
  harvest: '点击成熟的胡萝卜收获',
  plant: '点击空地免费播种；再次点击可浇水',
  cook: '下滑回前台，再向上滑进厨房做菜',
  serve: '把成品拖给前台等待的难民',
  'make-part': '去上方工厂：拖入废料并完成切割、焊接、装配',
  'start-beacon': '把做好的零件拖到信标上',
  'tap-zombie': '去左侧防线，点击射击第一只教学僵尸',
  'hold-zombie': '按住第二只教学僵尸连续射击',
  'repair-beacon': '返回上方信标，把战利品拖到信标正式维修',
  'make-turret': '在工厂再次加工，制造机枪塔',
  'place-turret': '去防线，把机枪塔拖到任一道路基座',
  complete: '核心循环已打通：继续经营并守住小院',
};

type DragDropHandler = (worldX: number, worldY: number) => boolean;

export class MainScene extends Phaser.Scene {
  private state!: GameState;
  private currentScene: WorldScene = 'front';
  private dragging = new Set<Phaser.GameObjects.Image>();
  private swipeStart: { x: number; y: number; scrollX: number; scrollY: number; time: number } | null = null;
  private cutting = false;
  private cuttingDistance = 0;
  private lastCutPoint = new Phaser.Math.Vector2();
  private factoryCutting = false;
  private factoryCutDistance = 0;
  private lastFactoryCutPoint = new Phaser.Math.Vector2();
  private weldingHeld = false;
  private firingZombieId: number | null = null;
  private saveAccumulator = 0;
  private lastWallTime = 0;
  private lastUiRefresh = 0;
  private toastTween?: Phaser.Tweens.Tween;

  private farmSprites: Phaser.GameObjects.Image[] = [];
  private farmLabels: Phaser.GameObjects.Text[] = [];
  private kitchenCarrot!: Phaser.GameObjects.Image;
  private kitchenBoardItem!: Phaser.GameObjects.Image;
  private kitchenChoppedItem!: Phaser.GameObjects.Image;
  private kitchenBowlItem!: Phaser.GameObjects.Image;
  private kitchenPlate!: Phaser.GameObjects.Image;
  private kitchenPotText!: Phaser.GameObjects.Text;
  private kitchenCabinetText!: Phaser.GameObjects.Text;
  private frontStew!: Phaser.GameObjects.Image;
  private patienceFill!: Phaser.GameObjects.Rectangle;
  private visitorText!: Phaser.GameObjects.Text;
  private factoryScrap!: Phaser.GameObjects.Image;
  private factoryPiece!: Phaser.GameObjects.Image;
  private factoryText!: Phaser.GameObjects.Text;
  private beaconPart!: Phaser.GameObjects.Image;
  private beaconScrap!: Phaser.GameObjects.Image;
  private beaconText!: Phaser.GameObjects.Text;
  private turretKit!: Phaser.GameObjects.Image;
  private placedTurret!: Phaser.GameObjects.Image;
  private zombieSprites = new Map<number, Phaser.GameObjects.Image>();
  private zombieBars = new Map<number, Phaser.GameObjects.Rectangle>();

  private statusText!: Phaser.GameObjects.Text;
  private objectiveText!: Phaser.GameObjects.Text;
  private sceneText!: Phaser.GameObjects.Text;
  private inventoryText!: Phaser.GameObjects.Text;
  private dangerFill!: Phaser.GameObjects.Rectangle;
  private edgeHintText!: Phaser.GameObjects.Text;
  private toastText!: Phaser.GameObjects.Text;
  private nightOverlay!: Phaser.GameObjects.Rectangle;

  constructor() {
    super('main');
  }

  create(): void {
    this.state = loadGame();
    this.state.runtime.paused = document.hidden;
    this.lastWallTime = performance.now();
    this.currentScene = this.state.world.scene;
    this.cameras.main.setBounds(0, 0, VIEW_WIDTH * 3, VIEW_HEIGHT * 3);
    this.cameras.main.setViewport(0, 0, VIEW_WIDTH, VIEW_HEIGHT);

    this.createWorld();
    this.createFarmInteractions();
    this.createKitchenInteractions();
    this.createFrontInteractions();
    this.createFactoryInteractions();
    this.createBeaconInteractions();
    this.createDefenseInteractions();
    this.createHud();
    this.createSwipeInput();
    this.installDebugBridge();

    const origin = sceneOrigins[this.currentScene];
    this.cameras.main.setScroll(origin.x, origin.y);
    this.applyTutorialSceneArrival(this.currentScene);

    document.addEventListener('visibilitychange', this.handleVisibility);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      document.removeEventListener('visibilitychange', this.handleVisibility);
      saveGame(this.state);
    });
  }

  update(time: number, _deltaMs: number): void {
    const now = performance.now();
    const elapsedMs = Math.max(0, now - this.lastWallTime);
    this.lastWallTime = now;
    const deltaSeconds = elapsedMs / 1000;
    tickSimulation(this.state, deltaSeconds);

    if (this.weldingHeld && this.state.factory.phase === 'welding') {
      this.state.factory.progress += deltaSeconds;
      if (this.state.factory.progress >= 1.5) {
        this.state.factory.phase = 'welded';
        this.state.factory.progress = 0;
        this.weldingHeld = false;
        this.showToast('焊点完成，把零件拖到装配台');
      }
    }

    if (this.firingZombieId !== null) {
      const target = this.state.defense.zombies.find((zombie) => zombie.id === this.firingZombieId);
      if (target) target.hp -= deltaSeconds * 3.5;
    }

    const defeated = removeDefeatedZombies(this.state);
    this.handleDefeatedZombies(defeated);

    if (this.state.world.houseHp <= 0) {
      this.state = restoreCheckpoint(this.state);
      saveGame(this.state);
      this.showToast('房屋失守，已恢复到最近的信标检查点');
      this.scene.restart();
      return;
    }

    this.saveAccumulator += elapsedMs;
    if (this.saveAccumulator >= 5000) {
      saveGame(this.state);
      this.saveAccumulator = 0;
    }

    if (time - this.lastUiRefresh >= 80) {
      this.syncVisuals();
      this.lastUiRefresh = time;
    }
  }

  private createWorld(): void {
    for (const scene of worldScenes) {
      const origin = sceneOrigins[scene];
      this.add.image(origin.x, origin.y, `scene-${scene}`).setOrigin(0).setDisplaySize(VIEW_WIDTH, VIEW_HEIGHT);
      this.add.rectangle(origin.x + 195, origin.y + 90, 330, 42, 0x102017, 0.7).setStrokeStyle(1, 0xf0c879, 0.5);
      this.add
        .text(origin.x + 195, origin.y + 90, sceneLabels[scene], {
          color: '#fff6dc',
          fontFamily: 'sans-serif',
          fontSize: '21px',
          fontStyle: 'bold',
        })
        .setOrigin(0.5);
    }
  }

  private createFarmInteractions(): void {
    const origin = sceneOrigins.farm;
    const positions = [
      [98, 382],
      [195, 370],
      [292, 382],
      [98, 486],
      [195, 476],
      [292, 486],
      [98, 590],
      [195, 580],
      [292, 590],
    ] as const;

    positions.forEach(([x, y], index) => {
      const sprite = this.add.image(origin.x + x, origin.y + y, 'seeds').setDisplaySize(58, 58).setVisible(false);
      const label = this.add
        .text(origin.x + x, origin.y + y + 38, '', {
          align: 'center',
          backgroundColor: 'rgba(20,32,21,0.78)',
          color: '#fff4d6',
          fontFamily: 'sans-serif',
          fontSize: '13px',
          padding: { x: 5, y: 3 },
        })
        .setOrigin(0.5);
      const zone = this.add.zone(origin.x + x, origin.y + y, 82, 76).setInteractive({ useHandCursor: true });
      zone.on('pointerdown', (_pointer: Phaser.Input.Pointer, _x: number, _y: number, event: Phaser.Types.Input.EventData) => {
        event.stopPropagation();
        this.handleFarmPlot(index);
      });
      this.farmSprites.push(sprite);
      this.farmLabels.push(label);
    });
  }

  private handleFarmPlot(index: number): void {
    const plot = this.state.farm.plots[index];
    if (!plot) return;
    if (plot.stage === 'ready') {
      plot.stage = 'empty';
      plot.watered = false;
      this.state.inventory.carrots += 2;
      if (this.state.tutorial.step === 'harvest') this.state.tutorial.step = 'plant';
      this.showToast('收获 2 根胡萝卜');
      return;
    }
    if (plot.stage === 'empty') {
      plot.stage = 'growing';
      plot.plantedAt = this.state.runtime.totalSeconds;
      plot.watered = false;
      if (this.state.tutorial.step === 'plant') this.state.tutorial.step = 'cook';
      this.showToast('已免费播种，点击幼苗可以浇水加速');
      return;
    }
    if (!plot.watered) {
      plot.watered = true;
      this.showToast('浇水完成，成长速度提高');
    }
  }

  private createKitchenInteractions(): void {
    const origin = sceneOrigins.kitchen;
    this.kitchenCarrot = this.add.image(origin.x + 58, origin.y + 535, 'carrot').setDisplaySize(80, 80);
    this.kitchenBoardItem = this.add
      .image(origin.x + 233, origin.y + 610, 'carrot')
      .setDisplaySize(88, 88)
      .setInteractive({ useHandCursor: true });
    this.kitchenChoppedItem = this.add.image(origin.x + 233, origin.y + 610, 'chopped').setDisplaySize(88, 88);
    this.kitchenBowlItem = this.add.image(origin.x + 95, origin.y + 618, 'chopped').setDisplaySize(76, 76);
    this.kitchenPlate = this.add.image(origin.x + 300, origin.y + 534, 'stew').setDisplaySize(92, 92);

    this.makeDraggable(this.kitchenCarrot, { x: origin.x + 58, y: origin.y + 535 }, (x, y) => {
      if (this.state.kitchen.board !== 'empty' || this.state.inventory.carrots <= 0) return false;
      if (!this.isNear(x, y, origin.x + 233, origin.y + 610, 85)) return false;
      this.state.inventory.carrots -= 1;
      this.state.kitchen.board = 'whole';
      this.state.kitchen.cuts = 0;
      return true;
    });

    this.makeDraggable(this.kitchenChoppedItem, { x: origin.x + 233, y: origin.y + 610 }, (x, y) => {
      if (this.state.kitchen.board !== 'chopped') return false;
      if (!this.isNear(x, y, origin.x + 95, origin.y + 618, 85)) return false;
      this.state.kitchen.board = 'empty';
      this.state.kitchen.bowlPieces = 1;
      return true;
    });
    this.kitchenBoardItem.on(
      'pointerdown',
      (pointer: Phaser.Input.Pointer, _x: number, _y: number, event: Phaser.Types.Input.EventData) => {
        event.stopPropagation();
        if (this.state.kitchen.board !== 'whole') return;
        this.cutting = true;
        this.cuttingDistance = 0;
        this.lastCutPoint.set(pointer.x, pointer.y);
      },
    );

    this.makeDraggable(this.kitchenBowlItem, { x: origin.x + 95, y: origin.y + 618 }, (x, y) => {
      if (this.state.kitchen.bowlPieces <= 0 || this.state.kitchen.pot !== 'empty') return false;
      if (!this.isNear(x, y, origin.x + 205, origin.y + 405, 90)) return false;
      this.state.kitchen.bowlPieces = 0;
      this.state.kitchen.pot = 'cooking';
      this.state.kitchen.cookStartedAt = this.state.runtime.totalSeconds;
      this.showToast('已下锅，及时回来装盘，别让它糊掉');
      return true;
    });

    this.makeDraggable(this.kitchenPlate, { x: origin.x + 300, y: origin.y + 534 }, (x, y) => {
      if (!this.state.kitchen.plateReady) return false;
      if (!this.isNear(x, y, origin.x + 342, origin.y + 325, 105)) return false;
      if (this.state.inventory.stew >= this.state.kitchen.cabinetCapacity) {
        this.showToast('成品柜满了，先去前台出餐');
        return false;
      }
      this.state.kitchen.plateReady = false;
      this.state.inventory.stew += 1;
      if (this.state.tutorial.step === 'cook') this.state.tutorial.step = 'serve';
      this.showToast('热汤已放入成品柜');
      return true;
    });

    const potZone = this.add.zone(origin.x + 205, origin.y + 405, 120, 120).setInteractive({ useHandCursor: true });
    potZone.on('pointerdown', (_pointer: Phaser.Input.Pointer, _x: number, _y: number, event: Phaser.Types.Input.EventData) => {
      event.stopPropagation();
      if (this.state.kitchen.pot === 'ready') {
        this.state.kitchen.pot = 'empty';
        this.state.kitchen.plateReady = true;
        this.showToast('料理已装盘，拖进右侧成品柜');
      } else if (this.state.kitchen.pot === 'burnt') {
        this.state.kitchen.pot = 'empty';
        this.showToast('倒掉糊锅料理，食材不会返还');
      }
    });

    this.kitchenPotText = this.addHint(origin.x + 205, origin.y + 472, '锅是空的');
    this.kitchenCabinetText = this.addHint(origin.x + 335, origin.y + 398, '成品柜 0/3');
  }

  private createFrontInteractions(): void {
    const origin = sceneOrigins.front;
    this.add.image(origin.x + 195, origin.y + 390, 'refugee').setDisplaySize(220, 220);
    this.add.image(origin.x + 288, origin.y + 252, 'stew').setDisplaySize(58, 58);
    this.addHint(origin.x + 288, origin.y + 298, '想吃蔬菜热汤');
    this.add.rectangle(origin.x + 195, origin.y + 520, 210, 13, 0x382a24, 0.85);
    this.patienceFill = this.add.rectangle(origin.x + 90, origin.y + 520, 210, 13, 0xe3c461, 1).setOrigin(0, 0.5);
    this.visitorText = this.addHint(origin.x + 195, origin.y + 554, '等待出餐');
    this.frontStew = this.add.image(origin.x + 96, origin.y + 675, 'stew').setDisplaySize(92, 92);
    this.makeDraggable(this.frontStew, { x: origin.x + 96, y: origin.y + 675 }, (x, y) => {
      if (this.state.inventory.stew <= 0 || !this.isNear(x, y, origin.x + 195, origin.y + 390, 145)) return false;
      this.state.inventory.stew -= 1;
      this.state.front.served += 1;
      this.state.front.visitorId += 1;
      this.state.front.patience = this.state.front.maxPatience;
      this.state.world.houseXp += 20;
      if (this.state.world.houseXp >= this.state.world.houseLevel * 60) {
        this.state.world.houseXp = 0;
        this.state.world.houseLevel += 1;
        this.state.world.houseMaxHp += 10;
        this.state.world.houseHp = this.state.world.houseMaxHp;
      }
      if (this.state.tutorial.step === 'serve') this.state.tutorial.step = 'make-part';
      this.showToast('亲手出餐成功，家园经验 +20');
      return true;
    });
    this.addHint(origin.x + 96, origin.y + 745, '成品托盘');
  }

  private createFactoryInteractions(): void {
    const origin = sceneOrigins.factory;
    this.factoryScrap = this.add.image(origin.x + 58, origin.y + 680, 'scrap').setDisplaySize(88, 88);
    this.factoryPiece = this.add.image(origin.x + 82, origin.y + 515, 'part').setDisplaySize(82, 82);
    this.factoryText = this.addHint(origin.x + 195, origin.y + 745, '把废料拖到左侧切割台');

    this.makeDraggable(this.factoryScrap, { x: origin.x + 58, y: origin.y + 680 }, (x, y) => {
      if (this.state.factory.phase !== 'idle' || this.state.inventory.scrap <= 0) return false;
      if (!this.isNear(x, y, origin.x + 82, origin.y + 515, 95)) return false;
      this.state.inventory.scrap -= 1;
      this.state.factory.phase = 'cutting';
      this.state.factory.progress = 0;
      this.state.factory.turretJob = this.state.tutorial.step === 'make-turret';
      this.showToast('沿着切割台左右拖动完成切割');
      return true;
    });

    this.makeDraggable(this.factoryPiece, { x: origin.x + 82, y: origin.y + 515 }, (x, y) => {
      if (this.state.factory.phase === 'cut' && this.isNear(x, y, origin.x + 306, origin.y + 510, 95)) {
        this.state.factory.phase = 'welding';
        this.state.factory.progress = 0;
        this.showToast('按住焊机持续焊接');
        return true;
      }
      if (this.state.factory.phase === 'welded' && this.isNear(x, y, origin.x + 205, origin.y + 615, 100)) {
        this.state.factory.phase = 'assembly';
        this.state.factory.progress = 0;
        this.showToast('点击零件三次拧紧装配');
        return true;
      }
      return false;
    });
    this.factoryPiece.on(
      'pointerdown',
      (pointer: Phaser.Input.Pointer, _x: number, _y: number, event: Phaser.Types.Input.EventData) => {
        event.stopPropagation();
        if (this.state.factory.phase === 'cutting') {
          this.factoryCutting = true;
          this.factoryCutDistance = 0;
          this.lastFactoryCutPoint.set(pointer.x, pointer.y);
        } else if (this.state.factory.phase === 'welding') {
          this.weldingHeld = true;
        } else if (this.state.factory.phase === 'assembly') {
          this.state.factory.progress += 1;
          if (this.state.factory.progress >= 3) this.finishFactoryJob();
        }
      },
    );

  }

  private finishFactoryJob(): void {
    if (this.state.factory.turretJob) {
      this.state.defense.turretBuilt = true;
      this.state.tutorial.step = 'place-turret';
      this.showToast('自动机枪塔制造完成');
    } else {
      this.state.inventory.parts += 1;
      if (this.state.tutorial.step === 'make-part') this.state.tutorial.step = 'start-beacon';
      this.showToast('信标零件制造完成');
    }
    this.state.factory.phase = 'idle';
    this.state.factory.progress = 0;
    this.state.factory.turretJob = false;
  }

  private createBeaconInteractions(): void {
    const origin = sceneOrigins.factory;
    this.beaconPart = this.add.image(origin.x + 235, origin.y + 280, 'part').setDisplaySize(84, 84);
    this.beaconScrap = this.add.image(origin.x + 235, origin.y + 280, 'scrap').setDisplaySize(84, 84);
    this.beaconText = this.addHint(origin.x + 195, origin.y + 355, '信标等待零件');

    this.makeDraggable(this.beaconPart, { x: origin.x + 235, y: origin.y + 280 }, (x, y) => {
      if (this.state.tutorial.step !== 'start-beacon' || this.state.inventory.parts <= 0) return false;
      if (!this.isNear(x, y, origin.x + 195, origin.y + 165, 135)) return false;
      this.state.inventory.parts -= 1;
      this.state.beacon.initialSignal = true;
      this.state.tutorial.step = 'tap-zombie';
      spawnTutorialZombie(this.state, 'tap-tutorial');
      this.showToast('初始信号启动：危险正在接近防线');
      return true;
    });

    this.makeDraggable(this.beaconScrap, { x: origin.x + 235, y: origin.y + 280 }, (x, y) => {
      if (this.state.tutorial.step !== 'repair-beacon' || this.state.inventory.scrap <= 0) return false;
      if (!this.isNear(x, y, origin.x + 195, origin.y + 165, 135)) return false;
      this.state.inventory.scrap -= 1;
      this.state.world.beaconStage = 1;
      this.state.beacon.nextThreatDay = this.state.runtime.day + 1;
      this.state.defense.turretBlueprint = true;
      this.state.tutorial.step = 'make-turret';
      createCheckpoint(this.state);
      saveGame(this.state);
      this.showToast('正式信标第 1 阶段完成：机枪塔图纸已解锁');
      return true;
    });
  }

  private createDefenseInteractions(): void {
    const origin = sceneOrigins.defense;
    [0, 1, 2].forEach((lane) => {
      this.add.image(origin.x + 72, origin.y + 356 + lane * 142, 'barricade').setDisplaySize(104, 104).setAlpha(0.82);
    });

    this.turretKit = this.add.image(origin.x + 286, origin.y + 716, 'turret').setDisplaySize(112, 112);
    this.makeDraggable(this.turretKit, { x: origin.x + 286, y: origin.y + 716 }, (x, y) => {
      if (!this.state.defense.turretBuilt || this.state.defense.turretPlaced) return false;
      const onBase = [356, 498, 640].some((laneY) => this.isNear(x, y, origin.x + 108, origin.y + laneY, 95));
      if (!onBase) return false;
      this.state.defense.turretPlaced = true;
      this.state.tutorial.step = 'complete';
      this.state.tutorial.completed = true;
      saveGame(this.state);
      this.showToast('自动机枪塔已建成，核心循环完成');
      return true;
    });
    this.placedTurret = this.add.image(origin.x + 108, origin.y + 500, 'turret').setDisplaySize(120, 120);
  }

  private createHud(): void {
    const hud = this.add.rectangle(195, 38, 390, 76, 0x101c15, 0.9).setScrollFactor(0).setDepth(1000);
    hud.setStrokeStyle(1, 0xf0c879, 0.45);
    this.statusText = this.add
      .text(14, 10, '', { color: '#fff3d1', fontFamily: 'sans-serif', fontSize: '15px' })
      .setScrollFactor(0)
      .setDepth(1001);
    this.inventoryText = this.add
      .text(376, 10, '', { align: 'right', color: '#d6e8c9', fontFamily: 'sans-serif', fontSize: '13px' })
      .setOrigin(1, 0)
      .setScrollFactor(0)
      .setDepth(1001);
    this.objectiveText = this.add
      .text(195, 51, '', {
        align: 'center',
        color: '#f2ce72',
        fontFamily: 'sans-serif',
        fontSize: '14px',
        wordWrap: { width: 360 },
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(1001);
    this.sceneText = this.add
      .text(195, 92, '', {
        backgroundColor: 'rgba(12,24,16,0.76)',
        color: '#ffffff',
        fontFamily: 'sans-serif',
        fontSize: '14px',
        padding: { x: 10, y: 5 },
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(1001);
    this.edgeHintText = this.add
      .text(195, 782, '', {
        align: 'center',
        backgroundColor: 'rgba(12,24,16,0.76)',
        color: '#fff3d1',
        fontFamily: 'sans-serif',
        fontSize: '13px',
        padding: { x: 9, y: 5 },
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(1001);

    const dangerBg = this.add.rectangle(195, 828, 360, 12, 0x26382b, 0.95).setScrollFactor(0).setDepth(1000);
    dangerBg.setInteractive({ useHandCursor: true });
    dangerBg.on('pointerdown', () => this.moveToScene('defense'));
    this.dangerFill = this.add.rectangle(15, 828, 0, 12, 0xd65a42, 1).setOrigin(0, 0.5).setScrollFactor(0).setDepth(1001);

    this.nightOverlay = this.add.rectangle(195, 422, 390, 844, 0x17254c, 0).setScrollFactor(0).setDepth(900);
    this.nightOverlay.setBlendMode(Phaser.BlendModes.MULTIPLY);
    this.toastText = this.add
      .text(195, 700, '', {
        align: 'center',
        backgroundColor: 'rgba(16,28,21,0.93)',
        color: '#fff4d6',
        fontFamily: 'sans-serif',
        fontSize: '15px',
        padding: { x: 14, y: 9 },
        wordWrap: { width: 320 },
      })
      .setOrigin(0.5)
      .setAlpha(0)
      .setScrollFactor(0)
      .setDepth(1200);
  }

  private createSwipeInput(): void {
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      this.swipeStart = {
        x: pointer.x,
        y: pointer.y,
        scrollX: this.cameras.main.scrollX,
        scrollY: this.cameras.main.scrollY,
        time: pointer.downTime,
      };
    });
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (this.cutting) {
        const distance = Phaser.Math.Distance.Between(pointer.x, pointer.y, this.lastCutPoint.x, this.lastCutPoint.y);
        this.cuttingDistance += distance;
        this.lastCutPoint.set(pointer.x, pointer.y);
        if (this.cuttingDistance >= 34) {
          this.cuttingDistance = 0;
          this.state.kitchen.cuts += 1;
          if (this.state.kitchen.cuts >= 3) {
            this.state.kitchen.board = 'chopped';
            this.cutting = false;
            this.showToast('切配完成，把碎菜拖进备菜碗');
          }
        }
        return;
      }
      if (this.factoryCutting) {
        const distance = Math.abs(pointer.x - this.lastFactoryCutPoint.x);
        this.factoryCutDistance += distance;
        this.lastFactoryCutPoint.set(pointer.x, pointer.y);
        if (this.factoryCutDistance >= 42) {
          this.factoryCutDistance = 0;
          this.state.factory.progress += 1;
          if (this.state.factory.progress >= 3) {
            this.state.factory.phase = 'cut';
            this.state.factory.progress = 0;
            this.factoryCutting = false;
            this.showToast('切割完成，把零件拖到右侧焊机');
          }
        }
        return;
      }
      if (!this.swipeStart || !pointer.isDown) return;
      const deltaX = pointer.x - this.swipeStart.x;
      const deltaY = pointer.y - this.swipeStart.y;
      if (Math.abs(deltaX) > Math.abs(deltaY)) {
        this.cameras.main.scrollX = Phaser.Math.Clamp(this.swipeStart.scrollX - deltaX, 0, VIEW_WIDTH * 2);
        this.cameras.main.scrollY = this.swipeStart.scrollY;
      } else {
        this.cameras.main.scrollY = Phaser.Math.Clamp(this.swipeStart.scrollY - deltaY, 0, VIEW_HEIGHT * 2);
        this.cameras.main.scrollX = this.swipeStart.scrollX;
      }
    });
    this.input.on('pointerup', (pointer: Phaser.Input.Pointer) => {
      this.cutting = false;
      this.factoryCutting = false;
      this.weldingHeld = false;
      this.firingZombieId = null;
      if (!this.swipeStart) return;
      const deltaX = pointer.x - this.swipeStart.x;
      const deltaY = pointer.y - this.swipeStart.y;
      const elapsed = Math.max(1, pointer.upTime - this.swipeStart.time);
      const distance = Math.max(Math.abs(deltaX), Math.abs(deltaY));
      const velocity = distance / elapsed;
      let target: WorldScene | null = null;

      if (distance >= 70 || velocity >= 0.55) {
        const currentPosition = scenePositions[this.currentScene];
        const direction = Math.abs(deltaX) > Math.abs(deltaY)
          ? { x: deltaX < 0 ? 1 : -1, y: 0 }
          : { x: 0, y: deltaY < 0 ? 1 : -1 };
        target = worldScenes.find((scene) => {
          const position = scenePositions[scene];
          return position.x === currentPosition.x + direction.x && position.y === currentPosition.y + direction.y;
        }) ?? null;
      }

      this.swipeStart = null;
      if (target && canMoveBetweenScenes(this.currentScene, target)) this.moveToScene(target);
      else this.moveToScene(this.currentScene);
    });
  }

  private moveToScene(scene: WorldScene): void {
    const target = sceneOrigins[scene];
    this.tweens.killTweensOf(this.cameras.main);
    this.tweens.add({
      targets: this.cameras.main,
      scrollX: target.x,
      scrollY: target.y,
      duration: 260,
      ease: 'Cubic.Out',
      onComplete: () => {
        this.currentScene = scene;
        this.state.world.scene = scene;
        this.applyTutorialSceneArrival(scene);
      },
    });
  }

  private applyTutorialSceneArrival(scene: WorldScene): void {
    if (scene === 'farm' && this.state.tutorial.step === 'go-farm') this.state.tutorial.step = 'harvest';
  }

  private syncVisuals(): void {
    this.syncFarm();
    this.syncKitchen();
    this.syncFront();
    this.syncFactoryAndBeacon();
    this.syncDefense();
    this.syncHud();
  }

  private syncFarm(): void {
    this.state.farm.plots.forEach((plot, index) => {
      const sprite = this.farmSprites[index];
      const label = this.farmLabels[index];
      if (!sprite || !label) return;
      sprite.setVisible(plot.stage !== 'empty');
      if (plot.stage === 'ready') {
        sprite.setTexture('carrot').setDisplaySize(70, 70);
        label.setText('成熟');
      } else if (plot.stage === 'growing') {
        sprite.setTexture('seeds').setDisplaySize(48, 48);
        const effective = plot.watered ? plot.growSeconds * 0.65 : plot.growSeconds;
        const remaining = Math.max(0, Math.ceil(effective - (this.state.runtime.totalSeconds - plot.plantedAt)));
        label.setText(`${plot.watered ? '已浇水 ' : ''}${remaining}秒`);
      } else label.setText('点击播种');
    });
  }

  private syncKitchen(): void {
    const origin = sceneOrigins.kitchen;
    this.kitchenCarrot.setVisible(this.state.inventory.carrots > 0 && this.state.kitchen.board === 'empty');
    if (!this.dragging.has(this.kitchenCarrot)) this.kitchenCarrot.setPosition(origin.x + 58, origin.y + 535);

    const boardVisible = this.state.kitchen.board !== 'empty';
    this.kitchenBoardItem.setVisible(boardVisible);
    this.kitchenBoardItem.setVisible(this.state.kitchen.board === 'whole');
    this.kitchenBoardItem.setTexture('carrot');
    this.kitchenBoardItem.setPosition(origin.x + 233, origin.y + 610);
    this.kitchenChoppedItem.setVisible(this.state.kitchen.board === 'chopped');
    if (!this.dragging.has(this.kitchenChoppedItem)) this.kitchenChoppedItem.setPosition(origin.x + 233, origin.y + 610);

    this.kitchenBowlItem.setVisible(this.state.kitchen.bowlPieces > 0);
    if (!this.dragging.has(this.kitchenBowlItem)) this.kitchenBowlItem.setPosition(origin.x + 95, origin.y + 618);
    this.kitchenPlate.setVisible(this.state.kitchen.plateReady);
    if (!this.dragging.has(this.kitchenPlate)) this.kitchenPlate.setPosition(origin.x + 300, origin.y + 534);

    const potLabel = this.state.kitchen.pot === 'cooking'
      ? `烹饪 ${Math.max(0, Math.ceil(10 - (this.state.runtime.totalSeconds - this.state.kitchen.cookStartedAt)))}秒`
      : this.state.kitchen.pot === 'ready'
        ? '已熟，点击锅装盘'
        : this.state.kitchen.pot === 'burnt'
          ? '糊锅，点击倒掉'
          : '锅是空的';
    this.kitchenPotText.setText(potLabel);
    this.kitchenCabinetText.setText(`成品柜 ${this.state.inventory.stew}/${this.state.kitchen.cabinetCapacity}`);
  }

  private syncFront(): void {
    const origin = sceneOrigins.front;
    this.frontStew.setVisible(this.state.inventory.stew > 0);
    if (!this.dragging.has(this.frontStew)) this.frontStew.setPosition(origin.x + 96, origin.y + 675);
    const patienceRatio = Phaser.Math.Clamp(this.state.front.patience / this.state.front.maxPatience, 0, 1);
    this.patienceFill.width = 210 * patienceRatio;
    this.patienceFill.fillColor = patienceRatio > 0.5 ? 0xe3c461 : patienceRatio > 0.2 ? 0xe28b43 : 0xd64b3f;
    this.visitorText.setText(`耐心 ${Math.ceil(this.state.front.patience)}秒 · 已救助 ${this.state.front.served} 人`);
  }

  private syncFactoryAndBeacon(): void {
    const origin = sceneOrigins.factory;
    this.factoryScrap.setVisible(this.state.factory.phase === 'idle' && this.state.inventory.scrap > 0);
    if (!this.dragging.has(this.factoryScrap)) this.factoryScrap.setPosition(origin.x + 58, origin.y + 680);

    const pieceVisible = ['cutting', 'cut', 'welding', 'welded', 'assembly'].includes(this.state.factory.phase);
    this.factoryPiece.setVisible(pieceVisible);
    if (!this.dragging.has(this.factoryPiece)) {
      if (this.state.factory.phase === 'cutting' || this.state.factory.phase === 'cut') this.factoryPiece.setPosition(origin.x + 82, origin.y + 515);
      else if (this.state.factory.phase === 'welding' || this.state.factory.phase === 'welded') this.factoryPiece.setPosition(origin.x + 306, origin.y + 510);
      else this.factoryPiece.setPosition(origin.x + 205, origin.y + 615);
    }
    this.input.setDraggable(this.factoryPiece, this.state.factory.phase === 'cut' || this.state.factory.phase === 'welded');

    const factoryLabel = this.state.factory.phase === 'idle'
      ? this.state.tutorial.step === 'make-turret'
        ? '把废料拖到切割台，制造机枪塔'
        : '把废料拖到左侧切割台'
      : this.state.factory.phase === 'cutting'
        ? `左右切割 ${this.state.factory.progress}/3`
        : this.state.factory.phase === 'cut'
          ? '拖到右侧焊机'
          : this.state.factory.phase === 'welding'
            ? `按住焊接 ${Math.round((this.state.factory.progress / 1.5) * 100)}%`
            : this.state.factory.phase === 'welded'
              ? '拖到下方装配台'
              : `点击拧紧 ${this.state.factory.progress}/3`;
    this.factoryText.setText(factoryLabel);

    this.beaconPart.setVisible(this.state.tutorial.step === 'start-beacon' && this.state.inventory.parts > 0);
    this.beaconScrap.setVisible(this.state.tutorial.step === 'repair-beacon' && this.state.inventory.scrap > 0);
    if (!this.dragging.has(this.beaconPart)) this.beaconPart.setPosition(origin.x + 235, origin.y + 280);
    if (!this.dragging.has(this.beaconScrap)) this.beaconScrap.setPosition(origin.x + 235, origin.y + 280);
    this.beaconText.setText(
      this.state.world.beaconStage > 0
        ? `信标阶段 ${this.state.world.beaconStage} · 机枪塔图纸已解锁`
        : this.state.beacon.initialSignal
          ? '初始信号已启动 · 等待正式维修'
          : '信标等待零件',
    );
  }

  private syncDefense(): void {
    const origin = sceneOrigins.defense;
    const liveIds = new Set(this.state.defense.zombies.map((zombie) => zombie.id));
    for (const [id, sprite] of this.zombieSprites) {
      if (liveIds.has(id)) continue;
      sprite.destroy();
      this.zombieBars.get(id)?.destroy();
      this.zombieSprites.delete(id);
      this.zombieBars.delete(id);
    }

    for (const zombie of this.state.defense.zombies) {
      let sprite = this.zombieSprites.get(zombie.id);
      if (!sprite) {
        sprite = this.add.image(0, 0, zombie.kind === 'brute' ? 'brute' : 'zombie').setDisplaySize(
          zombie.kind === 'brute' ? 118 : 94,
          zombie.kind === 'brute' ? 118 : 94,
        );
        sprite.setInteractive({ useHandCursor: true });
        sprite.on('pointerdown', (_pointer: Phaser.Input.Pointer, _x: number, _y: number, event: Phaser.Types.Input.EventData) => {
          event.stopPropagation();
          const target = this.state.defense.zombies.find((item) => item.id === zombie.id);
          if (!target) return;
          if (target.kind === 'hold-tutorial') this.firingZombieId = target.id;
          else target.hp -= 1;
          this.cameras.main.shake(45, 0.002);
        });
        const bar = this.add.rectangle(0, 0, 58, 6, 0x65c76b).setOrigin(0, 0.5);
        this.zombieSprites.set(zombie.id, sprite);
        this.zombieBars.set(zombie.id, bar);
      }
      const x = origin.x + zombie.x;
      const y = origin.y + 345 + zombie.lane * 142;
      sprite.setPosition(x, y);
      const bar = this.zombieBars.get(zombie.id);
      if (bar) {
        bar.setPosition(x - 29, y - 62);
        bar.width = 58 * Phaser.Math.Clamp(zombie.hp / zombie.maxHp, 0, 1);
      }
    }

    this.turretKit.setVisible(this.state.defense.turretBuilt && !this.state.defense.turretPlaced);
    if (!this.dragging.has(this.turretKit)) this.turretKit.setPosition(origin.x + 286, origin.y + 716);
    this.placedTurret.setVisible(this.state.defense.turretPlaced);
  }

  private syncHud(): void {
    const dayProgress = this.state.runtime.timeInDay / this.state.runtime.dayLength;
    const hour = Math.floor(dayProgress * 24);
    const minute = Math.floor((dayProgress * 24 - hour) * 60);
    const period = hour >= 19 || hour < 6 ? '夜晚' : '白天';
    this.statusText.setText(`家园 Lv.${this.state.world.houseLevel}  第 ${this.state.runtime.day} 天 ${period}\n房屋 ${Math.ceil(this.state.world.houseHp)}/${this.state.world.houseMaxHp}`);
    this.inventoryText.setText(`胡萝卜 ${this.state.inventory.carrots}  热汤 ${this.state.inventory.stew}\n废料 ${this.state.inventory.scrap}  ${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`);
    this.objectiveText.setText(tutorialObjectives[this.state.tutorial.step]);
    this.sceneText.setText(sceneLabels[this.currentScene]);
    this.edgeHintText.setText(this.getEdgeHint());

    const closest = this.state.defense.zombies.reduce<number>((value, zombie) => Math.min(value, zombie.x), 390);
    const danger = Phaser.Math.Clamp(1 - closest / 390, 0, 1);
    this.dangerFill.width = 360 * danger;
    this.dangerFill.fillColor = danger > 0.7 ? 0xd64235 : danger > 0.35 ? 0xe3a044 : 0x66ae62;
    const night = hour >= 19 || hour < 6;
    this.nightOverlay.setAlpha(night ? (this.state.runtime.bloodMoon ? 0.38 : 0.24) : 0);
    this.nightOverlay.fillColor = this.state.runtime.bloodMoon ? 0x8b2026 : 0x17254c;
  }

  private getEdgeHint(): string {
    if (this.currentScene === 'front') return '↑ 工厂信标　← 防线　农田 →　↓ 厨房（滑动移动）';
    return '滑回中央前台才能前往其他区域';
  }

  private handleDefeatedZombies(defeated: ZombieState[]): void {
    for (const zombie of defeated) {
      if (zombie.kind === 'tap-tutorial' && this.state.tutorial.step === 'tap-zombie') {
        this.state.tutorial.step = 'hold-zombie';
        spawnTutorialZombie(this.state, 'hold-tutorial');
        this.showToast('第一只已击倒，按住第二只连续射击');
      } else if (zombie.kind === 'hold-tutorial' && this.state.tutorial.step === 'hold-zombie') {
        this.state.tutorial.step = 'repair-beacon';
        this.showToast('获得维修废料，返回信标完成正式维修');
      }
    }
  }

  private makeDraggable(
    image: Phaser.GameObjects.Image,
    home: { x: number; y: number },
    onDrop: DragDropHandler,
  ): void {
    image.setInteractive({ useHandCursor: true, draggable: true });
    this.input.setDraggable(image);
    image.on('pointerdown', (_pointer: Phaser.Input.Pointer, _x: number, _y: number, event: Phaser.Types.Input.EventData) => {
      event.stopPropagation();
    });
    image.on('dragstart', () => this.dragging.add(image));
    image.on('drag', (_pointer: Phaser.Input.Pointer, dragX: number, dragY: number) => image.setPosition(dragX, dragY));
    image.on('dragend', () => {
      this.dragging.delete(image);
      const accepted = onDrop(image.x, image.y);
      if (!accepted) image.setPosition(home.x, home.y);
    });
  }

  private addHint(x: number, y: number, text: string): Phaser.GameObjects.Text {
    return this.add
      .text(x, y, text, {
        align: 'center',
        backgroundColor: 'rgba(18,29,20,0.82)',
        color: '#fff4d6',
        fontFamily: 'sans-serif',
        fontSize: '13px',
        padding: { x: 7, y: 4 },
      })
      .setOrigin(0.5);
  }

  private isNear(x: number, y: number, targetX: number, targetY: number, radius: number): boolean {
    return Phaser.Math.Distance.Between(x, y, targetX, targetY) <= radius;
  }

  private showToast(message: string): void {
    if (!this.toastText) return;
    this.toastTween?.stop();
    this.toastText.setText(message).setAlpha(1);
    this.toastTween = this.tweens.add({
      targets: this.toastText,
      alpha: 0,
      delay: 1900,
      duration: 350,
    });
  }

  private installDebugBridge(): void {
    if (!import.meta.env.DEV) return;
    const target = window as typeof window & {
      __MORI_DEBUG__?: {
        getState: () => GameState;
        setState: (state: GameState) => void;
      };
    };
    target.__MORI_DEBUG__ = {
      getState: () => structuredClone(this.state),
      setState: (state: GameState) => {
        this.state = structuredClone(state);
        this.currentScene = this.state.world.scene;
        const origin = sceneOrigins[this.currentScene];
        this.cameras.main.setScroll(origin.x, origin.y);
        this.syncVisuals();
      },
    };
  }

  private handleVisibility = (): void => {
    this.state.runtime.paused = document.hidden;
    this.lastWallTime = performance.now();
    if (document.hidden) saveGame(this.state);
  };
}
