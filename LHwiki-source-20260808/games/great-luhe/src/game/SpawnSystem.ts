import Matter from "matter-js";
import { ARENA_WIDTH, DROP_Y, rollSpawnLevel, schoolByLevel } from "../data/schools";
import { createBallBody } from "./Physics";
import { allocBallId, getMeta } from "./types";

/** 投放系统：当前球/下一个球、水平定位、冷却 */
export class SpawnSystem {
  currentLevel = 1;
  nextLevel = 1;
  /** 投放冷却结束时间戳 */
  private cooldownUntil = 0;
  /** 当前期望的投放 x（逻辑坐标） */
  aimX = ARENA_WIDTH / 2;

  /** 输入被锁定（潞河事件 / Game Over） */
  inputLocked = false;

  onDrop: ((level: number, x: number, y: number) => Matter.Body) | null = null;
  onNextChange: (() => void) | null = null;

  private nowFn: () => number;

  constructor(nowFn: () => number) {
    this.nowFn = nowFn;
    this.currentLevel = rollSpawnLevel();
    this.nextLevel = rollSpawnLevel();
  }

  get currentRadius(): number {
    return schoolByLevel(this.currentLevel).radius;
  }

  get canDrop(): boolean {
    return !this.inputLocked && this.nowFn() >= this.cooldownUntil;
  }

  setAim(x: number): void {
    const r = this.currentRadius;
    // 球心不允许越过墙壁
    this.aimX = Math.min(ARENA_WIDTH - r - 4, Math.max(r + 4, x));
  }

  /** 尝试投放；成功返回新 body，失败返回 null */
  drop(): Matter.Body | null {
    if (!this.canDrop) return null;
    const level = this.currentLevel;
    const body = this.onDrop?.(level, this.aimX, DROP_Y) ?? null;
    this.cooldownUntil = this.nowFn() + 450;
    this.currentLevel = this.nextLevel;
    this.nextLevel = rollSpawnLevel();
    this.onNextChange?.();
    return body;
  }

  reset(): void {
    this.currentLevel = rollSpawnLevel();
    this.nextLevel = rollSpawnLevel();
    this.cooldownUntil = 0;
    this.aimX = ARENA_WIDTH / 2;
    this.inputLocked = false;
    this.onNextChange?.();
  }
}

/** 实际生成球体并登记元数据 */
export function spawnBallInto(
  world: Matter.World, level: number, x: number, y: number, now: number
): Matter.Body {
  const school = schoolByLevel(level);
  const body = createBallBody(level, school.radius, x, y);
  const meta = getMeta(body);
  meta.id = allocBallId();
  meta.level = level;
  meta.merging = false;
  meta.crushed = false;
  meta.isLuhe = level >= 10;
  meta.luheHeavy = false;
  meta.bornAt = now;
  meta.overLineMs = 0;
  meta.popAt = -1;
  Matter.Composite.add(world, body);
  return body;
}
