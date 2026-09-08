import Matter from "matter-js";
import { ARENA_WIDTH, ARENA_HEIGHT } from "../data/schools";
import { CAT_BALL, CAT_WALL, CAT_FLOOR } from "./types";

/** 固定物理步长（120Hz），保证 60/144Hz 显示器体验一致 */
export const PHYSICS_STEP_MS = 1000 / 120;
/** 单帧最多补偿的步数，防止卡顿后物理世界爆炸 */
export const MAX_STEPS_PER_FRAME = 5;

export interface PhysicsWorld {
  engine: Matter.Engine;
  floor: Matter.Body;
  wallL: Matter.Body;
  wallR: Matter.Body;
}

export function createPhysicsWorld(): PhysicsWorld {
  const engine = Matter.Engine.create({
    enableSleeping: false,
    positionIterations: 10,
    velocityIterations: 8,
    constraintIterations: 3
  });
  engine.gravity.y = 1.9;

  const wallT = 90;
  const common: Matter.IBodyDefinition = {
    isStatic: true,
    friction: 0.4,
    restitution: 0.05,
    collisionFilter: { category: CAT_WALL, mask: CAT_BALL }
  };
  const wallL = Matter.Bodies.rectangle(-wallT / 2, ARENA_HEIGHT / 2, wallT, ARENA_HEIGHT * 3, common);
  const wallR = Matter.Bodies.rectangle(ARENA_WIDTH + wallT / 2, ARENA_HEIGHT / 2, wallT, ARENA_HEIGHT * 3, common);
  const floor = Matter.Bodies.rectangle(
    ARENA_WIDTH / 2, ARENA_HEIGHT + wallT / 2, ARENA_WIDTH + wallT * 2, wallT,
    { ...common, collisionFilter: { category: CAT_FLOOR, mask: CAT_BALL } }
  );
  Matter.Composite.add(engine.world, [wallL, wallR, floor]);
  return { engine, floor, wallL, wallR };
}

/** 创建学校球体；不同等级物理手感不同：小球略活泼，大球沉重 */
export function createBallBody(level: number, radius: number, x: number, y: number): Matter.Body {
  const t = (level - 1) / 9; // 0..1
  const body = Matter.Bodies.circle(x, y, radius, {
    // 小球轻弹，大球几乎不弹
    restitution: 0.30 - t * 0.22,
    friction: 0.5,
    frictionStatic: 1.0,
    // 大球空气阻尼更大：下落快但不飘，堆叠稳定
    frictionAir: 0.012 + t * 0.02,
    // 大球密度递增，强化"重"的手感
    density: 0.0016 * (1 + t * 0.55),
    slop: 0.02,
    collisionFilter: { category: CAT_BALL, mask: CAT_BALL | CAT_WALL | CAT_FLOOR }
  });
  body.label = "ball";
  return body;
}

/** 使潞河进入"超重"状态：质量暴涨、不再弹、可击穿地板 */
export function makeLuheHeavy(body: Matter.Body): void {
  Matter.Body.setDensity(body, body.density * 60);
  body.restitution = 0;
  body.frictionAir = 0.001;
  body.collisionFilter.mask = CAT_BALL | CAT_WALL; // 不再与地板碰撞
}
