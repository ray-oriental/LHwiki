import Matter from "matter-js";
import { schoolByLevel, LUHE_LEVEL } from "../data/schools";
import { getMeta } from "./types";

export interface MergeResult {
  x: number;
  y: number;
  vx: number;
  vy: number;
  newLevel: number;
}

interface MergeJob {
  a: Matter.Body;
  b: Matter.Body;
}

/**
 * 合成系统：
 * - collisionStart 只做"标记 + 入队"，绝不立即改世界；
 * - 每个球在一次合成中最多参与一次（merging 锁）；
 * - 在引擎 afterUpdate 统一延迟执行（deferred removal/creation），
 *   避免同一帧重复销毁、重复结算、新球与旧对象重复碰撞。
 */
export class MergeSystem {
  private queue: MergeJob[] = [];
  private world: Matter.World;
  private nowFn: () => number;

  /** 合成成功回调（生成新球、计分、特效由外部处理） */
  onMerge: ((result: MergeResult) => void) | null = null;

  constructor(world: Matter.World, nowFn: () => number) {
    this.world = world;
    this.nowFn = nowFn;
  }

  handleCollisionPairs(pairs: Matter.Pair[]): void {
    for (const pair of pairs) {
      const { bodyA, bodyB } = pair;
      if (bodyA.label !== "ball" || bodyB.label !== "ball") continue;
      const ma = getMeta(bodyA);
      const mb = getMeta(bodyB);
      if (ma.level !== mb.level) continue;
      if (ma.level >= LUHE_LEVEL) continue; // 潞河不再两两合成
      if (ma.merging || mb.merging) continue;
      if (ma.crushed || mb.crushed) continue;
      // 立即上锁：同一帧内 A 不可能再与 C 合成
      ma.merging = true;
      mb.merging = true;
      this.queue.push({ a: bodyA, b: bodyB });
    }
  }

  /** 每个物理帧结束后调用：统一处理合成队列 */
  flush(): void {
    if (this.queue.length === 0) return;
    const jobs = this.queue;
    this.queue = [];
    for (const { a, b } of jobs) {
      // 二次校验：球可能已被潞河压碎或已被移出世界
      const ma = getMeta(a);
      const mb = getMeta(b);
      if (ma.crushed || mb.crushed) continue;
      if (!Matter.Composite.get(this.world, a.id, "body") ||
          !Matter.Composite.get(this.world, b.id, "body")) continue;

      const newLevel = ma.level + 1;
      const totalMass = a.mass + b.mass;
      const x = (a.position.x * a.mass + b.position.x * b.mass) / totalMass;
      const y = (a.position.y * a.mass + b.position.y * b.mass) / totalMass;
      const vx = (a.velocity.x + b.velocity.x) * 0.25;
      const vy = (a.velocity.y + b.velocity.y) * 0.25;

      Matter.Composite.remove(this.world, a);
      Matter.Composite.remove(this.world, b);

      this.onMerge?.({ x, y, vx, vy, newLevel });
    }
  }

  clear(): void {
    this.queue = [];
  }

  get pending(): number {
    return this.queue.length;
  }
}

/** 合成新球时的等级上限保护 */
export function clampLevel(level: number): number {
  return Math.min(level, LUHE_LEVEL);
}

export { schoolByLevel };
