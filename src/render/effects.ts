interface Particle { x: number; y: number; vx: number; vy: number; life: number; size: number; color: string }
interface Ring { x: number; y: number; r: number; life: number; color: string; width: number }
interface Popup { text: string; x: number; y: number; life: number; color: string; size: number; key?: string }

/** Particles, shockwaves, text popups, screen shake and strobe. */
export class Effects {
  particles: Particle[] = [];
  rings: Ring[] = [];
  popups: Popup[] = [];
  shake = 0;
  strobe = 0;
  /** big banner text (e.g. "SPEED UP!") */
  banner: { text: string; life: number; color: string } | null = null;

  burst(x: number, y: number, colors: string[], count = 40, power = 900) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = power * (0.3 + Math.random() * 0.7);
      this.particles.push({
        x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 200,
        life: 1, size: 4 + Math.random() * 10, color: colors[i % colors.length],
      });
    }
  }

  confettiRain(w: number, colors: string[], count = 120) {
    for (let i = 0; i < count; i++) {
      this.particles.push({
        x: Math.random() * w, y: -20 - Math.random() * 400, vx: (Math.random() - 0.5) * 200, vy: 300 + Math.random() * 400,
        life: 1.6, size: 6 + Math.random() * 10, color: colors[i % colors.length],
      });
    }
  }

  ring(x: number, y: number, color: string, width = 10) {
    this.rings.push({ x, y, r: 20, life: 1, color, width });
  }

  /** Popups sharing a `key` replace each other instead of stacking. */
  popup(text: string, x: number, y: number, color: string, size = 90, key?: string) {
    if (key) this.popups = this.popups.filter((p) => p.key !== key);
    this.popups.push({ text, x, y, life: 1, color, size, key });
  }

  announce(text: string, color = '#fff') {
    this.banner = { text, life: 1.6, color };
  }

  update(dt: number) {
    for (const p of this.particles) {
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vy += 1400 * dt; p.vx *= 0.99;
      p.life -= dt * 0.9;
    }
    this.particles = this.particles.filter((p) => p.life > 0);
    for (const r of this.rings) { r.r += 1600 * dt * r.life + 200 * dt; r.life -= dt * 1.6; }
    this.rings = this.rings.filter((r) => r.life > 0);
    for (const p of this.popups) { p.y -= 160 * dt; p.life -= dt * 1.2; }
    this.popups = this.popups.filter((p) => p.life > 0);
    this.shake *= Math.pow(0.02, dt);
    this.strobe = Math.max(0, this.strobe - dt);
    if (this.banner && (this.banner.life -= dt) <= 0) this.banner = null;
  }

  applyShake(g: CanvasRenderingContext2D) {
    if (this.shake > 0.5) g.translate((Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake);
  }

  draw(g: CanvasRenderingContext2D, w: number, h: number) {
    g.save();
    g.globalCompositeOperation = 'lighter';
    for (const p of this.particles) {
      g.globalAlpha = Math.min(1, p.life);
      g.fillStyle = p.color;
      g.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    for (const r of this.rings) {
      g.globalAlpha = r.life;
      g.strokeStyle = r.color;
      g.lineWidth = r.width * r.life;
      g.beginPath();
      g.arc(r.x, r.y, r.r, 0, Math.PI * 2);
      g.stroke();
    }
    g.restore();

    g.save();
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (const p of this.popups) {
      const scale = 1 + (1 - p.life) * 0.3 + (p.life > 0.85 ? (p.life - 0.85) * 3 : 0);
      g.globalAlpha = Math.min(1, p.life * 2);
      g.font = `900 ${p.size * scale}px "Bungee", system-ui, sans-serif`;
      g.lineWidth = 10;
      g.strokeStyle = 'rgba(0,0,0,0.7)';
      g.strokeText(p.text, p.x, p.y);
      g.fillStyle = p.color;
      g.shadowColor = p.color;
      g.shadowBlur = 30;
      g.fillText(p.text, p.x, p.y);
      g.shadowBlur = 0;
    }
    if (this.banner) {
      const b = this.banner;
      const t = 1.6 - b.life;
      const scale = t < 0.2 ? 0.5 + t * 2.5 : 1;
      g.globalAlpha = Math.min(1, b.life * 2);
      g.font = `900 ${Math.round(w * 0.11 * scale)}px "Bungee", system-ui, sans-serif`;
      g.fillStyle = b.color;
      g.shadowColor = b.color;
      g.shadowBlur = 50;
      g.save();
      g.translate(w / 2, h * 0.45);
      g.rotate(-0.06);
      g.fillText(b.text, 0, 0);
      g.restore();
      g.shadowBlur = 0;
    }
    if (this.strobe > 0 && Math.floor(this.strobe * 30) % 2 === 0) {
      g.globalAlpha = 0.35;
      g.fillStyle = '#fff';
      g.fillRect(0, 0, w, h);
    }
    g.restore();
  }
}
