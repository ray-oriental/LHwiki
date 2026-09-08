/** 轻量粒子系统（对象池，上限固定，长期游玩不泄漏） */

export type ParticleType = "circle" | "shard" | "ring";

export interface Particle {
  active: boolean;
  type: ParticleType;
  x: number; y: number;
  vx: number; vy: number;
  life: number; maxLife: number;
  size: number;
  color: string;
  rot: number; vr: number;
  gravity: number;
}

export interface FloatText {
  active: boolean;
  x: number; y: number;
  text: string;
  life: number; maxLife: number;
  color: string;
  size: number;
}

const MAX_PARTICLES = 420;
const MAX_TEXTS = 24;

export class Particles {
  private pool: Particle[] = [];
  private texts: FloatText[] = [];

  constructor() {
    for (let i = 0; i < MAX_PARTICLES; i++) {
      this.pool.push({
        active: false, type: "circle", x: 0, y: 0, vx: 0, vy: 0,
        life: 0, maxLife: 1, size: 3, color: "#fff", rot: 0, vr: 0, gravity: 0.25
      });
    }
    for (let i = 0; i < MAX_TEXTS; i++) {
      this.texts.push({ active: false, x: 0, y: 0, text: "", life: 0, maxLife: 1, color: "#fff", size: 16 });
    }
  }

  private alloc(): Particle | null {
    for (const p of this.pool) if (!p.active) return p;
    return null; // 池满则丢弃，保证性能稳定
  }

  /** 合成时的环形迸发 */
  burst(x: number, y: number, color: string, count: number, speed: number): void {
    for (let i = 0; i < count; i++) {
      const p = this.alloc();
      if (!p) return;
      const a = (Math.PI * 2 * i) / count + Math.random() * 0.5;
      const v = speed * (0.6 + Math.random() * 0.7);
      p.active = true; p.type = "circle";
      p.x = x; p.y = y;
      p.vx = Math.cos(a) * v; p.vy = Math.sin(a) * v - 1.2;
      p.maxLife = 0.55 + Math.random() * 0.3; p.life = p.maxLife;
      p.size = 2.5 + Math.random() * 3.5;
      p.color = color; p.rot = 0; p.vr = 0; p.gravity = 0.22;
    }
  }

  /** 冲击环（合成 pop / 炸裂 shockwave） */
  ring(x: number, y: number, color: string, size: number): void {
    const p = this.alloc();
    if (!p) return;
    p.active = true; p.type = "ring";
    p.x = x; p.y = y; p.vx = 0; p.vy = 0;
    p.maxLife = 0.4; p.life = p.maxLife;
    p.size = size; p.color = color; p.rot = 0; p.vr = 0; p.gravity = 0;
  }

  /** 压碎/炸裂碎片（校徽色块飞溅） */
  shards(x: number, y: number, color: string, count: number, speed: number): void {
    for (let i = 0; i < count; i++) {
      const p = this.alloc();
      if (!p) return;
      const a = Math.random() * Math.PI * 2;
      const v = speed * (0.4 + Math.random() * 0.9);
      p.active = true; p.type = "shard";
      p.x = x; p.y = y;
      p.vx = Math.cos(a) * v; p.vy = Math.sin(a) * v - 2.5;
      p.maxLife = 0.7 + Math.random() * 0.5; p.life = p.maxLife;
      p.size = 3 + Math.random() * 6;
      p.color = color;
      p.rot = Math.random() * Math.PI; p.vr = (Math.random() - 0.5) * 0.4;
      p.gravity = 0.3;
    }
  }

  floatText(x: number, y: number, text: string, color: string, size = 16): void {
    for (const t of this.texts) {
      if (t.active) continue;
      t.active = true; t.x = x; t.y = y; t.text = text;
      t.maxLife = 0.9; t.life = t.maxLife; t.color = color; t.size = size;
      return;
    }
  }

  update(dtSec: number): void {
    for (const p of this.pool) {
      if (!p.active) continue;
      p.life -= dtSec;
      if (p.life <= 0) { p.active = false; continue; }
      p.vy += p.gravity * (dtSec * 60) * 0.16;
      p.x += p.vx * dtSec * 60;
      p.y += p.vy * dtSec * 60;
      p.rot += p.vr * dtSec * 60;
    }
    for (const t of this.texts) {
      if (!t.active) continue;
      t.life -= dtSec;
      if (t.life <= 0) { t.active = false; continue; }
      t.y -= 34 * dtSec;
    }
  }

  render(ctx: CanvasRenderingContext2D): void {
    for (const p of this.pool) {
      if (!p.active) continue;
      const k = p.life / p.maxLife;
      ctx.globalAlpha = Math.min(1, k * 1.6);
      if (p.type === "circle") {
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (0.5 + k * 0.5), 0, Math.PI * 2);
        ctx.fill();
      } else if (p.type === "ring") {
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 3 * k + 1;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (1.2 - k), 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.7);
        ctx.restore();
      }
    }
    ctx.globalAlpha = 1;
    for (const t of this.texts) {
      if (!t.active) continue;
      const k = t.life / t.maxLife;
      ctx.globalAlpha = Math.min(1, k * 2);
      ctx.font = `700 ${t.size}px "PingFang SC", "Microsoft YaHei", sans-serif`;
      ctx.textAlign = "center";
      ctx.strokeStyle = "rgba(255,255,255,0.85)";
      ctx.lineWidth = 3;
      ctx.strokeText(t.text, t.x, t.y);
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, t.x, t.y);
    }
    ctx.globalAlpha = 1;
  }

  clear(): void {
    for (const p of this.pool) p.active = false;
    for (const t of this.texts) t.active = false;
  }
}
