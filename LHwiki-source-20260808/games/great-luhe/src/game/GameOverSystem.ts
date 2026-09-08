import Matter from "matter-js";
import { DEATH_LINE_Y } from "../data/schools";
import { getMeta } from "./types";
import { schoolByLevel } from "../data/schools";

/** 稳定越线判定阈值 */
const STABLE_SPEED = 0.45;
const STABLE_ANGULAR = 0.06;
const OVERLINE_LIMIT_MS = 1600;
/** 新球落地宽限期 */
const GRACE_MS = 900;

/**
 * 死亡线：球"基本稳定且持续越线"才判负，
 * 下落中/弹跳中的球不会误触发。
 */
export class GameOverSystem {
  /** 检查是否启用（潞河事件期间暂停） */
  enabled = true;
  onGameOver: (() => void) | null = null;
  /** 当前是否有球处于越线警告状态（渲染警告闪烁用） */
  warning = false;

  private world: Matter.World;
  private nowFn: () => number;
  private gameOverFired = false;

  constructor(world: Matter.World, nowFn: () => number) {
    this.world = world;
    this.nowFn = nowFn;
  }

  update(dtMs: number): void {
    if (!this.enabled || this.gameOverFired) { this.warning = false; return; }
    const now = this.nowFn();
    let anyWarning = false;
    for (const body of Matter.Composite.allBodies(this.world)) {
      if (body.label !== "ball") continue;
      const meta = getMeta(body);
      const r = schoolByLevel(meta.level).radius;
      const overLine = body.position.y - r < DEATH_LINE_Y;
      const stable =
        body.speed < STABLE_SPEED && Math.abs(body.angularSpeed) < STABLE_ANGULAR;
      const old = now - meta.bornAt > GRACE_MS;
      if (overLine && stable && old) {
        meta.overLineMs += dtMs;
        anyWarning = true;
        if (meta.overLineMs >= OVERLINE_LIMIT_MS) {
          this.gameOverFired = true;
          this.onGameOver?.();
          return;
        }
      } else {
        meta.overLineMs = Math.max(0, meta.overLineMs - dtMs * 2);
        if (overLine && old) anyWarning = true;
      }
    }
    this.warning = anyWarning;
  }

  reset(): void {
    this.gameOverFired = false;
    this.warning = false;
    this.enabled = true;
  }
}
