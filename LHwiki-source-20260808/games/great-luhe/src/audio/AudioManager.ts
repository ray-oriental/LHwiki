/** WebAudio 合成音效：零外部音频文件；首次用户交互后才创建 AudioContext */

export type SfxName =
  | "drop" | "merge" | "luheMerge" | "crush"
  | "heavy" | "floorBreak" | "explosion" | "gameOver" | "click";

const LS_KEY = "gluhe_muted";

export class AudioManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private _muted: boolean;

  constructor() {
    this._muted = typeof localStorage !== "undefined" && localStorage.getItem(LS_KEY) === "1";
  }

  get muted(): boolean { return this._muted; }

  setMuted(m: boolean): void {
    this._muted = m;
    try { localStorage.setItem(LS_KEY, m ? "1" : "0"); } catch { /* ignore */ }
    if (this.master) this.master.gain.value = m ? 0 : 0.5;
  }

  /** 必须在用户手势内调用（autoplay policy） */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return;
    }
    try {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = this._muted ? 0 : 0.5;
      this.master.connect(this.ctx.destination);
    } catch {
      this.ctx = null;
    }
  }

  private tone(freq: number, dur: number, type: OscillatorType, gain: number, slideTo?: number, delay = 0): void {
    if (!this.ctx || !this.master || this._muted) return;
    const t0 = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(g).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  private noise(dur: number, gain: number, lowpass: number, delay = 0): void {
    if (!this.ctx || !this.master || this._muted) return;
    const t0 = this.ctx.currentTime + delay;
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = lowpass;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    src.connect(filter).connect(g).connect(this.master);
    src.start(t0);
  }

  play(name: SfxName, level = 1): void {
    if (!this.ctx || this._muted) return;
    switch (name) {
      case "drop":
        this.tone(260, 0.09, "triangle", 0.25, 170);
        break;
      case "merge": {
        // 等级越高音越低越厚
        const base = Math.max(160, 520 - level * 34);
        this.tone(base, 0.14, "sine", 0.35, base * 1.5);
        this.tone(base * 1.5, 0.12, "triangle", 0.2, base * 2.1, 0.03);
        this.noise(0.08, 0.12, 2400);
        break;
      }
      case "luheMerge":
        this.tone(96, 0.7, "sine", 0.5, 60);
        this.tone(192, 0.5, "triangle", 0.3, 120, 0.05);
        this.noise(0.4, 0.2, 900);
        break;
      case "crush": {
        const base = Math.max(120, 420 - level * 26);
        this.noise(0.12, 0.3, 1600);
        this.tone(base, 0.1, "square", 0.16, base * 0.5);
        break;
      }
      case "heavy":
        this.tone(58, 1.4, "sine", 0.55, 40);
        this.tone(87, 1.1, "triangle", 0.25, 55, 0.1);
        break;
      case "floorBreak":
        this.noise(0.35, 0.45, 700);
        this.tone(70, 0.4, "sawtooth", 0.3, 35);
        break;
      case "explosion":
        this.noise(0.9, 0.6, 500);
        this.tone(50, 1.1, "sine", 0.6, 28);
        this.tone(120, 0.5, "sawtooth", 0.2, 45, 0.02);
        break;
      case "gameOver":
        this.tone(330, 0.25, "sine", 0.3, 260);
        this.tone(260, 0.3, "sine", 0.3, 190, 0.22);
        this.tone(190, 0.55, "sine", 0.32, 120, 0.48);
        break;
      case "click":
        this.tone(600, 0.05, "triangle", 0.15, 500);
        break;
    }
  }
}
