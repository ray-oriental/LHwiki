import Matter from "matter-js";

/** 碰撞类别 */
export const CAT_BALL = 0x0001;
export const CAT_WALL = 0x0002;
export const CAT_FLOOR = 0x0004;

/** 挂在 body.plugin.gluhe 上的元数据 */
export interface BallMeta {
  id: number;
  level: number;
  /** 已锁定到某次合成中（防止一帧重复合成） */
  merging: boolean;
  /** 已被潞河压碎结算过（防止重复计分） */
  crushed: boolean;
  /** 是否为潞河球 */
  isLuhe: boolean;
  /** 进入超重状态的潞河 */
  luheHeavy: boolean;
  /** 出生时间戳（ms，游戏内时钟） */
  bornAt: number;
  /** 越线稳定计时（死亡线判定用） */
  overLineMs: number;
  /** 合成 pop 动画开始时间（-1 无动画） */
  popAt: number;
}

export function getMeta(body: Matter.Body): BallMeta {
  const p = body.plugin as unknown as { gluhe?: BallMeta };
  if (!p.gluhe) {
    p.gluhe = {
      id: 0, level: 1, merging: false, crushed: false,
      isLuhe: false, luheHeavy: false, bornAt: 0, overLineMs: 0, popAt: -1
    };
  }
  return p.gluhe;
}

let nextId = 1;
export function allocBallId(): number {
  return nextId++;
}
/** 重开时重置 id 空间，避免无限增长 */
export function resetBallIds(): void {
  nextId = 1;
}

export type Vec = { x: number; y: number };
