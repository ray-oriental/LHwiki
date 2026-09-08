/**
 * 学校等级数据（唯一事实来源）。
 * 等级依据：2025 年北京中考通州区统招录取分数线（多家公开来源交叉验证：
 * 北京中考信息网 zhongkaobj.cn、北京高考在线 gaokzx.com、头条汇总 2025 录取线）。
 * 录取门槛仅作为游戏等级设计依据，不代表学校完整教育质量。
 *
 * 等级数说明：通州区可核实录取线的高中（校区）共 12 所，
 * 其中张家湾中学真实校徽无法从公开渠道可靠获取（官网/百科仅有校门照片，
 * 按"不虚构校徽"红线舍弃）；潞河中学于家务校区与潞河中学共用同一校徽，
 * 会造成与最终等级视觉重复，亦舍弃。最终定为 10 级，
 * 半径按约 1.235 等比增长，兼顾辨识度与场地容量。
 */

export interface SchoolLevel {
  /** 等级（1 最小，10 = 潞河中学 最大） */
  level: number;
  id: string;
  name: string;
  shortName: string;
  /** 球半径（逻辑像素，场地宽 480） */
  radius: number;
  /** 合成出该等级时的得分（level>=2 才有意义） */
  mergeScore: number;
  /** 潞河事件中该等级被压碎的得分 */
  crushScore: number;
  /** 球体底色（校徽外的衬底） */
  color: string;
  /** 校徽资源路径（本地 assets） */
  logo: string;
  /** 校徽来源 */
  source: string;
  /** 2025 通州中考统招录取线（参考） */
  score2025: number;
}

export const ARENA_WIDTH = 480;
export const ARENA_HEIGHT = 640;
export const DEATH_LINE_Y = 130;
export const DROP_Y = 100;
export const LUHE_LEVEL = 10;

/** 合成潞河中学额外基础奖励（在 L10 mergeScore 之外） */
export const LUHE_MERGE_BONUS = 500;
/** 潞河完整坠落（穿底+炸裂）完成奖励 */
export const LUHE_FINALE_BONUS = 1000;

export const SCHOOL_LEVELS: SchoolLevel[] = [
  {
    level: 1, id: "yld", name: "北京市通州区永乐店中学", shortName: "永乐店",
    radius: 20, mergeScore: 0, crushScore: 5, color: "#f6e3ea",
    logo: "assets/schools/l01.png",
    source: "百度百科词条配图（bkimg.cdn.bcebos.com），经必应图片搜索",
    score2025: 402
  },
  {
    level: 2, id: "lgfz", name: "北京理工大学附属中学通州校区", shortName: "理工附",
    radius: 25, mergeScore: 3, crushScore: 8, color: "#fde8e4",
    logo: "assets/schools/l02.png",
    source: "百度百科词条配图；理工附中通州校区官网 lgfztzschool.cn 同款",
    score2025: 424
  },
  {
    level: 3, id: "jsxx", name: "北京景山学校通州分校", shortName: "景山",
    radius: 31, mergeScore: 6, crushScore: 12, color: "#eef7e2",
    logo: "assets/schools/l03.png",
    source: "北京景山学校校徽（1960），itc.cn 图片缓存，经必应图片搜索",
    score2025: 429
  },
  {
    level: 4, id: "bj5z", name: "北京市第五中学通州校区", shortName: "五中",
    radius: 38, mergeScore: 12, crushScore: 18, color: "#e4f3ec",
    logo: "assets/schools/l04.png",
    source: "北京五中校徽（绿色火炬），360tres 图片缓存，经必应图片搜索",
    score2025: 434
  },
  {
    level: 5, id: "bj2z", name: "北京市第二中学通州校区", shortName: "二中",
    radius: 47, mergeScore: 20, crushScore: 26, color: "#fdeee0",
    logo: "assets/schools/l05.png",
    source: "百度百科词条配图：北京市第二中学通州校区校徽",
    score2025: 442
  },
  {
    level: 6, id: "yhzx", name: "北京市通州区运河中学", shortName: "运河",
    radius: 58, mergeScore: 30, crushScore: 36, color: "#fdf3e3",
    logo: "assets/schools/l06.png",
    source: "运河中学校徽（1984），itc.cn 图片缓存，经必应图片搜索",
    score2025: 458
  },
  {
    level: 7, id: "bjxx", name: "北京学校", shortName: "北校",
    radius: 71, mergeScore: 45, crushScore: 50, color: "#e9edf5",
    logo: "assets/schools/l07.png",
    source: "北京学校官方标识（BEIJING SCHOOL 2019），昵图网素材页展示稿 nximg.cn",
    score2025: 465
  },
  {
    level: 8, id: "rdfz", name: "中国人民大学附属中学通州校区", shortName: "人大附",
    radius: 88, mergeScore: 66, crushScore: 70, color: "#e3ecf7",
    logo: "assets/schools/l08.png",
    source: "人大附中校徽（1950），lteaching.com，经必应图片搜索",
    score2025: 466
  },
  {
    level: 9, id: "sdfz", name: "首都师范大学附属中学通州校区", shortName: "首师附",
    radius: 108, mergeScore: 95, crushScore: 100, color: "#e6f3e9",
    logo: "assets/schools/l09.png",
    source: "首师大附中校徽（1914），官网 cnuhs.cn 同款，phb123 图片缓存",
    score2025: 470
  },
  {
    level: 10, id: "luhe", name: "北京市通州区潞河中学", shortName: "潞河",
    radius: 134, mergeScore: 140, crushScore: 0, color: "#f7e8e4",
    logo: "assets/schools/l10.png",
    source: "潞河中学盾牌校徽（Jefferson Academy 1867），官网 luhe.net 同款，itc.cn 缓存",
    score2025: 475
  }
];

export function schoolByLevel(level: number): SchoolLevel {
  return SCHOOL_LEVELS[Math.min(Math.max(level, 1), SCHOOL_LEVELS.length) - 1];
}

/** 待投放球的随机池：只出最低 5 级，概率偏向低级 */
export const SPAWN_POOL: { level: number; weight: number }[] = [
  { level: 1, weight: 32 },
  { level: 2, weight: 26 },
  { level: 3, weight: 20 },
  { level: 4, weight: 14 },
  { level: 5, weight: 8 }
];

export function rollSpawnLevel(rng: () => number = Math.random): number {
  const total = SPAWN_POOL.reduce((s, p) => s + p.weight, 0);
  let r = rng() * total;
  for (const p of SPAWN_POOL) {
    r -= p.weight;
    if (r <= 0) return p.level;
  }
  return 1;
}
