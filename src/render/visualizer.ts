import type { AudioEngine } from '../audio/player';
import type { Theme } from '../types';

const DEFAULT_THEME: Theme = {
  name: 'Lobby',
  style: 'radialBurst',
  palette: ['#ff2bd6', '#00e5ff', '#ffe600', '#ffffff'],
  background: ['#1a0030', '#020010'],
};

interface Star { x: number; y: number; z: number }

/** Full-screen music-reactive background, themed per song. */
export class Visualizer {
  theme: Theme = DEFAULT_THEME;
  /** 0..1 pulse that decays after each beat */
  beatPulse = 0;
  /** big-moment intensity (drops, streaks) */
  hype = 0;
  private stars: Star[] = Array.from({ length: 400 }, () => this.newStar(true));
  private rot = 0;
  private bolts: { pts: [number, number][]; life: number }[] = [];

  setTheme(t: Theme | null) {
    this.theme = t ?? DEFAULT_THEME;
  }

  beat(strength = 1) {
    this.beatPulse = Math.max(this.beatPulse, strength);
  }

  private newStar(anywhere = false): Star {
    return { x: (Math.random() - 0.5) * 2, y: (Math.random() - 0.5) * 2, z: anywhere ? Math.random() : 1 };
  }

  draw(g: CanvasRenderingContext2D, w: number, h: number, a: AudioEngine, dt: number) {
    const [c1, c2, c3] = this.theme.palette;
    this.beatPulse *= Math.pow(0.02, dt);
    this.hype *= Math.pow(0.4, dt);
    this.rot += dt * (0.1 + a.level * 0.8);

    // background gradient breathes with bass
    const bg = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) * (0.7 + a.bass * 0.2));
    bg.addColorStop(0, this.theme.background[0]);
    bg.addColorStop(1, this.theme.background[1]);
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);

    g.save();
    g.globalCompositeOperation = 'lighter';
    switch (this.theme.style) {
      case 'neonBars': this.neonBars(g, w, h, a, c1, c2); break;
      case 'radialBurst': this.radial(g, w, h, a, c1, c2, c3); break;
      case 'liquidWaves': this.waves(g, w, h, a, [c1, c2, c3]); break;
      case 'glitchStorm': this.glitch(g, w, h, a, c1, c2, dt); break;
      case 'starfield': this.starfield(g, w, h, a, c1, c3, dt); break;
    }
    // beat flash
    if (this.beatPulse > 0.05) {
      g.globalAlpha = this.beatPulse * (0.08 + this.hype * 0.25);
      g.fillStyle = c1;
      g.fillRect(0, 0, w, h);
    }
    g.restore();
  }

  private neonBars(g: CanvasRenderingContext2D, w: number, h: number, a: AudioEngine, c1: string, c2: string) {
    const n = 48;
    const bw = w / n;
    for (let i = 0; i < n; i++) {
      const bin = Math.floor(Math.pow(i / n, 1.6) * 380) + 2;
      const v = a.freq[bin] / 255;
      const len = v * h * (0.32 + this.beatPulse * 0.12);
      g.fillStyle = i % 2 ? c1 : c2;
      g.globalAlpha = 0.25 + v * 0.6;
      g.shadowColor = g.fillStyle;
      g.shadowBlur = 25;
      g.fillRect(i * bw + 2, h - len, bw - 4, len);
      g.fillRect(i * bw + 2, 0, bw - 4, len * 0.6);
    }
    // laser sweep
    g.globalAlpha = 0.15 + a.treble * 0.5;
    g.strokeStyle = c2;
    g.lineWidth = 3;
    for (let k = 0; k < 6; k++) {
      const ang = this.rot * (k % 2 ? 1 : -1) + (k * Math.PI) / 3;
      g.beginPath();
      g.moveTo(w / 2, h);
      g.lineTo(w / 2 + Math.cos(ang) * h * 2, h + Math.sin(ang) * h * 2);
      g.stroke();
    }
    g.shadowBlur = 0;
  }

  private radial(g: CanvasRenderingContext2D, w: number, h: number, a: AudioEngine, c1: string, c2: string, c3: string) {
    const cx = w / 2, cy = h * 0.32;
    const base = Math.min(w, h) * (0.18 + a.bass * 0.08 + this.beatPulse * 0.05);
    const n = 96;
    g.lineWidth = 6;
    for (let i = 0; i < n; i++) {
      const v = a.freq[Math.floor((i / n) * 300) + 2] / 255;
      const ang = (i / n) * Math.PI * 2 + this.rot;
      const r2 = base + v * Math.min(w, h) * 0.35;
      g.strokeStyle = i % 3 === 0 ? c1 : i % 3 === 1 ? c2 : c3;
      g.globalAlpha = 0.3 + v * 0.7;
      g.beginPath();
      g.moveTo(cx + Math.cos(ang) * base, cy + Math.sin(ang) * base);
      g.lineTo(cx + Math.cos(ang) * r2, cy + Math.sin(ang) * r2);
      g.stroke();
    }
    // concentric shock rings on beats
    g.globalAlpha = this.beatPulse * 0.7;
    g.strokeStyle = c3;
    g.lineWidth = 4;
    g.beginPath();
    g.arc(cx, cy, base * (1.6 - this.beatPulse * 0.5) + (1 - this.beatPulse) * w * 0.6, 0, Math.PI * 2);
    g.stroke();
  }

  private waves(g: CanvasRenderingContext2D, w: number, h: number, a: AudioEngine, cols: string[]) {
    const t = performance.now() / 1000;
    for (let layer = 0; layer < 3; layer++) {
      g.globalAlpha = 0.18 + a.mid * 0.3;
      const grad = g.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, 'transparent');
      grad.addColorStop(1, cols[layer]);
      g.fillStyle = grad;
      g.beginPath();
      const yBase = h * (0.55 + layer * 0.1);
      g.moveTo(0, h);
      for (let x = 0; x <= w; x += 12) {
        const wi = Math.floor((x / w) * 1000) + layer * 300;
        const wv = (a.wave[wi % a.wave.length] - 128) / 128;
        const y = yBase + Math.sin(x / (180 + layer * 60) + t * (0.6 + layer * 0.3)) * (60 + a.bass * 140) + wv * 90;
        g.lineTo(x, y);
      }
      g.lineTo(w, h);
      g.fill();
    }
    // aurora curtains
    for (let k = 0; k < 5; k++) {
      g.globalAlpha = 0.06 + a.treble * 0.2;
      g.fillStyle = cols[k % 3];
      const x = ((Math.sin(t * 0.2 + k * 1.7) + 1) / 2) * w;
      g.fillRect(x - 40, 0, 80 + a.mid * 120, h * 0.6);
    }
  }

  private glitch(g: CanvasRenderingContext2D, w: number, h: number, a: AudioEngine, c1: string, c2: string, dt: number) {
    // slices
    const slices = 12 + Math.floor(a.level * 30);
    for (let i = 0; i < slices; i++) {
      const y = Math.random() * h;
      const hh = 4 + Math.random() * 40 * a.bass;
      g.globalAlpha = 0.1 + Math.random() * 0.3 * a.level;
      g.fillStyle = Math.random() > 0.5 ? c1 : c2;
      g.fillRect((Math.random() - 0.5) * 60 * a.bass, y, w, hh);
    }
    // lightning on kicks
    if (a.kick || Math.random() < this.hype * 0.05) {
      const pts: [number, number][] = [[Math.random() * w, 0]];
      while (pts[pts.length - 1][1] < h) {
        const [x, y] = pts[pts.length - 1];
        pts.push([x + (Math.random() - 0.5) * 160, y + 40 + Math.random() * 80]);
      }
      this.bolts.push({ pts, life: 1 });
    }
    for (const b of this.bolts) {
      g.globalAlpha = b.life;
      g.strokeStyle = '#fff';
      g.shadowColor = c1;
      g.shadowBlur = 30;
      g.lineWidth = 3 + b.life * 4;
      g.beginPath();
      b.pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
      g.stroke();
      b.life -= dt * 4;
    }
    g.shadowBlur = 0;
    this.bolts = this.bolts.filter((b) => b.life > 0);
    // bass bars at the bottom
    g.globalAlpha = 0.5;
    g.fillStyle = c1;
    g.fillRect(0, h - a.bass * 220, w, a.bass * 220);
  }

  private starfield(g: CanvasRenderingContext2D, w: number, h: number, a: AudioEngine, c1: string, c3: string, dt: number) {
    const speed = 0.08 + a.level * 0.9 + this.beatPulse * 0.6;
    const cx = w / 2, cy = h * 0.4;
    for (const s of this.stars) {
      const pz = s.z;
      s.z -= dt * speed;
      if (s.z <= 0.01) Object.assign(s, this.newStar());
      const sx = cx + (s.x / s.z) * w * 0.5, sy = cy + (s.y / s.z) * w * 0.5;
      const px = cx + (s.x / pz) * w * 0.5, py = cy + (s.y / pz) * w * 0.5;
      g.globalAlpha = Math.min(1, (1 - s.z) * 1.4);
      g.strokeStyle = s.x > 0 ? c1 : c3;
      g.lineWidth = (1 - s.z) * 4;
      g.beginPath();
      g.moveTo(px, py);
      g.lineTo(sx, sy);
      g.stroke();
    }
    // nebula
    g.globalAlpha = 0.15 + a.bass * 0.3;
    const neb = g.createRadialGradient(cx, cy, 0, cx, cy, w * 0.6);
    neb.addColorStop(0, c1);
    neb.addColorStop(1, 'transparent');
    g.fillStyle = neb;
    g.fillRect(0, 0, w, h);
  }
}
