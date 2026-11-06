import Phaser from 'phaser';

import { createCheckpoint, loadGame, restoreCheckpoint, saveGame, storageIsPersistent } from '../state/storage';
import { removeDefeatedZombies, spawnTutorialZombie, tickSimulation } from '../state/simulation';
import type { GameState, Product, TutorialStep, ZombieState } from '../state/model';
import { cancelProduction, currentObjective, finishProduction, placeTower, products, serveMeal, shoot, startProduction, startRepair, upgradeBeacon } from '../state/rules';
import { AudioFeedback } from '../presentation/AudioFeedback';
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
  cook: '向右划回前台，再向上划进厨房',
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
  private audio = new AudioFeedback();
  private worldNights: Phaser.GameObjects.Image[] = [];
  private productionControls: (Phaser.GameObjects.Graphics | Phaser.GameObjects.Text | Phaser.GameObjects.Image)[] = [];
  private productLabels = new Map<Product, Phaser.GameObjects.Text>();
  private towerSprites = new Map<number, Phaser.GameObjects.Image>();
  private towerHints = new Map<number, Phaser.GameObjects.Text>();
  private hintPanels: { label: Phaser.GameObjects.Text; panel: Phaser.GameObjects.Graphics; width: number; height: number }[] = [];
  private houseRepairHint!: Phaser.GameObjects.Text;
  private barriers: Phaser.GameObjects.Image[] = [];
  private guest!: Phaser.GameObjects.Image;
  private orderIcon!: Phaser.GameObjects.Image;
  private orderText!: Phaser.GameObjects.Text;
  private knife!: Phaser.GameObjects.Graphics;
  private factoryFx!: Phaser.GameObjects.Graphics;
  private pausedByPlayer = false;
  private pauseShade!: Phaser.GameObjects.Rectangle;
  private pauseMessage!: Phaser.GameObjects.Text;
  private gunStatus!: Phaser.GameObjects.Text;
  private saveLabel!: Phaser.GameObjects.Text;
  private lastHeldShot = 0;
  private guestDepartingUntil = 0;
  private currentScene: WorldScene = 'front';
  private dragging = new Set<Phaser.GameObjects.Image>();
  private swipeStart: { x: number; y: number; scrollX: number; scrollY: number; time: number; axis?: 'x' | 'y' } | null = null;
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
  private kitchenFx!: Phaser.GameObjects.Graphics;
  private cutterMachine!: Phaser.GameObjects.Graphics;
  private wateringPipes!: Phaser.GameObjects.Graphics;
  private kitchenBoardHint!: Phaser.GameObjects.Text;
  private potSurface!: Phaser.GameObjects.Graphics;
  private cabinetMeals: Phaser.GameObjects.Image[] = [];
  private focusRing!: Phaser.GameObjects.Graphics;
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
  private zombieSprites = new Map<number, Phaser.GameObjects.Image>();
  private zombieBars = new Map<number, Phaser.GameObjects.Rectangle>();
  private zombieShadows = new Map<number, Phaser.GameObjects.Ellipse>();
  private lastZombieHp = new Map<number, number>();
  private lastZombieHit = new Map<number, number>();

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
    this.audio = new AudioFeedback();
    this.worldNights = []; this.productionControls = []; this.productLabels.clear();
    this.towerSprites.clear(); this.towerHints.clear(); this.barriers = []; this.farmSprites = []; this.farmLabels = []; this.cabinetMeals = [];
    this.zombieSprites.clear(); this.zombieBars.clear(); this.zombieShadows.clear(); this.lastZombieHp.clear(); this.lastZombieHit.clear();
    this.dragging.clear(); this.swipeStart = null; this.firingZombieId = null;
    this.pausedByPlayer = false;
    this.hintPanels = [];
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
    this.focusRing = this.add.graphics().setDepth(80);

    const origin = sceneOrigins[this.currentScene];
    this.cameras.main.setScroll(origin.x, origin.y);
    this.applyTutorialSceneArrival(this.currentScene);

    document.addEventListener('visibilitychange', this.handleVisibility);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      document.removeEventListener('visibilitychange', this.handleVisibility);
      saveGame(this.state);
      this.audio.destroy();
    });
    this.syncVisuals();
  }

  update(time: number, _deltaMs: number): void {
    const now = performance.now();
    const elapsedMs = Math.max(0, now - this.lastWallTime);
    this.lastWallTime = now;
    const deltaSeconds = this.state.runtime.paused ? 0 : elapsedMs / 1000;
    const previousTowers = this.state.defense.towers.map(tower => tower.cooldown);
    const previousPot = this.state.kitchen.pot;
    const previousCuts = this.state.kitchen.cuts;
    const previouslyRescued = this.state.progression.rescued;
    tickSimulation(this.state, deltaSeconds);
    if (this.state.progression.cutter && Math.floor(this.state.kitchen.cuts) > Math.floor(previousCuts)) { this.cutEffect(); this.audio.play('chop'); }
    if (!previouslyRescued && this.state.progression.rescued) {
      this.showToast('收到回音了！伙伴们平安获救，小院的生活还会继续。');
      this.audio.play('beacon');
    }
    if (previousPot === 'cooking' && this.state.kitchen.pot === 'ready') this.audio.play('serve');
    if (previousPot !== 'burnt' && this.state.kitchen.pot === 'burnt') this.audio.play('error');
    this.state.defense.towers.forEach((tower, index) => {
      if (tower.cooldown > (previousTowers[index] ?? 0)) {
        const target = this.state.defense.zombies.filter(zombie => zombie.lane === tower.lane).reduce<ZombieState | null>((nearest, zombie) => !nearest || zombie.x < nearest.x ? zombie : nearest, null);
        if (target) this.shotEffect(target, tower.lane);
      }
    });

    if (this.weldingHeld && this.state.factory.phase === 'welding') {
      this.state.factory.progress += deltaSeconds;
      if (this.state.factory.progress >= 1.5) {
        this.state.factory.phase = 'welded';
        this.state.factory.progress = 0;
        this.weldingHeld = false;
        this.showToast('焊点完成，把零件拖到装配台');
      }
    }

    if (this.firingZombieId !== null && !this.state.runtime.paused && this.state.runtime.totalSeconds - this.lastHeldShot >= 0.22) {
      const target = this.state.defense.zombies.find((zombie) => zombie.id === this.firingZombieId);
      if (target && shoot(this.state, target)) { this.shotEffect(target); this.lastHeldShot = this.state.runtime.totalSeconds; }
    }

    const defeated = removeDefeatedZombies(this.state);
    this.handleDefeatedZombies(defeated);

    if (this.state.world.houseHp <= 0) {
      this.state = restoreCheckpoint(this.state);
      saveGame(this.state);
      this.saveLabel?.setText(storageIsPersistent() ? '已保存' : '存档受限');
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
      this.worldNights.push(this.add.image(origin.x, origin.y, `night-${scene}`).setOrigin(0).setDisplaySize(VIEW_WIDTH, VIEW_HEIGHT).setAlpha(0));
    }
  }

  private createFarmInteractions(): void {
    const origin = sceneOrigins.farm;
    this.wateringPipes = this.add.graphics().setDepth(1);
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
          backgroundColor: 'rgba(250,255,255,0.94)',
          color: '#39776e',
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
      this.audio.play('harvest');
      const sprite = this.farmSprites[index];
      if (sprite) this.rewardEffect(sprite.x, sprite.y - 25, '+2 胡萝卜');
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
    this.drawKitchenTools(origin);
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
      if (!['cook', 'serve', 'complete'].includes(this.state.tutorial.step)) return false;
      if (!this.isNear(x, y, origin.x + 233, origin.y + 610, 85)) return false;
      this.state.inventory.carrots -= 1;
      this.state.kitchen.board = 'whole';
      this.state.kitchen.cuts = 0;
      this.audio.play('drop');
      return true;
    });

    this.makeDraggable(this.kitchenChoppedItem, { x: origin.x + 233, y: origin.y + 610 }, (x, y) => {
      if (this.state.kitchen.board !== 'chopped') return false;
      if (!this.isNear(x, y, origin.x + 95, origin.y + 618, 85)) return false;
      if (this.state.kitchen.bowlPieces > 0) return false;
      this.state.kitchen.board = 'empty';
      this.state.kitchen.bowlPieces = 1;
      return true;
    });
    this.kitchenBoardItem.on(
      'pointerdown',
      (pointer: Phaser.Input.Pointer, _x: number, _y: number, event: Phaser.Types.Input.EventData) => {
        event.stopPropagation();
        if (this.state.kitchen.board !== 'whole') return;
        if (this.state.progression.cutter) return;
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
      this.audio.play('drop');
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
        if (this.state.kitchen.plateReady) {
          this.showToast('先把盘中的料理放进成品柜');
          return;
        }
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
    this.addHint(origin.x + 58, origin.y + 582, '食材架');
    this.kitchenBoardHint = this.addHint(origin.x + 233, origin.y + 670, '砧板 · 划动切菜');
    this.addHint(origin.x + 95, origin.y + 670, '备菜碗');
    this.kitchenFx = this.add.graphics().setDepth(20);
  }

  private createFrontInteractions(): void {
    const origin = sceneOrigins.front;
    this.guest = this.add.image(origin.x + 195, origin.y + 335, 'refugee').setDisplaySize(205, 205);
    this.orderIcon = this.add.image(origin.x + 288, origin.y + 252, 'stew').setDisplaySize(58, 58);
    this.orderText = this.addHint(origin.x + 288, origin.y + 298, '想吃蔬菜热汤');
    this.add.rectangle(origin.x + 195, origin.y + 520, 210, 13, 0x382a24, 0.85);
    this.patienceFill = this.add.rectangle(origin.x + 90, origin.y + 520, 210, 13, 0xe3c461, 1).setOrigin(0, 0.5);
    this.visitorText = this.addHint(origin.x + 195, origin.y + 554, '等待出餐');
    this.frontStew = this.add.image(origin.x + 96, origin.y + 675, 'stew').setDisplaySize(92, 92);
    this.makeDraggable(this.frontStew, { x: origin.x + 96, y: origin.y + 675 }, (x, y) => {
      if (!this.isNear(x, y, origin.x + 195, origin.y + 390, 145) || !serveMeal(this.state)) return false;
      this.rewardEffect(origin.x + 195, origin.y + 380, '+20 家园经验');
      this.audio.play('serve');
      this.guestDepartingUntil = this.time.now + 350;
      this.tweens.add({ targets: this.guest, alpha: 0, x: origin.x + 240, duration: 350, onComplete: () => this.guest.setPosition(origin.x + 195, origin.y + 335).setAlpha(1) });
      this.showToast('亲手出餐成功，家园经验 +20');
      return true;
    });
    this.addHint(origin.x + 96, origin.y + 745, '成品托盘');
    const desk = this.add.graphics().setDepth(-0.5);
    // Objects stay above the counter; only this painted serving desk is foreground scenery.
    desk.fillStyle(0x315d65, 0.15).fillEllipse(origin.x + 195, origin.y + 753, 330, 30);
    desk.fillStyle(0x8ebcb1).fillRoundedRect(origin.x + 36, origin.y + 696, 318, 63, 8);
    desk.fillStyle(0xe5c7a3).fillPoints([new Phaser.Math.Vector2(origin.x + 46, origin.y + 637), new Phaser.Math.Vector2(origin.x + 344, origin.y + 637), new Phaser.Math.Vector2(origin.x + 365, origin.y + 701), new Phaser.Math.Vector2(origin.x + 25, origin.y + 701)], true);
    desk.lineStyle(3, 0xfff4db).lineBetween(origin.x + 27, origin.y + 701, origin.x + 363, origin.y + 701);
    desk.lineStyle(1, 0xb89776, 0.4).lineBetween(origin.x + 42, origin.y + 668, origin.x + 348, origin.y + 668);
    // Keep depth zero scenery above background images and below table items.
    desk.setDepth(0);
    this.frontStew.setDepth(2);
  }

  private createFactoryInteractions(): void {
    const origin = sceneOrigins.factory;
    this.factoryScrap = this.add.image(origin.x + 58, origin.y + 680, 'scrap').setDisplaySize(88, 88);
    this.factoryPiece = this.add.image(origin.x + 82, origin.y + 420, 'part').setDisplaySize(82, 82);
    this.factoryFx = this.add.graphics().setDepth(20);
    this.factoryText = this.addHint(origin.x + 195, origin.y + 745, '把废料拖到左侧切割台');
    this.addHint(origin.x + 82, origin.y + 475, '切割台');
    this.addHint(origin.x + 306, origin.y + 475, '焊接台');
    this.addHint(origin.x + 205, origin.y + 601, '装配台');

    this.makeDraggable(this.factoryScrap, { x: origin.x + 58, y: origin.y + 680 }, (x, y) => {
      if (!this.isNear(x, y, origin.x + 82, origin.y + 420, 95)) return false;
      const error = startProduction(this.state);
      if (error) { this.showToast(error); return false; }
      this.audio.play('machine');
      this.showToast('沿着切割台左右拖动完成切割');
      return true;
    });

    this.makeDraggable(this.factoryPiece, { x: origin.x + 82, y: origin.y + 420 }, (x, y) => {
      if (this.state.factory.phase === 'cut' && this.isNear(x, y, origin.x + 306, origin.y + 420, 95)) {
        this.state.factory.phase = 'welding';
        this.state.factory.progress = 0;
        this.showToast('按住焊机持续焊接');
        return true;
      }
      if (this.state.factory.phase === 'welded' && this.isNear(x, y, origin.x + 205, origin.y + 550, 100)) {
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
          this.audio.play('machine');
          this.tweens.add({ targets: this.factoryPiece, angle: this.factoryPiece.angle + 35, duration: 100 });
          if (this.state.factory.progress >= 3) this.finishFactoryJob();
        }
      },
    );
    this.createProductionChoices(origin);
  }

  private finishFactoryJob(): void {
    this.showToast(finishProduction(this.state));
    this.audio.play('serve');
  }

  private createProductionChoices(origin: { x: number; y: number }): void {
    const panel = this.add.graphics().setDepth(9);
    panel.fillStyle(0xfaffff, 0.94).fillRoundedRect(origin.x + 104, origin.y + 644, 273, 82, 14);
    this.productionControls.push(panel);
    (Object.keys(products) as Product[]).forEach((product, index) => {
      const spec = products[product];
      const icon = this.add.image(origin.x + 131 + index * 52, origin.y + 675, spec.icon).setDisplaySize(37, 37).setDepth(10);
      icon.setInteractive({ useHandCursor: true }).on('pointerdown', (_p: Phaser.Input.Pointer, _x: number, _y: number, event: Phaser.Types.Input.EventData) => {
        event.stopPropagation();
        this.state.factory.selected = product;
        this.showToast(`${spec.name} · ${spec.cost}废料${this.state.world.beaconStage < spec.beacon ? ` · 信标${spec.beacon}阶解锁` : '，拖废料到切割台开工'}`);
      });
      const label = this.add.text(origin.x + 131 + index * 52, origin.y + 705, spec.name, { color: '#39776e', fontSize: '10px', fontFamily: 'sans-serif' }).setOrigin(0.5).setDepth(10);
      this.productLabels.set(product, label);
      this.productionControls.push(icon, label);
    });
    const cancel = this.add.text(origin.x + 335, origin.y + 610, '取消加工', { color: '#92625e', backgroundColor: '#fff7f4', padding: { x: 7, y: 6 }, fontSize: '12px' }).setOrigin(0.5).setDepth(9).setInteractive({ useHandCursor: true });
    cancel.on('pointerdown', (_p: Phaser.Input.Pointer, _x: number, _y: number, event: Phaser.Types.Input.EventData) => {
      event.stopPropagation();
      if (cancelProduction(this.state)) this.showToast('加工已取消，投入材料全部返还');
    });
    this.productionControls.push(cancel);
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
      this.beaconEffect(origin);
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
      this.beaconEffect(origin);
      saveGame(this.state);
      this.showToast('正式信标第 1 阶段完成：机枪塔图纸已解锁');
      return true;
    });
    const signal = this.add.zone(origin.x + 195, origin.y + 170, 130, 115).setInteractive({ useHandCursor: true });
    signal.on('pointerdown', (_p: Phaser.Input.Pointer, _x: number, _y: number, event: Phaser.Types.Input.EventData) => {
      event.stopPropagation();
      if (!this.state.tutorial.completed) return;
      const stage = this.state.world.beaconStage;
      this.showToast(upgradeBeacon(this.state));
      if (this.state.world.beaconStage > stage) this.beaconEffect(origin);
    });
  }

  private createDefenseInteractions(): void {
    const origin = sceneOrigins.defense;
    [0, 1, 2].forEach((lane) => {
      this.barriers.push(this.add.image(origin.x + 72, origin.y + 356 + lane * 142, 'barricade').setDisplaySize(104, 104));
    });

    this.turretKit = this.add.image(origin.x + 286, origin.y + 716, 'turret').setDisplaySize(112, 112);
    this.makeDraggable(this.turretKit, { x: origin.x + 286, y: origin.y + 716 }, (x, y) => {
      if (this.state.defense.kits <= 0) return false;
      const lane = [356, 498, 640].findIndex((laneY) => this.isNear(x, y, origin.x + 108, origin.y + laneY, 68));
      if (lane < 0) return false;
      if (!placeTower(this.state, lane)) { this.showToast('这个位置已有炮塔'); return false; }
      saveGame(this.state);
      this.showToast('机枪塔开始守护这条道路，看看顶部的下一个目标');
      this.audio.play('machine');
      return true;
    });
    const house = this.add.zone(origin.x + 25, origin.y + 280, 70, 180).setInteractive({ useHandCursor: true });
    house.on('pointerdown', (_p: Phaser.Input.Pointer, _x: number, _y: number, event: Phaser.Types.Input.EventData) => { event.stopPropagation(); this.showToast(startRepair(this.state)); });
    this.houseRepairHint = this.addHint(origin.x + 90, origin.y + 217, '点院门维修房屋与路障');
    this.gunStatus = this.addHint(origin.x + 195, origin.y + 747, '');
  }

  private createHud(): void {
    const hud = this.add.graphics().setScrollFactor(0).setDepth(1000);
    hud.fillStyle(0x295d73, 0.12).fillRoundedRect(9, 8, 374, 72, 18);
    hud.fillStyle(0xfaffff, 0.96).fillRoundedRect(7, 4, 376, 72, 18);
    hud.lineStyle(1.5, 0xb8dfdf, 1).strokeRoundedRect(7, 4, 376, 72, 18);
    hud.fillStyle(0xe8f5f1, 1).fillRoundedRect(17, 43, 356, 25, 10);
    this.statusText = this.add
      .text(19, 12, '', { color: '#28586b', fontFamily: 'sans-serif', fontSize: '13px', lineSpacing: 2 })
      .setScrollFactor(0)
      .setDepth(1001);
    this.inventoryText = this.add
      .text(370, 12, '', { align: 'right', color: '#39776e', fontFamily: 'sans-serif', fontSize: '12px', lineSpacing: 2 })
      .setOrigin(1, 0)
      .setScrollFactor(0)
      .setDepth(1001);
    this.objectiveText = this.add
      .text(195, 51, '', {
        align: 'center',
        color: '#346c63',
        fontFamily: 'sans-serif',
        fontSize: '12px',
        wordWrap: { width: 360 },
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(1001);
    this.sceneText = this.add
      .text(195, 92, '', {
        backgroundColor: 'rgba(250,255,255,0.94)',
        color: '#28586b',
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
        backgroundColor: 'rgba(250,255,255,0.94)',
        color: '#39776e',
        fontFamily: 'sans-serif',
        fontSize: '13px',
        padding: { x: 9, y: 5 },
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(1001);

    const dangerBg = this.add.rectangle(195, 828, 360, 12, 0xd4eae5, 0.95).setScrollFactor(0).setDepth(1000);
    dangerBg.setInteractive({ useHandCursor: true });
    dangerBg.on('pointerdown', () => this.moveToScene('defense'));
    this.dangerFill = this.add.rectangle(15, 828, 0, 12, 0xd65a42, 1).setOrigin(0, 0.5).setScrollFactor(0).setDepth(1001);

    this.nightOverlay = this.add.rectangle(195, 422, 390, 844, 0x17254c, 0).setScrollFactor(0).setDepth(900);
    this.nightOverlay.setBlendMode(Phaser.BlendModes.MULTIPLY);
    const sound = this.add.text(367, 94, '声 开', { color: '#39776e', backgroundColor: '#faffff', padding: { x: 5, y: 5 }, fontSize: '11px' }).setOrigin(0.5).setScrollFactor(0).setDepth(1100).setInteractive({ useHandCursor: true });
    sound.on('pointerdown', (_p: Phaser.Input.Pointer, _x: number, _y: number, event: Phaser.Types.Input.EventData) => {
      event.stopPropagation(); this.audio.unlock(); this.audio.enabled = !this.audio.enabled; sound.setText(this.audio.enabled ? '声 开' : '声 关');
    });
    const pause = this.add.text(325, 94, '暂停', { color: '#39776e', backgroundColor: '#faffff', padding: { x: 5, y: 5 }, fontSize: '11px' }).setOrigin(0.5).setScrollFactor(0).setDepth(1100).setInteractive({ useHandCursor: true });
    pause.on('pointerdown', (_p: Phaser.Input.Pointer, _x: number, _y: number, event: Phaser.Types.Input.EventData) => { event.stopPropagation(); this.setPaused(true); });
    this.saveLabel = this.add.text(14, 92, '自动存档', { color: '#39776e', backgroundColor: '#faffff', padding: { x: 4, y: 3 }, fontSize: '10px' }).setScrollFactor(0).setDepth(1001);
    this.pauseShade = this.add.rectangle(195, 422, 390, 844, 0x173b50, 0.7).setScrollFactor(0).setDepth(1500).setVisible(false).setInteractive();
    this.pauseMessage = this.add.text(195, 422, '小院已暂停\n\n点击任意处继续', { color: '#ffffff', fontSize: '23px', align: 'center', lineSpacing: 8 }).setOrigin(0.5).setScrollFactor(0).setDepth(1501).setVisible(false);
    this.pauseShade.on('pointerdown', (_p: Phaser.Input.Pointer, _x: number, _y: number, event: Phaser.Types.Input.EventData) => { event.stopPropagation(); this.setPaused(false); });
    this.toastText = this.add
      .text(195, 700, '', {
        align: 'center',
        backgroundColor: 'rgba(250,255,255,0.97)',
        color: '#28586b',
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
      this.audio.unlock();
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
          this.audio.play('chop');
          this.cutEffect();
          const origin = sceneOrigins.kitchen;
          this.rewardEffect(origin.x + 233, origin.y + 600, '切配 ' + Math.min(this.state.kitchen.cuts, 3) + '/3');
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
          this.audio.play('machine');
          this.sparkEffect(sceneOrigins.factory.x + 82, sceneOrigins.factory.y + 420);
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
      if (!this.swipeStart.axis && Math.max(Math.abs(deltaX), Math.abs(deltaY)) > 8) this.swipeStart.axis = Math.abs(deltaX) > Math.abs(deltaY) ? 'x' : 'y';
      const horizontal = this.swipeStart.axis === 'x';
      const amount = horizontal ? deltaX : deltaY;
      const current = scenePositions[this.currentScene];
      const adjacent = worldScenes.find(scene => scenePositions[scene].x === current.x + (horizontal ? (amount < 0 ? 1 : -1) : 0)
        && scenePositions[scene].y === current.y + (horizontal ? 0 : (amount < 0 ? 1 : -1)));
      const allowed = adjacent && canMoveBetweenScenes(this.currentScene, adjacent);
      const travel = allowed ? Phaser.Math.Clamp(amount, horizontal ? -VIEW_WIDTH : -VIEW_HEIGHT, horizontal ? VIEW_WIDTH : VIEW_HEIGHT) : Phaser.Math.Clamp(amount * 0.12, -18, 18);
      if (horizontal) {
        this.cameras.main.scrollX = Phaser.Math.Clamp(this.swipeStart.scrollX - travel, 0, VIEW_WIDTH * 2);
        this.cameras.main.scrollY = this.swipeStart.scrollY;
      } else {
        this.cameras.main.scrollY = Phaser.Math.Clamp(this.swipeStart.scrollY - travel, 0, VIEW_HEIGHT * 2);
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
    for (const hint of this.hintPanels) {
      const { label, panel } = hint;
      panel.setVisible(label.visible);
      if (hint.width === label.width && hint.height === label.height) continue;
      hint.width = label.width; hint.height = label.height;
      panel.clear();
      panel.fillStyle(0x39776e, 0.12).fillRoundedRect(label.x - label.width / 2, label.y - label.height / 2 + 2, label.width, label.height, 8);
      panel.fillStyle(0xfaffff, 0.96).fillRoundedRect(label.x - label.width / 2, label.y - label.height / 2, label.width, label.height, 8);
    }
  }

  private syncFarm(): void {
    this.wateringPipes.clear();
    if (this.state.progression.watering) {
      const { x, y } = sceneOrigins.farm;
      this.wateringPipes.lineStyle(5, 0xd7f9fa, 0.9).lineBetween(x + 39, y + 335, x + 39, y + 610);
      this.wateringPipes.lineStyle(2, 0x6fa8bd).lineBetween(x + 39, y + 335, x + 39, y + 610);
      for (const row of [346, 449, 550]) {
        this.wateringPipes.lineStyle(4, 0xa6d9e6, 0.95).lineBetween(x + 39, y + row, x + 345, y + row);
        for (const column of [98, 195, 292]) {
          const drop = (this.time.now / 700 + column / 100) % 1;
          this.wateringPipes.fillStyle(0xaeefff, 1 - drop).fillCircle(x + column, y + row + drop * 19, 2.5);
        }
      }
      this.wateringPipes.fillStyle(0xeafffa).fillRoundedRect(x + 315, y + 295, 37, 35, 5);
      this.wateringPipes.fillStyle(0x53bea9).fillCircle(x + 334, y + 312, 8);
    }
    this.state.farm.plots.forEach((plot, index) => {
      const sprite = this.farmSprites[index];
      const label = this.farmLabels[index];
      if (!sprite || !label) return;
      sprite.setVisible(plot.stage !== 'empty');
      if (plot.stage === 'ready') {
        sprite.setCrop();
        sprite.setTexture('carrot').setDisplaySize(70, 70);
        label.setText('成熟');
      } else if (plot.stage === 'growing') {
        sprite.setTexture('carrot').setDisplaySize(22 + Math.min(28, (this.state.runtime.totalSeconds - plot.plantedAt) / plot.growSeconds * 28), 40);
        sprite.setTint(0xb9ddaa);
        sprite.setCrop(50, 0, 206, 140);
        const effective = plot.watered ? plot.growSeconds * 0.65 : plot.growSeconds;
        const remaining = Math.max(0, Math.ceil(effective - (this.state.runtime.totalSeconds - plot.plantedAt)));
        label.setText(`${plot.watered ? '已浇水 ' : ''}${remaining}秒`);
      } else label.setText('点击播种');
      if (plot.stage === 'ready') sprite.clearTint();
    });
  }

  private syncKitchen(): void {
    const origin = sceneOrigins.kitchen;
    this.cutterMachine.setVisible(this.state.progression.cutter);
    this.kitchenBoardHint.setText(this.state.progression.cutter ? '自动切菜机' : '砧板 · 划动切菜');
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
    this.cabinetMeals.forEach((meal, index) => meal.setVisible(index < this.state.inventory.stew));
    this.potSurface.clear();
    if (this.state.kitchen.pot === 'empty') {
      this.potSurface.fillStyle(0xb8d6df, 1).fillEllipse(origin.x + 205, origin.y + 382, 92, 27);
      this.potSurface.lineStyle(1, 0x8bb1bf).strokeEllipse(origin.x + 205, origin.y + 382, 92, 27);
    } else if (this.state.kitchen.pot === 'burnt') {
      this.potSurface.fillStyle(0x695554, 0.96).fillEllipse(origin.x + 205, origin.y + 382, 74, 27);
    }
    this.kitchenFx.clear();
    if (this.state.kitchen.pot === 'cooking' || this.state.kitchen.pot === 'ready') {
      for (let i = 0; i < 4; i += 1) {
        const phase = (this.time.now / 1800 + i / 4) % 1;
        this.kitchenFx.fillStyle(0xffffff, (1 - phase) * 0.75);
        this.kitchenFx.fillCircle(origin.x + 180 + i * 15 + Math.sin(phase * 5) * 5, origin.y + 375 - phase * 55, 4 + phase * 8);
      }
      const progress = Phaser.Math.Clamp((this.state.runtime.totalSeconds - this.state.kitchen.cookStartedAt) / 10, 0, 1);
      this.kitchenFx.fillStyle(0xe0edea).fillRoundedRect(origin.x + 162, origin.y + 447, 86, 5, 2);
      this.kitchenFx.fillStyle(this.state.kitchen.pot === 'ready' ? 0xeda885 : 0x5cbda9).fillRoundedRect(origin.x + 162, origin.y + 447, 86 * progress, 5, 2);
    }
  }

  private syncFront(): void {
    const origin = sceneOrigins.front;
    this.frontStew.setVisible(this.state.inventory.stew > 0);
    this.guest.setVisible(this.state.front.active || this.time.now < this.guestDepartingUntil);
    this.guest.setFlipX(this.state.front.visitorId % 2 === 0);
    this.orderIcon.setVisible(this.state.front.active);
    this.orderText.setVisible(this.state.front.active);
    if (!this.dragging.has(this.frontStew)) this.frontStew.setPosition(origin.x + 96, origin.y + 675);
    const patienceRatio = Phaser.Math.Clamp(this.state.front.patience / this.state.front.maxPatience, 0, 1);
    this.patienceFill.width = this.state.front.active ? 210 * patienceRatio : 0;
    this.patienceFill.fillColor = patienceRatio > 0.5 ? 0xe3c461 : patienceRatio > 0.2 ? 0xe28b43 : 0xd64b3f;
    this.visitorText.setText(this.state.front.active ? `想喝一碗热汤 · 已救助 ${this.state.front.served} 人`
      : this.state.runtime.timeInDay / this.state.runtime.dayLength * 24 >= 19 || this.state.runtime.timeInDay / this.state.runtime.dayLength * 24 < 6
        ? '晚安，伙伴们在明天清晨回来' : '休息片刻 · 下一位伙伴很快就到');
  }

  private syncFactoryAndBeacon(): void {
    const origin = sceneOrigins.factory;
    this.productionControls.forEach(control => control.setVisible(this.state.tutorial.completed));
    this.productLabels.forEach((label, product) => label.setColor(product === this.state.factory.selected ? '#c47948' : '#39776e'));
    this.factoryScrap.setVisible(this.state.factory.phase === 'idle' && this.state.inventory.scrap > 0);
    if (!this.dragging.has(this.factoryScrap)) this.factoryScrap.setPosition(origin.x + 58, origin.y + 680);

    const pieceVisible = ['cutting', 'cut', 'welding', 'welded', 'assembly'].includes(this.state.factory.phase);
    this.factoryPiece.setVisible(pieceVisible);
    if (!this.dragging.has(this.factoryPiece)) {
      if (this.state.factory.phase === 'cutting' || this.state.factory.phase === 'cut') this.factoryPiece.setPosition(origin.x + 82, origin.y + 420);
      else if (this.state.factory.phase === 'welding' || this.state.factory.phase === 'welded') this.factoryPiece.setPosition(origin.x + 306, origin.y + 420);
      else this.factoryPiece.setPosition(origin.x + 205, origin.y + 550);
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
    if (this.state.factory.phase === 'idle' && this.state.tutorial.completed) this.factoryText.setText(`${products[this.state.factory.selected].name} · ${products[this.state.factory.selected].cost}废料 → 拖至切割台`);
    this.factoryFx.clear();
    if (this.state.factory.phase === 'welding') {
      const intensity = this.weldingHeld ? 1 : 0.35;
      this.factoryFx.fillStyle(0xb8f7ff, intensity * 0.5).fillCircle(origin.x + 306, origin.y + 420, 20 + Math.sin(this.time.now / 40) * 4);
      this.factoryFx.lineStyle(2, 0xffffff, intensity);
      for (let i = 0; i < 8; i += 1) {
        const angle = i * Math.PI / 4 + this.time.now / 400;
        this.factoryFx.lineBetween(origin.x + 306 + Math.cos(angle) * 10, origin.y + 420 + Math.sin(angle) * 10, origin.x + 306 + Math.cos(angle) * 28, origin.y + 420 + Math.sin(angle) * 28);
      }
    }

    this.beaconPart.setVisible(this.state.tutorial.step === 'start-beacon' && this.state.inventory.parts > 0);
    this.beaconScrap.setVisible(this.state.tutorial.step === 'repair-beacon' && this.state.inventory.scrap > 0);
    if (!this.dragging.has(this.beaconPart)) this.beaconPart.setPosition(origin.x + 235, origin.y + 280);
    if (!this.dragging.has(this.beaconScrap)) this.beaconScrap.setPosition(origin.x + 235, origin.y + 280);
    this.beaconText.setText(
      this.state.world.beaconStage > 0
        ? `信标 ${this.state.world.beaconStage}/3 · ${this.state.tutorial.completed ? '点击塔身查看/维修' : '机枪塔图纸已解锁'}`
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
      this.tweens.add({ targets: sprite, alpha: 0, angle: 18, y: sprite.y + 15, duration: 240, onComplete: () => sprite.destroy() });
      this.zombieBars.get(id)?.destroy();
      this.zombieShadows.get(id)?.destroy();
      this.zombieSprites.delete(id);
      this.zombieBars.delete(id);
      this.zombieShadows.delete(id);
      this.lastZombieHp.delete(id);
      this.lastZombieHit.delete(id);
    }

    for (const zombie of this.state.defense.zombies) {
      let sprite = this.zombieSprites.get(zombie.id);
      if (!sprite) {
        this.zombieShadows.set(zombie.id, this.add.ellipse(0, 0, 62, 15, 0x23484e, 0.2));
        sprite = this.add.image(0, 0, zombie.kind === 'brute' ? 'brute' : zombie.kind === 'refugee' ? 'infected' : 'zombie').setDisplaySize(
          zombie.kind === 'brute' ? 118 : 94,
          zombie.kind === 'brute' ? 118 : 94,
        );
        sprite.setInteractive({ useHandCursor: true });
        sprite.on('pointerdown', (_pointer: Phaser.Input.Pointer, _x: number, _y: number, event: Phaser.Types.Input.EventData) => {
          event.stopPropagation();
          const target = this.state.defense.zombies.find((item) => item.id === zombie.id);
          if (!target) return;
          if (target.kind !== 'tap-tutorial') { this.firingZombieId = target.id; this.lastHeldShot = this.state.runtime.totalSeconds; }
          if (target.kind !== 'hold-tutorial' && shoot(this.state, target)) this.shotEffect(target);
          this.cameras.main.shake(45, 0.002);
        });
        const bar = this.add.rectangle(0, 0, 58, 6, 0x65c76b).setOrigin(0, 0.5);
        this.zombieSprites.set(zombie.id, sprite);
        this.zombieBars.set(zombie.id, bar);
      }
      const x = origin.x + zombie.x;
      const y = origin.y + 345 + zombie.lane * 142;
      sprite.setPosition(x, y + Math.sin(this.time.now / 120 + zombie.id) * 2.5);
      this.zombieShadows.get(zombie.id)?.setPosition(x, y + 40);
      if ((this.lastZombieHp.get(zombie.id) ?? zombie.hp) > zombie.hp) {
        this.lastZombieHit.set(zombie.id, this.time.now);
        sprite.setTint(0xffd6cb);
        this.time.delayedCall(90, () => { if (sprite?.active) sprite.clearTint(); });
      }
      this.lastZombieHp.set(zombie.id, zombie.hp);
      const bar = this.zombieBars.get(zombie.id);
      if (bar) {
        bar.setPosition(x - 29, y - 62);
        bar.width = 58 * Phaser.Math.Clamp(zombie.hp / zombie.maxHp, 0, 1);
        bar.setVisible(this.time.now - (this.lastZombieHit.get(zombie.id) ?? -5000) < 1500);
      }
    }

    this.turretKit.setVisible(this.state.defense.kits > 0);
    if (!this.dragging.has(this.turretKit)) this.turretKit.setPosition(origin.x + 286, origin.y + 716);
    for (const tower of this.state.defense.towers) {
      let sprite = this.towerSprites.get(tower.lane);
      if (!sprite) {
        sprite = this.add.image(origin.x + 108, origin.y + 356 + tower.lane * 142, 'turret').setDisplaySize(110, 110).setInteractive({ useHandCursor: true });
        sprite.on('pointerdown', (_p: Phaser.Input.Pointer, _x: number, _y: number, event: Phaser.Types.Input.EventData) => { event.stopPropagation(); this.showToast(startRepair(this.state, tower.lane)); });
        this.towerSprites.set(tower.lane, sprite);
        this.towerHints.set(tower.lane, this.addHint(origin.x + 108, origin.y + 410 + tower.lane * 142, ''));
      }
      sprite.setTint(tower.hp <= 0 ? 0x7b8290 : 0xffffff);
      sprite.setAlpha(tower.hp <= 0 ? 0.7 : 1);
      this.towerHints.get(tower.lane)?.setText(tower.repairAt !== null ? `维修 ${Math.max(0, Math.ceil(tower.repairAt - this.state.runtime.totalSeconds))}秒`
        : tower.hp <= 0 ? '已损坏 · 点此维修' : `炮塔 ${Math.ceil(tower.hp)}/${tower.maxHp}`);
    }
    this.barriers.forEach((barrier, index) => barrier.setAlpha((this.state.defense.barricades[index] ?? 0) > 0 ? 1 : 0.22));
    this.gunStatus.setText(this.state.defense.reloadAt !== null ? '正在换弹…' : `手枪 ${this.state.defense.ammo}/10 · 长按连射 · 维修工具 ${this.state.inventory.repairTools}`);
    this.houseRepairHint.setText(this.state.defense.houseRepairAt !== null ? `房屋维修 ${Math.max(0, Math.ceil(this.state.defense.houseRepairAt - this.state.runtime.totalSeconds))}秒` : '点院门维修房屋与路障');
  }

  private syncHud(): void {
    const dayProgress = this.state.runtime.timeInDay / this.state.runtime.dayLength;
    const hour = Math.floor(dayProgress * 24);
    const minute = Math.floor((dayProgress * 24 - hour) * 60);
    const period = this.state.runtime.bloodMoon ? '血月之夜' : hour >= 19 || hour < 6 ? '夜晚' : '白天';
    this.statusText.setText(`家园 Lv.${this.state.world.houseLevel}  第 ${this.state.runtime.day} 天 ${period}\n房屋 ${Math.ceil(this.state.world.houseHp)}/${this.state.world.houseMaxHp}`);
    this.inventoryText.setText(`胡萝卜 ${this.state.inventory.carrots}  热汤 ${this.state.inventory.stew}\n废料 ${this.state.inventory.scrap} 工具${this.state.inventory.repairTools} ${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`);
    this.objectiveText.setText(this.currentScene === 'kitchen' && this.state.tutorial.step === 'cook'
      ? this.kitchenInstruction() : this.state.tutorial.completed ? currentObjective(this.state) : tutorialObjectives[this.state.tutorial.step]);
    this.sceneText.setText(sceneLabels[this.currentScene]);
    this.edgeHintText.setText(this.getEdgeHint());

    const closest = this.state.defense.zombies.reduce<number>((value, zombie) => Math.min(value, zombie.x), 390);
    const danger = Phaser.Math.Clamp(1 - closest / 390, 0, 1);
    this.dangerFill.width = 360 * danger;
    this.dangerFill.fillColor = danger > 0.7 ? 0xd64235 : danger > 0.35 ? 0xe3a044 : 0x66ae62;
    const night = hour >= 19 || hour < 6;
    const nightAmount = night ? 1 : hour >= 18 ? hour - 18 : hour < 7 ? 7 - hour : 0;
    this.worldNights.forEach(image => image.setAlpha(nightAmount));
    this.nightOverlay.setAlpha(nightAmount * (this.state.runtime.bloodMoon ? 0.22 : 0.12));
    this.nightOverlay.fillColor = this.state.runtime.bloodMoon ? 0xd17891 : 0x8c9fcf;
    this.drawFocusRing();
  }

  private getEdgeHint(): string {
    if (this.currentScene === 'front') return '左划去农田 · 右划去防线\n上划进厨房 · 下划去工厂';
    return { farm: '向右划回中央前台', defense: '向左划回中央前台',
      kitchen: '向下划回中央前台', factory: '向上划回中央前台' }[this.currentScene];
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
    const label = this.add
      .text(x, y, text, {
        align: 'center',
        color: '#39776e',
        fontFamily: 'sans-serif',
        fontSize: '13px',
        padding: { x: 7, y: 4 },
      })
      .setOrigin(0.5).setDepth(6);
    const panel = this.add.graphics().setDepth(5);
    panel.fillStyle(0x39776e, 0.12).fillRoundedRect(x - label.width / 2, y - label.height / 2 + 2, label.width, label.height, 8);
    panel.fillStyle(0xfaffff, 0.96).fillRoundedRect(x - label.width / 2, y - label.height / 2, label.width, label.height, 8);
    this.hintPanels.push({ label, panel, width: label.width, height: label.height });
    return label;
  }

  private isNear(x: number, y: number, targetX: number, targetY: number, radius: number): boolean {
    return Phaser.Math.Distance.Between(x, y, targetX, targetY) <= radius;
  }

  private kitchenInstruction(): string {
    const kitchen = this.state.kitchen;
    if (kitchen.plateReady) return '把装好的热汤拖入右上方成品柜';
    if (kitchen.pot === 'ready') return '热汤煮好啦，点锅装盘';
    if (kitchen.pot === 'burnt') return '料理糊了，点击锅清理后重新制作';
    if (kitchen.pot === 'cooking') return '热汤正在煮，等进度满后点锅装盘';
    if (kitchen.bowlPieces > 0) return '把备菜碗里的碎菜拖到蓝色汤锅';
    if (kitchen.board === 'chopped') return '把切好的菜拖进左侧备菜碗';
    if (kitchen.board === 'whole') return this.state.progression.cutter ? '切菜机正在处理，请稍候' : '在砧板上的胡萝卜来回划动切菜';
    return '把左侧胡萝卜拖到右下方砧板';
  }

  private rewardEffect(x: number, y: number, message: string): void {
    const label = this.add.text(x, y, message, {
      fontFamily: 'sans-serif', fontSize: '17px', fontStyle: 'bold',
      color: '#288b79', stroke: '#ffffff', strokeThickness: 4,
    }).setOrigin(0.5).setDepth(85);
    this.tweens.add({ targets: label, y: y - 45, alpha: 0, duration: 1000, ease: 'Cubic.Out', onComplete: () => label.destroy() });
  }

  private shotEffect(target: ZombieState, turretLane?: number): void {
    const origin = sceneOrigins.defense;
    const beam = this.add.graphics().setDepth(70);
    beam.lineStyle(3, 0x9eefff, 0.9);
    beam.lineBetween(origin.x + (turretLane === undefined ? 195 : 123), origin.y + (turretLane === undefined ? 760 : 345 + turretLane * 142),
      origin.x + target.x, origin.y + 345 + target.lane * 142);
    beam.fillStyle(0xffffff).fillCircle(origin.x + target.x, origin.y + 345 + target.lane * 142, 7);
    this.audio.play('shot');
    const cannon = turretLane === undefined ? null : this.towerSprites.get(turretLane);
    if (cannon) this.tweens.add({ targets: cannon, x: cannon.x - 3, duration: 60, yoyo: true });
    this.tweens.add({ targets: beam, alpha: 0, duration: 150, onComplete: () => beam.destroy() });
  }

  private drawKitchenTools(origin: { x: number; y: number }): void {
    const g = this.add.graphics();
    const { x, y } = origin;
    g.fillStyle(0x37677b, 0.15).fillEllipse(x + 205, y + 431, 119, 21);
    g.fillStyle(0x427b83, 0.15).fillEllipse(x + 95, y + 644, 99, 20);
    g.fillStyle(0xfaffff).fillEllipse(x + 300, y + 541, 88, 26);
    g.lineStyle(3, 0x9ac9df).strokeEllipse(x + 300, y + 541, 75, 18);
    this.add.image(x + 205, y + 403, 'pot').setDisplaySize(132, 115);
    this.add.image(x + 233, y + 612, 'board').setDisplaySize(138, 115);
    this.cutterMachine = this.add.graphics().setDepth(1).setVisible(false);
    this.cutterMachine.fillStyle(0x7bbcae).fillRoundedRect(x + 172, y + 550, 122, 17, 6);
    this.cutterMachine.fillStyle(0xdff6f0).fillRoundedRect(x + 176, y + 554, 8, 61, 3);
    this.cutterMachine.fillRoundedRect(x + 283, y + 554, 8, 61, 3);
    this.cutterMachine.fillStyle(0xffffff).fillCircle(x + 276, y + 558, 9);
    this.cutterMachine.fillStyle(0x58b5a2).fillCircle(x + 276, y + 558, 4);
    this.knife = this.add.graphics().setDepth(40).setVisible(false);
    const blade = [new Phaser.Math.Vector2(-38, -4), new Phaser.Math.Vector2(12, -4), new Phaser.Math.Vector2(12, 9), new Phaser.Math.Vector2(-34, 9)];
    this.knife.fillStyle(0xebf6fa).fillPoints(blade, true);
    this.knife.lineStyle(1, 0x88aab8).strokePoints(blade, true);
    this.knife.fillStyle(0x559d90).fillRoundedRect(12, -3, 24, 11, 4);
    this.add.image(x + 95, y + 624, 'prep-bowl').setDisplaySize(106, 88);
    this.add.image(x + 342, y + 322, 'cabinet').setDisplaySize(82, 151);
    for (let index = 0; index < 3; index += 1) {
      this.cabinetMeals.push(this.add.image(x + 342, y + 290 + index * 31, 'stew').setDisplaySize(31, 29));
    }
    this.potSurface = this.add.graphics();
  }

  private drawFocusRing(): void {
    const origin = sceneOrigins[this.currentScene];
    let target: { x: number; y: number; radius: number } | null = null;
    const step = this.state.tutorial.step;
    if (this.currentScene === 'farm' && ['harvest', 'plant'].includes(step)) target = { x: 98, y: 382, radius: 43 };
    if (this.currentScene === 'kitchen' && step === 'cook') {
      const k = this.state.kitchen;
      target = k.plateReady ? { x: 300, y: 534, radius: 47 }
        : k.pot !== 'empty' ? { x: 205, y: 405, radius: 53 }
          : k.bowlPieces ? { x: 95, y: 618, radius: 45 }
            : k.board !== 'empty' ? { x: 233, y: 610, radius: 51 }
              : { x: 58, y: 535, radius: 40 };
    }
    if (this.currentScene === 'front' && step === 'serve') target = { x: 96, y: 675, radius: 51 };
    if (this.currentScene === 'factory' && ['make-part', 'make-turret'].includes(step)) {
      const phase = this.state.factory.phase;
      target = phase === 'idle' ? { x: 58, y: 680, radius: 47 }
        : phase === 'welding' || phase === 'welded' ? { x: 306, y: 420, radius: 47 }
          : phase === 'assembly' ? { x: 205, y: 550, radius: 47 } : { x: 82, y: 420, radius: 47 };
    }
    if (this.currentScene === 'factory' && ['start-beacon', 'repair-beacon'].includes(step)) target = { x: 235, y: 280, radius: 47 };
    this.focusRing.clear();
    if (target) {
      const pulse = (Math.sin(this.time.now / 230) + 1) / 2;
      this.focusRing.lineStyle(3, 0x5bc9bb, 0.45 + pulse * 0.4);
      this.focusRing.strokeCircle(origin.x + target.x, origin.y + target.y, target.radius + pulse * 4);
      this.focusRing.lineStyle(2, 0xffffff, 0.9);
      this.focusRing.strokeCircle(origin.x + target.x, origin.y + target.y, target.radius - 4);
    }
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

  private setPaused(paused: boolean): void {
    this.pausedByPlayer = paused;
    this.state.runtime.paused = paused || document.hidden;
    this.lastWallTime = performance.now();
    this.pauseShade.setVisible(paused); this.pauseMessage.setVisible(paused);
    this.firingZombieId = null; this.weldingHeld = false; this.cutting = false;
    if (paused) saveGame(this.state);
  }

  private beaconEffect(origin: { x: number; y: number }): void {
    this.audio.play('beacon');
    for (let i = 0; i < 3; i += 1) {
      const ring = this.add.circle(origin.x + 195, origin.y + 175, 15, 0x9cf4ef, 0).setStrokeStyle(3, 0xb8ffff, 0.9).setDepth(50);
      this.tweens.add({ targets: ring, scale: 7, alpha: 0, delay: i * 350, duration: 1500, onComplete: () => ring.destroy() });
    }
  }

  private cutEffect(): void {
    const origin = sceneOrigins.kitchen;
    this.knife.setVisible(true).setPosition(origin.x + 233, origin.y + 590).setAngle(-15);
    this.tweens.killTweensOf(this.knife);
    this.tweens.add({ targets: this.knife, y: origin.y + 612, angle: 25, duration: 90, yoyo: true, onComplete: () => this.knife.setVisible(false) });
    for (let i = 0; i < 2; i += 1) {
      const slice = this.add.image(origin.x + 233, origin.y + 610, 'chopped').setDisplaySize(30, 30).setDepth(30);
      this.tweens.add({ targets: slice, x: slice.x + (i ? 22 : -22), y: slice.y + 12, angle: i ? 25 : -25, alpha: 0, duration: 450, onComplete: () => slice.destroy() });
    }
  }

  private sparkEffect(x: number, y: number): void {
    const spark = this.add.graphics().setDepth(35);
    spark.lineStyle(2, 0xffd37d);
    for (let i = 0; i < 9; i += 1) {
      const a = i * Math.PI * 2 / 9;
      spark.lineBetween(x + Math.cos(a) * 7, y + Math.sin(a) * 7, x + Math.cos(a) * 30, y + Math.sin(a) * 30);
    }
    this.tweens.add({ targets: spark, alpha: 0, duration: 250, onComplete: () => spark.destroy() });
  }

  private installDebugBridge(): void {
    if (new URLSearchParams(location.search).get('qa') === '1') {
      (window as typeof window & { __MORI_OBSERVE__?: () => GameState }).__MORI_OBSERVE__ = () => structuredClone(this.state);
    }
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
    this.state.runtime.paused = document.hidden || this.pausedByPlayer;
    this.lastWallTime = performance.now();
    if (document.hidden) saveGame(this.state);
  };
}
