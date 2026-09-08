import Matter from "matter-js";
import {
  ARENA_WIDTH, ARENA_HEIGHT, LUHE_LEVEL,
  LUHE_MERGE_BONUS, LUHE_FINALE_BONUS, schoolByLevel
} from "../data/schools";
import { getMeta } from "./types";
import { makeLuheHeavy } from "./Physics";
import { Particles } from "./Particles";
import { ScoreSystem } from "./ScoreSystem";
import { AudioManager } from "../audio/AudioManager";

/**
 * 潞河终局事件 —— 有限状态机（FSM），不使用 setTimeout 链，避免竞态。
 *
 * IDLE → SPAWN（合成庆祝）
 *      → TEXT（"好……沉……"逐字出现，物理减速，画面压暗）
 *      → CRUSH_FALL（超重下坠，压碎下方球，按等级计分，每球仅一次）
 *      → BREAK_FLOOR（击穿底板）
 *      → VIEWPORT_FALL（脱离游戏画布，砸向浏览器视口底端）
 *      → EXPLODE（撞击屏幕底部，炸裂 + Finale Bonus）
 *      → RECOVER（恢复底板/输入/物理速度）
 *      → IDLE
 */
export const enum LuheState {
  IDLE = 0,
  SPAWN = 1,
  TEXT = 2,
  CRUSH_FALL = 3,
  BREAK_FLOOR = 4,
  VIEWPORT_FALL = 5,
  EXPLODE = 6,
  RECOVER = 7
}

export interface LuheHooks {
  engine: Matter.Engine;
  world: Matter.World;
  floor: Matter.Body;
  particles: Particles;
  score: ScoreSystem;
  audio: AudioManager;
  now: () => number;
  /** 逻辑坐标 → 屏幕 CSS 像素坐标（含缩放比） */
  logicalToScreen: (x: number, y: number) => { x: number; y: number; scale: number };
  setDim: (on: boolean) => void;
  setHeavyText: (text: string | null) => void;
  setInputLocked: (locked: boolean) => void;
  addShake: (amount: number) => void;
  getLuheImage: () => HTMLImageElement | null;
}

interface FxShard {
  x: number; y: number; vx: number; vy: number;
  size: number; rot: number; vr: number; color: string; life: number; maxLife: number;
}

const TEXT_STAGES: { at: number; text: string }[] = [
  { at: 0, text: "好" },
  { at: 450, text: "好……" },
  { at: 950, text: "好……沉" },
  { at: 1450, text: "好……沉……" }
];
const TEXT_TOTAL_MS = 2100;
const SPAWN_MS = 950;
const EXPLODE_MS = 1350;
const RECOVER_MS = 350;

export class LuheEvent {
  state: LuheState = LuheState.IDLE;
  private hooks: LuheHooks;
  private stateAt = 0;
  private luhe: Matter.Body | null = null;
  /** 事件期间又合成出的潞河（排队，绝不并发两个终局动画） */
  private queuedLuhe: Matter.Body[] = [];
  /** 本次事件已压碎的球 id（严格防重复计分） */
  private crushedIds = new Set<number>();
  /** 本次事件压碎得分累计（仅用于展示） */
  private crushTotal = 0;
  /** 底板"被击穿"的视觉裂缝位置（逻辑坐标；物理地板始终保留，
   *  超重潞河通过 mask 穿过，避免其他球从缺口漏出世界） */
  floorCrackX: number | null = null;

  // ---- 视口坠落/炸裂（屏幕坐标系） ----
  private fxCanvas: HTMLCanvasElement | null = null;
  private fxCtx: CanvasRenderingContext2D | null = null;
  private fx = { x: 0, y: 0, r: 60, vy: 0, rot: 0, active: false };
  private fxShards: FxShard[] = [];
  private fxFlash = 0;
  private fxRing = -1;
  private fxText = "";

  constructor(hooks: LuheHooks) {
    this.hooks = hooks;
  }

  attachFxCanvas(canvas: HTMLCanvasElement): void {
    this.fxCanvas = canvas;
    this.fxCtx = canvas.getContext("2d");
  }

  get active(): boolean {
    return this.state !== LuheState.IDLE;
  }

  /** 合成出潞河时调用（若事件进行中则排队） */
  onLuheCreated(body: Matter.Body): void {
    this.hooks.score.addLuhe();
    this.hooks.score.add(LUHE_MERGE_BONUS);
    this.hooks.score.noteLevel(LUHE_LEVEL);
    if (this.state !== LuheState.IDLE) {
      this.queuedLuhe.push(body);
      return;
    }
    this.begin(body);
  }

  private begin(body: Matter.Body): void {
    this.luhe = body;
    this.crushedIds.clear();
    this.crushTotal = 0;
    this.hooks.setInputLocked(true);
    this.setState(LuheState.SPAWN);
    const s = schoolByLevel(LUHE_LEVEL);
    this.hooks.particles.burst(body.position.x, body.position.y, "#d4af37", 26, 7);
    this.hooks.particles.ring(body.position.x, body.position.y, "#b03060", s.radius);
    this.hooks.particles.floatText(
      body.position.x, body.position.y - s.radius - 10,
      "潞河中学！", "#b03060", 26
    );
    this.hooks.addShake(7);
    this.hooks.audio.play("luheMerge");
  }

  private setState(s: LuheState): void {
    this.state = s;
    this.stateAt = this.hooks.now();
  }

  private elapsed(): number {
    return this.hooks.now() - this.stateAt;
  }

  update(dtMs: number): void {
    if (this.state === LuheState.IDLE) return;
    const h = this.hooks;

    switch (this.state) {
      case LuheState.SPAWN: {
        if (this.elapsed() >= SPAWN_MS) {
          // 进入"好……沉……"：画面压暗 + 物理减速
          h.setDim(true);
          h.audio.play("heavy");
          h.engine.timing.timeScale = 0.12;
          this.setState(LuheState.TEXT);
        }
        break;
      }
      case LuheState.TEXT: {
        const e = this.elapsed();
        let text: string | null = null;
        for (const st of TEXT_STAGES) if (e >= st.at) text = st.text;
        h.setHeavyText(text);
        if (e >= TEXT_TOTAL_MS) {
          h.setHeavyText(null);
          h.setDim(false);
          h.engine.timing.timeScale = 1;
          if (this.luhe && Matter.Composite.get(h.world, this.luhe.id, "body")) {
            makeLuheHeavy(this.luhe);
            getMeta(this.luhe).luheHeavy = true;
            // 给一个小初始向下速度，"突然变沉"
            Matter.Body.setVelocity(this.luhe, { x: 0, y: Math.max(6, this.luhe.velocity.y + 4) });
          }
          h.addShake(5);
          this.setState(LuheState.CRUSH_FALL);
        }
        break;
      }
      case LuheState.CRUSH_FALL: {
        this.scanCrush();
        if (!this.luhe) { this.setState(LuheState.RECOVER); break; }
        const r = schoolByLevel(LUHE_LEVEL).radius;
        if (this.luhe.position.y > ARENA_HEIGHT - r * 0.3) {
          // 撞穿底板：物理地板保留（其他球不漏出），超重潞河靠 mask 穿过；
          // 视觉上在潞河正下方裂开缺口
          this.floorCrackX = this.luhe.position.x;
          h.particles.shards(this.luhe.position.x, ARENA_HEIGHT - 4, "#8a97a8", 22, 8);
          h.particles.ring(this.luhe.position.x, ARENA_HEIGHT - 4, "#ffffff", 120);
          h.addShake(11);
          h.audio.play("floorBreak");
          this.setState(LuheState.BREAK_FLOOR);
        }
        break;
      }
      case LuheState.BREAK_FLOOR: {
        this.scanCrush();
        if (!this.luhe) { this.setState(LuheState.RECOVER); break; }
        const r = schoolByLevel(LUHE_LEVEL).radius;
        if (this.luhe.position.y - r > ARENA_HEIGHT + 6) {
          // 完全穿出游戏区域 → 移交视口特效层
          const pt = h.logicalToScreen(this.luhe.position.x, ARENA_HEIGHT + r * 0.5);
          this.fx.x = pt.x;
          this.fx.y = pt.y;
          this.fx.r = r * pt.scale;
          this.fx.vy = Math.max(500, this.luhe.velocity.y * pt.scale * 60 * 0.6);
          this.fx.rot = this.luhe.angle;
          this.fx.active = true;
          Matter.Composite.remove(h.world, this.luhe);
          this.luhe = null;
          this.setState(LuheState.VIEWPORT_FALL);
        }
        break;
      }
      case LuheState.VIEWPORT_FALL: {
        const dtSec = dtMs / 1000;
        const vh = this.fxCanvas?.height ?? window.innerHeight;
        this.fx.vy += 2600 * dtSec;
        this.fx.y += this.fx.vy * dtSec;
        this.fx.rot += 0.4 * dtSec;
        if (this.fx.y + this.fx.r >= vh - 2) {
          this.fx.y = vh - this.fx.r - 1;
          // 最终炸裂
          this.fxFlash = 1;
          this.fxRing = 0;
          this.fxText = `潞河 +${LUHE_FINALE_BONUS}`;
          const colors = ["#b03060", "#d4af37", "#f5e9d0", "#7a1f3d"];
          for (let i = 0; i < 26; i++) {
            const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.4;
            const v = 300 + Math.random() * 700;
            this.fxShards.push({
              x: this.fx.x, y: vh - 6,
              vx: Math.cos(a) * v, vy: Math.sin(a) * v,
              size: 6 + Math.random() * 16,
              rot: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 9,
              color: colors[i % colors.length],
              life: 0.9 + Math.random() * 0.5, maxLife: 1.2
            });
          }
          h.score.add(LUHE_FINALE_BONUS);
          h.addShake(14);
          h.audio.play("explosion");
          this.fx.active = false;
          this.setState(LuheState.EXPLODE);
        }
        break;
      }
      case LuheState.EXPLODE: {
        if (this.elapsed() >= EXPLODE_MS) {
          this.setState(LuheState.RECOVER);
        }
        break;
      }
      case LuheState.RECOVER: {
        // 底板视觉恢复
        this.floorCrackX = null;
        h.engine.timing.timeScale = 1;
        if (this.elapsed() >= RECOVER_MS) {
          this.finishEvent();
        }
        break;
      }
    }

    // 屏幕空间碎片始终更新
    const dtSec = dtMs / 1000;
    for (const s of this.fxShards) {
      s.vy += 1500 * dtSec;
      s.x += s.vx * dtSec;
      s.y += s.vy * dtSec;
      s.rot += s.vr * dtSec;
      s.life -= dtSec;
    }
    if (this.fxShards.length > 0 && this.fxShards.every(s => s.life <= 0)) {
      this.fxShards = [];
    }
    if (this.fxFlash > 0) this.fxFlash = Math.max(0, this.fxFlash - dtSec * 1.8);
    if (this.fxRing >= 0) {
      this.fxRing += dtSec * 1.6;
      if (this.fxRing > 1) this.fxRing = -1;
    }
  }

  /** 几何扫描：潞河实际压到/撞到的普通球 → 压碎（严格每球一次） */
  private scanCrush(): void {
    const h = this.hooks;
    if (!this.luhe) return;
    if (!Matter.Composite.get(h.world, this.luhe.id, "body")) { this.luhe = null; return; }
    const lr = schoolByLevel(LUHE_LEVEL).radius;
    const bodies = Matter.Composite.allBodies(h.world);
    for (const b of bodies) {
      if (b.label !== "ball" || b.id === this.luhe.id) continue;
      const meta = getMeta(b);
      if (meta.level >= LUHE_LEVEL || meta.crushed) continue;
      const r = schoolByLevel(meta.level).radius;
      const dx = b.position.x - this.luhe.position.x;
      const dy = b.position.y - this.luhe.position.y;
      const dist = Math.hypot(dx, dy);
      if (dist > lr + r + 6) continue; // 未接触（留少量余量，引擎每帧会分离刚体）
      // 必须处于潞河下方（被压）或潞河有足够下坠速度（被撞）
      const below = b.position.y > this.luhe.position.y - lr * 0.25;
      const impact = this.luhe.speed > 2;
      if (!below && !impact) continue;

      meta.crushed = true;
      this.crushedIds.add(meta.id);
      const school = schoolByLevel(meta.level);
      Matter.Composite.remove(h.world, b);
      h.particles.shards(b.position.x, b.position.y, school.color, 10 + meta.level * 2, 6);
      h.particles.shards(b.position.x, b.position.y, "#b03060", 6, 5);
      h.particles.floatText(
        b.position.x, b.position.y - 8,
        `+${school.crushScore}`, "#d4af37", 15 + meta.level
      );
      this.crushTotal += school.crushScore;
      h.score.add(school.crushScore);
      h.audio.play("crush", meta.level);
      h.addShake(2.5);
    }
  }

  private finishEvent(): void {
    const h = this.hooks;
    this.fx.active = false;
    this.fxText = "";
    this.crushedIds.clear();
    this.crushTotal = 0;
    h.setDim(false);
    h.setHeavyText(null);
    h.engine.timing.timeScale = 1;
    this.luhe = null;
    this.setState(LuheState.IDLE);
    // 排队的潞河：连锁触发的第二个终局，依次进行
    const next = this.queuedLuhe.shift();
    if (next && Matter.Composite.get(h.world, next.id, "body")) {
      this.begin(next);
    } else {
      this.queuedLuhe = this.queuedLuhe.filter(b =>
        Matter.Composite.get(h.world, b.id, "body"));
      h.setInputLocked(false);
    }
  }

  /** 视口特效层渲染（屏幕坐标） */
  renderFx(): void {
    const ctx = this.fxCtx;
    const canvas = this.fxCanvas;
    if (!ctx || !canvas) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (this.fx.active) {
      const img = this.hooks.getLuheImage();
      ctx.save();
      ctx.translate(this.fx.x, this.fx.y);
      ctx.rotate(this.fx.rot);
      const r = this.fx.r;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fillStyle = "#f7e8e4";
      ctx.fill();
      ctx.lineWidth = Math.max(2, r * 0.04);
      ctx.strokeStyle = "#b03060";
      ctx.stroke();
      if (img && img.complete && img.naturalWidth > 0) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(0, 0, r * 0.94, 0, Math.PI * 2);
        ctx.clip();
        ctx.drawImage(img, -r * 0.94, -r * 0.94, r * 1.88, r * 1.88);
        ctx.restore();
      }
      ctx.restore();
    }

    if (this.fxRing >= 0) {
      const k = this.fxRing;
      const vh = canvas.height;
      ctx.globalAlpha = 1 - k;
      ctx.strokeStyle = "#d4af37";
      ctx.lineWidth = 8 * (1 - k) + 2;
      ctx.beginPath();
      ctx.arc(this.fx.x, vh - 4, 40 + k * Math.max(canvas.width, 600), 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    for (const s of this.fxShards) {
      if (s.life <= 0) continue;
      ctx.globalAlpha = Math.min(1, (s.life / s.maxLife) * 2);
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(s.rot);
      ctx.fillStyle = s.color;
      ctx.fillRect(-s.size / 2, -s.size / 2, s.size, s.size * 0.7);
      ctx.restore();
    }
    ctx.globalAlpha = 1;

    if (this.fxFlash > 0) {
      ctx.globalAlpha = this.fxFlash * 0.85;
      ctx.fillStyle = "#fff6e0";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.globalAlpha = 1;
    }

    if (this.fxText) {
      ctx.font = "800 34px 'PingFang SC', 'Microsoft YaHei', sans-serif";
      ctx.textAlign = "center";
      ctx.strokeStyle = "rgba(0,0,0,0.5)";
      ctx.lineWidth = 6;
      ctx.strokeText(this.fxText, canvas.width / 2, canvas.height * 0.32);
      ctx.fillStyle = "#ffd75e";
      ctx.fillText(this.fxText, canvas.width / 2, canvas.height * 0.32);
    }
  }

  resizeFx(w: number, h: number): void {
    if (!this.fxCanvas) return;
    this.fxCanvas.width = w;
    this.fxCanvas.height = h;
  }

  /** 重开/销毁：彻底清理（底板、timescale、特效、队列、锁） */
  clear(): void {
    const h = this.hooks;
    this.floorCrackX = null;
    h.engine.timing.timeScale = 1;
    h.setDim(false);
    h.setHeavyText(null);
    h.setInputLocked(false);
    this.luhe = null;
    this.queuedLuhe = [];
    this.crushedIds.clear();
    this.crushTotal = 0;
    this.fx.active = false;
    this.fxShards = [];
    this.fxFlash = 0;
    this.fxRing = -1;
    this.fxText = "";
    this.state = LuheState.IDLE;
    if (this.fxCtx && this.fxCanvas) {
      this.fxCtx.clearRect(0, 0, this.fxCanvas.width, this.fxCanvas.height);
    }
  }
}
