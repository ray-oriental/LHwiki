import Matter from "matter-js";
import {
  ARENA_WIDTH, ARENA_HEIGHT, schoolByLevel, LUHE_LEVEL
} from "../data/schools";
import { createPhysicsWorld, PHYSICS_STEP_MS, MAX_STEPS_PER_FRAME } from "./Physics";
import { MergeSystem } from "./MergeSystem";
import { SpawnSystem, spawnBallInto } from "./SpawnSystem";
import { ScoreSystem } from "./ScoreSystem";
import { GameOverSystem } from "./GameOverSystem";
import { LuheEvent } from "./LuheEvent";
import { Particles } from "./Particles";
import { Renderer, LogoCache, type GameTheme } from "./Renderer";
import { InputController } from "./Input";
import { UI } from "../ui/UI";
import { AudioManager } from "../audio/AudioManager";
import { getMeta, resetBallIds } from "./types";

export interface GreatLuheOptions {
  /** 校徽资源路径前缀（如 "games/great-luhe/"），默认空 = 相对当前页面 */
  assetBase?: string;
  theme?: GameTheme;
}

export class GreatLuheGame {
  private container: HTMLElement;
  private options: GreatLuheOptions;
  private mounted = false;

  private ui!: UI;
  private renderer!: Renderer;
  private logos!: LogoCache;
  private particles!: Particles;
  private audio!: AudioManager;
  private score!: ScoreSystem;
  private spawn!: SpawnSystem;
  private merge!: MergeSystem;
  private gameOverSys!: GameOverSystem;
  private luhe!: LuheEvent;
  private input!: InputController;

  private engine!: Matter.Engine;
  private world!: Matter.World;
  private floor!: Matter.Body;

  private rafId = 0;
  private lastFrame = 0;
  private accumulator = 0;
  private resizeObserver: ResizeObserver | null = null;
  private onWindowResize: (() => void) | null = null;
  private gameOver = false;
  private startTime = 0;
  private theme: GameTheme = "light";

  constructor(container: HTMLElement, options: GreatLuheOptions = {}) {
    this.container = container;
    this.options = options;
    this.theme = options.theme === "dark" ? "dark" : "light";
  }

  private now(): number {
    return performance.now() - this.startTime;
  }

  mount(): void {
    if (this.mounted) return;
    this.mounted = true;
    this.startTime = performance.now();

    const assetBase = this.options.assetBase ?? "";
    this.ui = new UI(this.container, assetBase);
    this.particles = new Particles();
    this.audio = new AudioManager();
    this.score = new ScoreSystem();
    this.logos = new LogoCache(assetBase);
    this.logos.load();
    this.renderer = new Renderer(this.ui.canvas, this.logos, this.particles);
    this.setTheme(this.theme);

    const pw = createPhysicsWorld();
    this.engine = pw.engine;
    this.world = pw.engine.world;
    this.floor = pw.floor;

    this.spawn = new SpawnSystem(() => this.now());
    this.merge = new MergeSystem(this.world, () => this.now());
    this.gameOverSys = new GameOverSystem(this.world, () => this.now());

    this.luhe = new LuheEvent({
      engine: this.engine,
      world: this.world,
      floor: this.floor,
      particles: this.particles,
      score: this.score,
      audio: this.audio,
      now: () => this.now(),
      logicalToScreen: (x, y) => this.logicalToScreen(x, y),
      setDim: (on) => this.ui.setDim(on),
      setHeavyText: (t) => this.ui.setHeavyText(t),
      setInputLocked: (locked) => { this.spawn.inputLocked = locked; },
      addShake: (a) => this.renderer.addShake(a),
      getLuheImage: () => this.logos.get(LUHE_LEVEL)
    });
    this.luhe.attachFxCanvas(this.ui.createFxLayer());

    // ---- 事件接线 ----
    this.score.onChange = () =>
      this.ui.setScore(this.score.score, this.score.best, this.score.luheCount);
    this.spawn.onNextChange = () => this.ui.setNext(this.spawn.nextLevel);
    this.spawn.onDrop = (level, x, y) => {
      const body = spawnBallInto(this.world, level, x, y, this.now());
      Matter.Body.setVelocity(body, { x: 0, y: 2 });
      this.audio.play("drop");
      return body;
    };
    this.merge.onMerge = ({ x, y, vx, vy, newLevel }) => {
      const school = schoolByLevel(newLevel);
      const cx = Math.min(ARENA_WIDTH - school.radius - 2, Math.max(school.radius + 2, x));
      const body = spawnBallInto(this.world, newLevel, cx, y, this.now());
      Matter.Body.setVelocity(body, { x: vx, y: vy });
      getMeta(body).popAt = this.now();
      this.score.add(school.mergeScore);
      this.score.noteLevel(newLevel);
      this.particles.burst(x, y, school.color, 10 + newLevel * 2, 5);
      this.particles.ring(x, y, "#b03060", school.radius);
      this.particles.floatText(x, y - school.radius * 0.5, `+${school.mergeScore}`, "#b03060", 14 + newLevel);
      this.audio.play("merge", newLevel);
      this.renderer.addShake(Math.min(5, 1 + newLevel * 0.4));
      if (newLevel >= LUHE_LEVEL) {
        this.luhe.onLuheCreated(body);
      }
    };
    this.gameOverSys.onGameOver = () => this.handleGameOver();

    Matter.Events.on(this.engine, "collisionStart", (ev) => {
      this.merge.handleCollisionPairs(ev.pairs);
    });

    // ---- 输入 ----
    this.input = new InputController(this.ui.canvas);
    this.input.onAim = (x) => this.spawn.setAim(x);
    this.input.onDrop = () => {
      if (this.gameOver) return;
      this.spawn.drop();
    };
    this.input.onFirstInteract = () => this.audio.unlock();

    // ---- UI ----
    this.ui.onRestart = () => this.requestRestart();
    this.ui.onMuteToggle = () => {
      this.audio.unlock();
      this.audio.setMuted(!this.audio.muted);
      this.ui.setMuted(this.audio.muted);
    };
    this.ui.setMuted(this.audio.muted);
    this.ui.setScore(0, this.score.best, 0);
    this.ui.setNext(this.spawn.nextLevel);

    // ---- 尺寸 ----
    const fit = () => this.fitSize();
    this.resizeObserver = new ResizeObserver(fit);
    this.resizeObserver.observe(this.container);
    this.onWindowResize = fit;
    window.addEventListener("resize", fit);
    fit();

    this.lastFrame = performance.now();
    this.rafId = requestAnimationFrame((t) => this.loop(t));

    this.installDevHooks();
  }

  setTheme(theme: GameTheme): void {
    this.theme = theme === "dark" ? "dark" : "light";
    this.ui?.setTheme(this.theme);
    this.renderer?.setTheme(this.theme);
  }

  private logicalToScreen(x: number, y: number): { x: number; y: number; scale: number } {
    const rect = this.ui.canvas.getBoundingClientRect();
    const scale = rect.width / ARENA_WIDTH;
    return { x: rect.left + x * scale, y: rect.top + y * scale, scale };
  }

  private fitSize(): void {
    const w = Math.min(520, this.container.clientWidth || 480);
    this.renderer.resize(w);
    this.luhe.resizeFx(window.innerWidth, window.innerHeight);
  }

  private loop(t: number): void {
    if (!this.mounted) return;
    this.rafId = requestAnimationFrame((tt) => this.loop(tt));

    let frameMs = t - this.lastFrame;
    this.lastFrame = t;
    if (frameMs > 100) frameMs = 100; // 卡顿保护：丢弃过长帧
    if (frameMs < 0) frameMs = 0;

    // 固定步长物理推进
    this.accumulator += frameMs;
    let steps = 0;
    while (this.accumulator >= PHYSICS_STEP_MS && steps < MAX_STEPS_PER_FRAME) {
      Matter.Engine.update(this.engine, PHYSICS_STEP_MS);
      this.accumulator -= PHYSICS_STEP_MS;
      steps++;
    }
    if (steps >= MAX_STEPS_PER_FRAME) this.accumulator = 0;

    this.merge.flush();
    this.gameOverSys.enabled = !this.luhe.active && !this.gameOver;
    this.gameOverSys.update(frameMs);
    this.renderer.deathWarning = this.gameOverSys.warning;
    this.luhe.update(frameMs);
    this.particles.update(frameMs / 1000);
    this.renderer.floorCrackX = this.luhe.floorCrackX;

    this.renderer.render(this.world, this.spawn, this.now(), this.gameOver);
    this.luhe.renderFx();
  }

  private handleGameOver(): void {
    if (this.gameOver) return;
    this.gameOver = true;
    this.spawn.inputLocked = true;
    this.audio.play("gameOver");
    const maxSchool = schoolByLevel(this.score.maxLevel).name;
    setTimeout(() => {
      if (!this.mounted || !this.gameOver) return;
      this.ui.showGameOver(this.score.score, this.score.best, this.score.luheCount, maxSchool);
    }, 700);
  }

  private requestRestart(): void {
    this.audio.unlock();
    this.audio.play("click");
    if (this.gameOver || this.score.score === 0) {
      this.doRestart();
      return;
    }
    this.ui.showRestartConfirm(() => this.doRestart());
  }

  /** 彻底重开：清理 bodies / 队列 / 计时器 / 特效 / 计分 / 输入锁 */
  doRestart(): void {
    this.luhe.clear();
    this.merge.clear();
    const bodies = Matter.Composite.allBodies(this.world);
    for (const b of bodies) {
      if (b.label === "ball") Matter.Composite.remove(this.world, b);
    }
    resetBallIds();
    this.particles.clear();
    this.score.reset();
    this.spawn.reset();
    this.gameOverSys.reset();
    this.gameOver = false;
    this.spawn.inputLocked = false;
    this.accumulator = 0;
    this.ui.closeModal();
    this.ui.setScore(0, this.score.best, 0);
  }

  destroy(): void {
    if (!this.mounted) return;
    this.mounted = false;
    cancelAnimationFrame(this.rafId);
    this.luhe.clear();
    this.input.destroy();
    this.resizeObserver?.disconnect();
    if (this.onWindowResize) window.removeEventListener("resize", this.onWindowResize);
    Matter.Events.off(this.engine, "collisionStart", () => undefined);
    Matter.Composite.clear(this.world, false, true);
    Matter.Engine.clear(this.engine);
    this.ui.destroy();
    this.removeDevHooks();
  }

  // ---- 开发调试钩子（仅 dev 构建存在，生产构建不出现在玩家界面） ----
  private installDevHooks(): void {
    if (!import.meta.env.DEV) return;
    const g = this;
    (window as unknown as { __gluhe?: unknown }).__gluhe = {
      game: g,
      drop(level: number, x: number) {
        const body = spawnBallInto(g.world, level, x, 120, g.now());
        Matter.Body.setVelocity(body, { x: 0, y: 2 });
        return getMeta(body).id;
      },
      /** 测试死亡线判定：在指定位置放置静止球 */
      placeStatic(level: number, x: number, y: number) {
        const body = spawnBallInto(g.world, level, x, y, g.now());
        Matter.Body.setStatic(body, true);
        return getMeta(body).id;
      },
      triggerLuhe() {
        const s = schoolByLevel(LUHE_LEVEL);
        const body = spawnBallInto(g.world, LUHE_LEVEL, ARENA_WIDTH / 2, s.radius + 60, g.now());
        g.luhe.onLuheCreated(body);
        return getMeta(body).id;
      },
      state() {
        let pileTop = ARENA_HEIGHT;
        for (const b of Matter.Composite.allBodies(g.world)) {
          if (b.label !== "ball") continue;
          const top = b.position.y - schoolByLevel(getMeta(b).level).radius;
          if (top < pileTop) pileTop = top;
        }
        return {
          luheState: g.luhe.state,
          luheActive: g.luhe.active,
          score: g.score.score,
          luheCount: g.score.luheCount,
          gameOver: g.gameOver,
          inputLocked: g.spawn.inputLocked,
          balls: Matter.Composite.allBodies(g.world).filter(b => b.label === "ball").length,
          pileTop: Math.round(pileTop),
          floorPresent: !!Matter.Composite.get(g.world, g.floor.id, "body"),
          floorBroken: g.luhe.floorCrackX !== null
        };
      }
    };
  }

  private removeDevHooks(): void {
    if (!import.meta.env.DEV) return;
    delete (window as unknown as { __gluhe?: unknown }).__gluhe;
  }
}
