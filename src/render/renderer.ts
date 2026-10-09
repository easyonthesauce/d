import type { AudioEngine } from '../audio/player';
import { PROFILES } from '../game/choreo';
import type { Game, Round } from '../game/game';
import { blendMoves, NEUTRAL, type Move } from '../game/moves';
import type { Vision } from '../vision/vision';
import type { Effects } from './effects';
import { drawFigure, drawSkeleton } from './figure';
import { L, type Rect } from './layout';
import type { Visualizer } from './visualizer';

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export class Renderer {
  private avatars = new Map<string, HTMLImageElement>();
  private shownScore = 0;

  constructor(
    private g: CanvasRenderingContext2D,
    private game: Game,
    private audio: AudioEngine,
    private vision: Vision,
    private viz: Visualizer,
    private fx: Effects,
  ) {}

  private avatar(id: string, src: string) {
    let img = this.avatars.get(id);
    if (!img || img.src !== src) {
      img = new Image();
      img.src = src;
      this.avatars.set(id, img);
    }
    return img;
  }

  frame(dt: number) {
    const g = this.g;
    const { W, H } = L;
    g.save();
    this.fx.applyShake(g);
    this.viz.draw(g, W, H, this.audio, dt);

    const s = this.game.screen;
    const r = this.game.round;
    if ((s === 'play' || s === 'countdown' || s === 'paused') && r) {
      this.drawRound(r);
    } else if (s === 'enroll') {
      this.drawCamera({ x: L.W * 0.1, y: L.H * 0.22, w: L.W * 0.8, h: L.portrait ? L.W * 0.8 : L.H * 0.6 }, true, true);
    } else if (s === 'lobby') {
      const size = L.portrait ? 400 : 300;
      this.drawCamera({ x: L.W / 2 - size / 2, y: 320, w: size, h: size }, true, false);
    }
    this.fx.update(dt);
    this.fx.draw(g, W, H);
    g.restore();
  }

  /** Mirrored camera feed with "cover" fit; optional round mask & face guide. */
  private drawCamera(rect: Rect, round: boolean, guide: boolean) {
    const g = this.g, v = this.vision.video;
    if (v.readyState < 2) return;
    const vw = v.videoWidth, vh = v.videoHeight;
    const scale = Math.max(rect.w / vw, rect.h / vh);
    const sw = rect.w / scale, sh = rect.h / scale;
    const sx = (vw - sw) / 2, sy = (vh - sh) / 2;
    g.save();
    g.beginPath();
    if (round) g.ellipse(rect.x + rect.w / 2, rect.y + rect.h / 2, rect.w / 2, rect.h / 2, 0, 0, Math.PI * 2);
    else g.roundRect(rect.x, rect.y, rect.w, rect.h, 36);
    g.clip();
    g.translate(rect.x + rect.w, rect.y);
    g.scale(-1, 1);
    g.globalAlpha = round ? 1 : 0.55;
    g.drawImage(v, sx, sy, sw, sh, 0, 0, rect.w, rect.h);
    g.restore();

    const p = this.game.players.current;
    g.save();
    g.lineWidth = 10;
    g.strokeStyle = p?.color ?? this.viz.theme.palette[0];
    g.shadowColor = g.strokeStyle;
    g.shadowBlur = 30 + this.audio.bass * 40;
    g.beginPath();
    if (round) g.ellipse(rect.x + rect.w / 2, rect.y + rect.h / 2, rect.w / 2, rect.h / 2, 0, 0, Math.PI * 2);
    else g.roundRect(rect.x, rect.y, rect.w, rect.h, 36);
    g.stroke();
    if (guide) {
      g.setLineDash([24, 18]);
      g.lineWidth = 6;
      g.strokeStyle = '#fff';
      g.beginPath();
      g.ellipse(rect.x + rect.w / 2, rect.y + rect.h * 0.46, rect.w * 0.22, rect.h * 0.3, 0, 0, Math.PI * 2);
      g.stroke();
    }
    g.restore();
    return { sx, sy, sw, sh };
  }

  private coachMove(r: Round, t: number): { move: Move; next: Move | null } {
    const steps = r.steps;
    let k = steps.findIndex((s) => s.time > t);
    if (k === -1) k = steps.length;
    const prev = steps[k - 1];
    const next = steps[k];
    if (!next) return { move: prev?.move ?? NEUTRAL, next: null };
    const from = prev?.move ?? NEUTRAL;
    const t0 = prev?.time ?? Math.max(0, next.time - 2);
    const span = next.time - t0;
    // reach the pose a touch before the hit so the player can read it
    const p = Math.min(1, Math.max(0, (t - t0) / (span * 0.75)));
    return { move: blendMoves(from, next.move, ease(p)), next: next.move };
  }

  private drawRound(r: Round) {
    const g = this.g;
    const t = this.audio.time;
    const pal = r.analysis.theme.palette;

    // ----- coach -----
    const { move } = this.coachMove(r, t);
    drawFigure(g, move, L.coach.x, L.coach.y, L.coach.size, pal[0], {
      glow: 40 + this.viz.beatPulse * 60,
      bounce: this.viz.beatPulse,
      outline: 'rgba(255,255,255,0.9)',
    });
    const upcoming = r.steps[r.idx];
    if (upcoming) {
      g.save();
      g.textAlign = 'center';
      g.font = `900 ${L.portrait ? 56 : 46}px Bungee, system-ui`;
      g.fillStyle = '#fff';
      g.shadowColor = pal[1];
      g.shadowBlur = 20;
      g.fillText(upcoming.move.name.toUpperCase(), L.coach.x, L.coach.y + L.coach.size * 0.5 + 20);
      g.restore();
    }

    // ----- pictogram track -----
    this.drawTrack(r, t, pal);

    // ----- camera + skeleton -----
    const crop = this.drawCamera(L.cam, false, false);
    const lm = this.vision.latest.landmarks;
    if (crop && lm) {
      const v = this.vision.video;
      // map normalised landmarks (already mirrored) into the cover-cropped panel
      const sxN = crop.sx / v.videoWidth, syN = crop.sy / v.videoHeight;
      const swN = crop.sw / v.videoWidth, shN = crop.sh / v.videoHeight;
      const mapped = lm.map((p) => ({ ...p, x: (p.x - sxN) / swN, y: (p.y - syN) / shN }));
      const sim = r.liveSim;
      const col = sim > 0.85 ? '#ffe600' : sim > 0.7 ? '#00ffa3' : this.game.players.current?.color ?? '#fff';
      g.save();
      g.beginPath();
      g.roundRect(L.cam.x, L.cam.y, L.cam.w, L.cam.h, 36);
      g.clip();
      drawSkeleton(g, mapped, L.cam.x, L.cam.y, L.cam.w, L.cam.h, col, sim);
      g.restore();
    } else if (crop) {
      g.save();
      g.textAlign = 'center';
      g.font = '700 48px Bungee, system-ui';
      g.fillStyle = '#fff';
      g.fillText('STEP INTO THE FRAME!', L.cam.x + L.cam.w / 2, L.cam.y + L.cam.h / 2);
      g.restore();
    }

    this.drawHud(r, t);

    if (this.game.screen === 'countdown') {
      const n = Math.ceil(this.game.countdown);
      const frac = this.game.countdown - Math.floor(this.game.countdown);
      g.save();
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.font = `900 ${Math.round(L.W * 0.4 * (0.8 + frac * 0.4))}px Bungee, system-ui`;
      g.fillStyle = pal[2];
      g.shadowColor = pal[0];
      g.shadowBlur = 60;
      g.globalAlpha = 0.3 + frac * 0.7;
      g.fillText(String(Math.max(1, n)), L.W / 2, L.H * 0.4);
      g.restore();
    }
    if (this.game.screen === 'paused') {
      g.save();
      g.fillStyle = 'rgba(0,0,0,0.65)';
      g.fillRect(0, 0, L.W, L.H);
      g.textAlign = 'center';
      g.fillStyle = '#fff';
      g.font = `900 ${L.W * 0.12}px Bungee, system-ui`;
      g.fillText('PAUSED', L.W / 2, L.H * 0.42);
      g.font = `600 ${L.W * 0.035}px Outfit, system-ui`;
      g.fillText('say "resume" or "stop the game"', L.W / 2, L.H * 0.42 + 90);
      g.restore();
    }
  }

  private drawTrack(r: Round, t: number, pal: readonly string[]) {
    const g = this.g;
    const tr = L.track;
    const cy = tr.y + tr.h / 2;
    const prof = PROFILES[r.difficulty];
    g.save();
    // lane
    const lane = g.createLinearGradient(0, 0, tr.w, 0);
    lane.addColorStop(0, 'rgba(255,255,255,0.18)');
    lane.addColorStop(1, 'rgba(255,255,255,0.02)');
    g.fillStyle = lane;
    g.fillRect(tr.x, tr.y + 20, tr.w, tr.h - 40);
    // hit zone
    const pulse = this.viz.beatPulse;
    g.strokeStyle = pal[2];
    g.lineWidth = 8 + pulse * 8;
    g.shadowColor = pal[2];
    g.shadowBlur = 30;
    g.beginPath();
    g.arc(tr.hitX, cy, tr.h * 0.42 + pulse * 10, 0, Math.PI * 2);
    g.stroke();
    g.shadowBlur = 0;

    // speed-scaled pixels per second so faster sections visibly rush in
    const pps = tr.pxPerSec * (1 + r.level * 0.15);
    for (let k = Math.max(0, r.idx - 1); k < r.steps.length; k++) {
      const s = r.steps[k];
      const x = tr.hitX + (s.time - t) * pps;
      if (x > tr.w + 100) break;
      if (x < -100) continue;
      const judged = k < r.idx;
      const grade = judged ? r.grades[k] : null;
      const col = grade ? this.game.gradeColors[grade] : s.drop ? pal[1] : '#ffffff';
      const rad = tr.h * 0.38;
      g.globalAlpha = judged ? Math.max(0, 1 - (t - s.time) * 2) : 1;
      g.fillStyle = 'rgba(0,0,0,0.55)';
      g.strokeStyle = col;
      g.lineWidth = 5;
      g.beginPath();
      g.arc(x, cy, rad, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      drawFigure(g, s.move, x, cy + rad * 0.05, rad * 1.45, col, { glow: 10 });
      if (s.move.gesture && prof.gestures) {
        g.font = '700 28px system-ui';
        g.textAlign = 'center';
        g.fillStyle = '#fff';
        g.fillText(GESTURE_EMOJI[s.move.gesture] ?? '✋', x + rad * 0.8, cy - rad * 0.7);
      }
    }
    g.restore();
  }

  private drawHud(r: Round, t: number) {
    const g = this.g;
    const p = this.game.players.current;
    const hud = L.hud;
    const pal = r.analysis.theme.palette;
    g.save();
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.fillRect(hud.x, hud.y, hud.w, hud.h);

    // avatar
    const av = hud.h - 40;
    if (p) {
      g.save();
      g.beginPath();
      g.arc(30 + av / 2, 20 + av / 2, av / 2, 0, Math.PI * 2);
      g.clip();
      const img = this.avatar(p.id, p.avatar);
      if (img.complete) g.drawImage(img, 30, 20, av, av);
      g.restore();
      g.strokeStyle = p.color;
      g.lineWidth = 6;
      g.beginPath();
      g.arc(30 + av / 2, 20 + av / 2, av / 2, 0, Math.PI * 2);
      g.stroke();
      g.fillStyle = '#fff';
      g.font = `900 ${Math.round(av * 0.32)}px Bungee, system-ui`;
      g.textBaseline = 'top';
      g.fillText(p.name.toUpperCase(), 50 + av, 26);
      g.font = `600 ${Math.round(av * 0.22)}px Outfit, system-ui`;
      g.fillStyle = 'rgba(255,255,255,0.75)';
      g.fillText(`${r.song.title} · ${PROFILES[r.difficulty].label}`.slice(0, 40), 50 + av, 30 + av * 0.42);
    }

    // score
    this.shownScore += (r.score - this.shownScore) * 0.15;
    g.textAlign = 'right';
    g.textBaseline = 'top';
    g.fillStyle = '#fff';
    g.shadowColor = pal[0];
    g.shadowBlur = 20;
    g.font = `900 ${Math.round(hud.h * 0.4)}px Bungee, system-ui`;
    g.fillText(Math.round(this.shownScore).toLocaleString(), hud.w - 30, 18);
    g.shadowBlur = 0;
    if (r.combo >= 3) {
      const mult = 1 + Math.min(3, Math.floor(r.combo / 10));
      g.font = `900 ${Math.round(hud.h * 0.22)}px Bungee, system-ui`;
      g.fillStyle = pal[2];
      g.fillText(`${r.combo} COMBO${mult > 1 ? `  ×${mult}` : ''}`, hud.w - 30, 26 + hud.h * 0.44);
    }

    // footer: progress, speed level, burn
    const f = L.footer;
    const prog = Math.min(1, t / r.analysis.duration);
    g.fillStyle = 'rgba(255,255,255,0.15)';
    g.fillRect(f.x + 30, f.y + 10, f.w - 60, 14);
    const grad = g.createLinearGradient(f.x, 0, f.w, 0);
    grad.addColorStop(0, pal[0]);
    grad.addColorStop(1, pal[1]);
    g.fillStyle = grad;
    g.fillRect(f.x + 30, f.y + 10, (f.w - 60) * prog, 14);
    // drop markers
    g.fillStyle = '#fff';
    for (const d of r.analysis.drops) {
      const x = f.x + 30 + (f.w - 60) * (r.analysis.beats[d] / r.analysis.duration);
      g.fillRect(x - 2, f.y + 4, 4, 26);
    }
    g.textBaseline = 'top';
    g.font = `700 ${L.portrait ? 30 : 24}px Outfit, system-ui`;
    g.textAlign = 'left';
    g.fillStyle = '#fff';
    const chevrons = '▶'.repeat(r.level + 1) + '▷'.repeat(3 - r.level);
    g.fillText(`SPEED ${chevrons}`, f.x + 30, f.y + 34);
    g.textAlign = 'right';
    const heat = r.burn.intensity;
    g.fillStyle = heat > 0.6 ? '#ff5b2e' : heat > 0.3 ? '#ffb000' : '#fff';
    g.fillText(`🔥 ${r.burn.kcal.toFixed(1)} kcal`, f.w - 30, f.y + 34);
    g.restore();
  }
}

const GESTURE_EMOJI: Record<string, string> = {
  Victory: '✌️', Thumb_Up: '👍', Pointing_Up: '☝️', Open_Palm: '✋', Closed_Fist: '✊', ILoveYou: '🤟',
};
