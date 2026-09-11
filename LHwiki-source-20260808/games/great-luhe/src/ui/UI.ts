import { schoolByLevel } from "../data/schools";
import type { GameTheme } from "../game/Renderer";

/** 所有 DOM 集中在 root 内；FX/压暗/文字层挂 body 但 destroy 时全部移除 */
export class UI {
  root: HTMLElement;
  private hudScore!: HTMLElement;
  private hudBest!: HTMLElement;
  private hudLuhe!: HTMLElement;
  private nextImg!: HTMLImageElement;
  private muteBtn!: HTMLButtonElement;
  stage!: HTMLElement;
  canvas!: HTMLCanvasElement;

  private dimEl: HTMLElement | null = null;
  private heavyTextEl: HTMLElement | null = null;
  fxCanvas: HTMLCanvasElement | null = null;
  private modal: HTMLElement | null = null;

  onRestart: (() => void) | null = null;
  onMuteToggle: (() => void) | null = null;

  private assetBase: string;

  constructor(root: HTMLElement, assetBase = "") {
    this.root = root;
    this.assetBase = assetBase;
    this.build();
  }

  private build(): void {
    this.root.classList.add("gluhe-root");
    this.root.innerHTML = `
      <div class="gluhe-hud">
        <span class="gluhe-stat">分数 <b data-role="score">0</b></span>
        <span class="gluhe-stat">最高 <b data-role="best">0</b></span>
        <span class="gluhe-stat gluhe-luhe-count">潞河 <b data-role="luhe">× 0</b></span>
        <span class="gluhe-spacer"></span>
        <button class="gluhe-btn" data-role="mute" title="声音开关">🔊</button>
        <button class="gluhe-btn" data-role="restart" title="重新开始">重开</button>
      </div>
      <div class="gluhe-stage">
        <canvas class="gluhe-canvas" data-role="canvas"></canvas>
        <div class="gluhe-next">
          <img data-role="next" alt="下一个" />
          <span>下一个</span>
        </div>
      </div>
      <div class="gluhe-footer">合成潞河 · 通州高中校徽合成小游戏 · 仅供娱乐</div>
    `;
    this.hudScore = this.root.querySelector('[data-role="score"]')!;
    this.hudBest = this.root.querySelector('[data-role="best"]')!;
    this.hudLuhe = this.root.querySelector('[data-role="luhe"]')!;
    this.nextImg = this.root.querySelector('[data-role="next"]')!;
    this.muteBtn = this.root.querySelector('[data-role="mute"]')!;
    this.stage = this.root.querySelector(".gluhe-stage")!;
    this.canvas = this.root.querySelector('[data-role="canvas"]')!;

    this.root.querySelector('[data-role="restart"]')!
      .addEventListener("click", () => this.onRestart?.());
    this.muteBtn.addEventListener("click", () => this.onMuteToggle?.());
  }

  /** 全屏 FX 层（潞河砸向视口用），挂 document.body，destroy 时移除 */
  createFxLayer(): HTMLCanvasElement {
    if (this.fxCanvas) return this.fxCanvas;
    const c = document.createElement("canvas");
    c.className = "gluhe-fx-layer";
    document.body.appendChild(c);
    this.fxCanvas = c;
    return c;
  }

  setScore(score: number, best: number, luhe: number): void {
    this.hudScore.textContent = String(score);
    this.hudBest.textContent = String(best);
    this.hudLuhe.textContent = `× ${luhe}`;
  }

  setTheme(theme: GameTheme): void {
    this.root.dataset.theme = theme;
  }

  setNext(level: number): void {
    this.nextImg.src = this.assetBase + schoolByLevel(level).logo;
    this.nextImg.alt = schoolByLevel(level).shortName;
  }

  setMuted(muted: boolean): void {
    this.muteBtn.textContent = muted ? "🔇" : "🔊";
  }

  setDim(on: boolean): void {
    if (on && !this.dimEl) {
      this.dimEl = document.createElement("div");
      this.dimEl.className = "gluhe-dim";
      document.body.appendChild(this.dimEl);
      requestAnimationFrame(() => this.dimEl?.classList.add("on"));
    } else if (!on && this.dimEl) {
      const el = this.dimEl;
      this.dimEl = null;
      el.classList.remove("on");
      setTimeout(() => el.remove(), 500);
    }
  }

  setHeavyText(text: string | null): void {
    if (text === null) {
      if (this.heavyTextEl) {
        this.heavyTextEl.classList.remove("on");
        const el = this.heavyTextEl;
        this.heavyTextEl = null;
        setTimeout(() => el.remove(), 300);
      }
      return;
    }
    if (!this.heavyTextEl) {
      this.heavyTextEl = document.createElement("div");
      this.heavyTextEl.className = "gluhe-heavy-text";
      document.body.appendChild(this.heavyTextEl);
      requestAnimationFrame(() => this.heavyTextEl?.classList.add("on"));
    }
    if (this.heavyTextEl.textContent !== text) {
      this.heavyTextEl.textContent = text;
    }
  }

  showGameOver(score: number, best: number, luheCount: number, maxSchool: string): void {
    this.closeModal();
    const mask = document.createElement("div");
    mask.className = "gluhe-modal-mask";
    mask.innerHTML = `
      <div class="gluhe-modal">
        <h2>游戏结束</h2>
        <div class="gluhe-final-score">${score}</div>
        <table>
          <tr><td>历史最高</td><td>${best}</td></tr>
          <tr><td>合成潞河</td><td>× ${luheCount}</td></tr>
          <tr><td>最高学校</td><td>${maxSchool}</td></tr>
        </table>
        <button class="gluhe-btn primary" data-role="again">再来一次</button>
      </div>`;
    this.stage.appendChild(mask);
    mask.querySelector('[data-role="again"]')!
      .addEventListener("click", () => this.onRestart?.());
    this.modal = mask;
  }

  showRestartConfirm(onYes: () => void): void {
    this.closeModal();
    const mask = document.createElement("div");
    mask.className = "gluhe-modal-mask";
    mask.innerHTML = `
      <div class="gluhe-modal">
        <h2>重新开始？</h2>
        <p style="margin:0 0 14px;font-size:14px;">当前进度将会丢失</p>
        <button class="gluhe-btn primary" data-role="yes">重开</button>
        <button class="gluhe-btn" data-role="no">继续</button>
      </div>`;
    this.stage.appendChild(mask);
    mask.querySelector('[data-role="yes"]')!.addEventListener("click", () => {
      this.closeModal();
      onYes();
    });
    mask.querySelector('[data-role="no"]')!.addEventListener("click", () => this.closeModal());
    this.modal = mask;
  }

  closeModal(): void {
    if (this.modal) {
      this.modal.remove();
      this.modal = null;
    }
  }

  destroy(): void {
    this.closeModal();
    if (this.dimEl) { this.dimEl.remove(); this.dimEl = null; }
    if (this.heavyTextEl) { this.heavyTextEl.remove(); this.heavyTextEl = null; }
    if (this.fxCanvas) { this.fxCanvas.remove(); this.fxCanvas = null; }
    this.root.innerHTML = "";
    this.root.classList.remove("gluhe-root");
  }
}
