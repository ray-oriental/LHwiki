const BEST_KEY = "gluhe_best";

/** 计分与本地最高分（纯 localStorage，无网络） */
export class ScoreSystem {
  score = 0;
  best = 0;
  luheCount = 0;
  maxLevel = 1;
  /** 分数变化回调（刷新 HUD） */
  onChange: (() => void) | null = null;

  constructor() {
    try {
      this.best = Number(localStorage.getItem(BEST_KEY) ?? "0") || 0;
    } catch {
      this.best = 0;
    }
  }

  add(points: number): void {
    if (points <= 0) return;
    this.score += points;
    if (this.score > this.best) {
      this.best = this.score;
      try { localStorage.setItem(BEST_KEY, String(this.best)); } catch { /* ignore */ }
    }
    this.onChange?.();
  }

  noteLevel(level: number): void {
    if (level > this.maxLevel) this.maxLevel = level;
  }

  addLuhe(): void {
    this.luheCount += 1;
    this.onChange?.();
  }

  reset(): void {
    this.score = 0;
    this.luheCount = 0;
    this.maxLevel = 1;
    this.onChange?.();
  }
}
