import { ARENA_WIDTH } from "../data/schools";

/** 指针输入（鼠标 + 触摸统一走 Pointer Events），可完整销毁 */
export class InputController {
  private canvas: HTMLCanvasElement;
  private dragging = false;
  private activePointerId: number | null = null;

  onAim: ((xLogical: number) => void) | null = null;
  onDrop: (() => void) | null = null;
  onFirstInteract: (() => void) | null = null;
  private interacted = false;

  private disposers: (() => void)[] = [];

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.bind();
  }

  private toLogicalX(clientX: number): number {
    const rect = this.canvas.getBoundingClientRect();
    const ratio = ARENA_WIDTH / rect.width;
    return (clientX - rect.left) * ratio;
  }

  private listen<K extends keyof HTMLElementEventMap>(
    type: K, handler: (ev: HTMLElementEventMap[K]) => void, options?: AddEventListenerOptions
  ): void {
    this.canvas.addEventListener(type, handler, options);
    this.disposers.push(() => this.canvas.removeEventListener(type, handler, options));
  }

  private bind(): void {
    this.listen("pointerdown", (ev) => {
      ev.preventDefault();
      if (!this.interacted) {
        this.interacted = true;
        this.onFirstInteract?.();
      }
      if (this.activePointerId !== null) return; // 忽略多指
      this.activePointerId = ev.pointerId;
      this.dragging = true;
      try { this.canvas.setPointerCapture(ev.pointerId); } catch { /* ignore */ }
      this.onAim?.(this.toLogicalX(ev.clientX));
    });

    this.listen("pointermove", (ev) => {
      if (!this.dragging || ev.pointerId !== this.activePointerId) {
        // 桌面悬停也可以移动瞄准
        if (ev.pointerType === "mouse" && this.activePointerId === null) {
          this.onAim?.(this.toLogicalX(ev.clientX));
        }
        return;
      }
      ev.preventDefault();
      this.onAim?.(this.toLogicalX(ev.clientX));
    });

    const release = (ev: PointerEvent) => {
      if (ev.pointerId !== this.activePointerId) return;
      this.dragging = false;
      this.activePointerId = null;
      try { this.canvas.releasePointerCapture(ev.pointerId); } catch { /* ignore */ }
      this.onAim?.(this.toLogicalX(ev.clientX));
      this.onDrop?.();
    };
    this.canvas.addEventListener("pointerup", release);
    this.disposers.push(() => this.canvas.removeEventListener("pointerup", release));
    this.canvas.addEventListener("pointercancel", release);
    this.disposers.push(() => this.canvas.removeEventListener("pointercancel", release));

    // 阻止触摸时页面滚动/右键菜单干扰
    this.listen("contextmenu", (ev) => ev.preventDefault());
    this.listen("touchstart", (ev) => ev.preventDefault(), { passive: false });
    this.listen("touchmove", (ev) => ev.preventDefault(), { passive: false });
  }

  destroy(): void {
    for (const d of this.disposers) d();
    this.disposers = [];
    this.dragging = false;
    this.activePointerId = null;
  }
}
