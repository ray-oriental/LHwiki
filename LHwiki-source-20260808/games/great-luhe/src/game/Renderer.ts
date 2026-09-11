import Matter from "matter-js";
import {
  ARENA_WIDTH, ARENA_HEIGHT, DEATH_LINE_Y, DROP_Y,
  schoolByLevel, SCHOOL_LEVELS
} from "../data/schools";
import { getMeta } from "./types";
import { Particles } from "./Particles";
import { SpawnSystem } from "./SpawnSystem";

export type GameTheme = "light" | "dark";

/** 校徽图片缓存 */
export class LogoCache {
  private images = new Map<number, HTMLImageElement>();
  private loadedCount = 0;
  private base: string;
  onAllLoaded: (() => void) | null = null;

  /** base：校徽路径前缀，默认空（相对当前页面）；直接嵌入 LHwiki 时可传子路径 */
  constructor(base = "") {
    this.base = base;
  }

  load(): void {
    for (const s of SCHOOL_LEVELS) {
      const img = new Image();
      img.src = this.base + s.logo;
      img.onload = () => {
        this.loadedCount++;
        if (this.loadedCount >= SCHOOL_LEVELS.length) this.onAllLoaded?.();
      };
      img.onerror = () => {
        this.loadedCount++;
        if (this.loadedCount >= SCHOOL_LEVELS.length) this.onAllLoaded?.();
      };
      this.images.set(s.level, img);
    }
  }

  get(level: number): HTMLImageElement | null {
    const img = this.images.get(level);
    return img && img.complete && img.naturalWidth > 0 ? img : null;
  }
}

export class Renderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private logos: LogoCache;
  private particles: Particles;
  shake = 0;
  /** 死亡线警告 */
  deathWarning = false;
  /** 潞河击穿底板的视觉裂缝（逻辑 x；null = 地板完整） */
  floorCrackX: number | null = null;
  private theme: GameTheme = "light";

  constructor(canvas: HTMLCanvasElement, logos: LogoCache, particles: Particles) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D unavailable");
    this.ctx = ctx;
    this.logos = logos;
    this.particles = particles;
  }

  resize(cssWidth: number): void {
    const dpr = Math.min(2.5, window.devicePixelRatio || 1);
    const cssHeight = (cssWidth * ARENA_HEIGHT) / ARENA_WIDTH;
    this.canvas.style.width = `${cssWidth}px`;
    this.canvas.style.height = `${cssHeight}px`;
    this.canvas.width = Math.round(cssWidth * dpr);
    this.canvas.height = Math.round(cssHeight * dpr);
  }

  get scale(): number {
    return this.canvas.width / ARENA_WIDTH;
  }

  addShake(amount: number): void {
    this.shake = Math.min(18, this.shake + amount);
  }

  setTheme(theme: GameTheme): void {
    this.theme = theme;
  }

  render(
    world: Matter.World,
    spawn: SpawnSystem,
    now: number,
    gameOver: boolean
  ): void {
    const ctx = this.ctx;
    const k = this.scale;
    ctx.save();
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // 屏幕震动
    if (this.shake > 0.2) {
      const s = this.shake;
      ctx.translate((Math.random() - 0.5) * s * k * 0.4, (Math.random() - 0.5) * s * k * 0.4);
      this.shake *= 0.88;
    } else {
      this.shake = 0;
    }

    // 背景
    const bg = ctx.createLinearGradient(0, 0, 0, this.canvas.height);
    bg.addColorStop(0, this.theme === "dark" ? "#1b2528" : "#fdf6ee");
    bg.addColorStop(1, this.theme === "dark" ? "#252b28" : "#f3e9f0");
    ctx.fillStyle = bg;
    ctx.fillRect(-20, -20, this.canvas.width + 40, this.canvas.height + 40);

    // 墙壁
    ctx.fillStyle = this.theme === "dark" ? "#45575a" : "#c9b8a8";
    ctx.fillRect(0, 0, 3 * k, this.canvas.height);
    ctx.fillRect(this.canvas.width - 3 * k, 0, 3 * k, this.canvas.height);
    // 地板（潞河击穿时画出裂缝缺口）
    const floorY = this.canvas.height - 6 * k;
    ctx.fillStyle = this.theme === "dark" ? "#566460" : "#b7a48e";
    if (this.floorCrackX === null) {
      ctx.fillRect(0, floorY, this.canvas.width, 6 * k);
    } else {
      const gx = this.floorCrackX * k;
      const half = 92 * k;
      ctx.fillRect(0, floorY, Math.max(0, gx - half), 6 * k);
      ctx.fillRect(Math.min(this.canvas.width, gx + half), floorY, this.canvas.width, 6 * k);
      // 裂缝边缘参差感
      ctx.fillStyle = this.theme === "dark" ? "#a17b68" : "#8a7458";
      for (let i = 0; i < 6; i++) {
        const ex = gx - half + (i * 2 * half) / 5;
        ctx.fillRect(ex, floorY, 3 * k, (2 + (i % 3) * 2) * k);
      }
    }

    // 死亡线
    ctx.strokeStyle = this.deathWarning
      ? `rgba(220, 40, 60, ${0.55 + 0.4 * Math.sin(now / 90)})`
      : this.theme === "dark" ? "rgba(239, 155, 148, 0.6)" : "rgba(220, 40, 60, 0.4)";
    ctx.lineWidth = 2 * k;
    ctx.setLineDash([10 * k, 8 * k]);
    ctx.beginPath();
    ctx.moveTo(4 * k, DEATH_LINE_Y * k);
    ctx.lineTo(this.canvas.width - 4 * k, DEATH_LINE_Y * k);
    ctx.stroke();
    ctx.setLineDash([]);

    // 球体
    const bodies = Matter.Composite.allBodies(world);
    for (const body of bodies) {
      if (body.label !== "ball") continue;
      this.drawBall(body, now);
    }

    // 粒子与浮动文字
    this.particles.render(ctx);

    // 待投放球预览
    if (!gameOver && !spawn.inputLocked) {
      const school = schoolByLevel(spawn.currentLevel);
      const r = school.radius;
      const x = spawn.aimX;
      ctx.globalAlpha = 0.35;
      ctx.strokeStyle = this.theme === "dark" ? "#a8c1c9" : "#8a6a80";
      ctx.lineWidth = 1.5 * k;
      ctx.setLineDash([4 * k, 5 * k]);
      ctx.beginPath();
      ctx.moveTo(x * k, (DROP_Y + r) * k);
      ctx.lineTo(x * k, this.canvas.height);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      this.drawSchoolBall(x, DROP_Y, r, spawn.currentLevel, 0, now, -1, 0.92);
    }

    ctx.restore();
  }

  private drawBall(body: Matter.Body, now: number): void {
    const meta = getMeta(body);
    const school = schoolByLevel(meta.level);
    // 合成 pop 动画
    let scaleAnim = 1;
    if (meta.popAt >= 0) {
      const t = (now - meta.popAt) / 280;
      if (t >= 1) {
        meta.popAt = -1;
      } else {
        scaleAnim = 0.45 + 0.55 * (1 - Math.pow(1 - t, 3)) + 0.12 * Math.sin(t * Math.PI);
      }
    }
    this.drawSchoolBall(
      body.position.x, body.position.y, school.radius, meta.level,
      body.angle, now, meta.popAt, 1, scaleAnim
    );
  }

  private drawSchoolBall(
    x: number, y: number, r: number, level: number, angle: number,
    now: number, _popAt: number, alpha: number, scaleAnim = 1
  ): void {
    const ctx = this.ctx;
    const k = this.scale;
    const school = schoolByLevel(level);
    const R = r * k * scaleAnim;
    const cx = x * k;
    const cy = y * k;

    ctx.save();
    ctx.globalAlpha = alpha;
    // 柔和投影
    ctx.shadowColor = this.theme === "dark" ? "rgba(0, 0, 0, 0.56)" : "rgba(60, 40, 60, 0.28)";
    ctx.shadowBlur = 6 * k;
    ctx.shadowOffsetY = 2 * k;
    // 球体底色
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fillStyle = school.color;
    ctx.fill();
    ctx.shadowColor = "transparent";
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;

    // 校徽（圆形裁剪）
    const img = this.logos.get(level);
    if (img) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, R * 0.9, 0, Math.PI * 2);
      ctx.clip();
      const ir = R * 0.9;
      ctx.drawImage(img, cx - ir, cy - ir, ir * 2, ir * 2);
      ctx.restore();
    }

    // 描边
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.lineWidth = Math.max(1.5 * k, R * 0.045);
    ctx.strokeStyle = level >= 10 ? (this.theme === "dark" ? "#ef9b94" : "#b03060") : this.theme === "dark" ? "rgba(226, 190, 201, 0.62)" : "rgba(120, 80, 100, 0.4)";
    ctx.stroke();

    // 顶部高光
    ctx.beginPath();
    ctx.ellipse(cx - R * 0.32, cy - R * 0.42, R * 0.34, R * 0.18, -0.5, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.fill();

    // 大球加短校名
    if (r >= 34) {
      ctx.font = `700 ${Math.max(10 * k, R * 0.22)}px "PingFang SC", "Microsoft YaHei", sans-serif`;
      ctx.textAlign = "center";
      ctx.strokeStyle = "rgba(255,255,255,0.9)";
      ctx.lineWidth = 3 * k;
      const ty = cy + R * 0.72;
      ctx.strokeText(school.shortName, cx, ty);
      ctx.fillStyle = this.theme === "dark" ? "rgba(35, 26, 35, 0.9)" : "rgba(80, 40, 60, 0.85)";
      ctx.fillText(school.shortName, cx, ty);
    }
    ctx.restore();
  }
}
