import type { Landmarks } from '../vision/vision';
import type { Move } from '../game/moves';

const rad = (d: number) => (d * Math.PI) / 180;

/**
 * Draws a move as a glowing neon dancer. `size` is roughly the figure's full
 * height in px; (x, y) is the centre of the hips.
 */
export function drawFigure(
  g: CanvasRenderingContext2D,
  move: Move,
  x: number,
  y: number,
  size: number,
  color: string,
  opts: { glow?: number; alpha?: number; bounce?: number; outline?: string } = {},
) {
  const u = size / 10; // unit
  const torso = 3 * u, upper = 1.6 * u, fore = 1.5 * u, thigh = 2.2 * u, shin = 2.1 * u;
  const shoulderW = 1.1 * u, hipW = 0.6 * u;
  const drop = (move.crouch ?? 0) * torso + (opts.bounce ?? 0) * u * 0.25;

  const hipY = y + drop;
  const neckY = hipY - torso;
  const lS: [number, number] = [x - shoulderW, neckY + 0.25 * u];
  const rS: [number, number] = [x + shoulderW, neckY + 0.25 * u];
  const lH: [number, number] = [x - hipW, hipY];
  const rH: [number, number] = [x + hipW, hipY];
  const step = (p: [number, number], ang: number, len: number): [number, number] => [p[0] + Math.cos(rad(ang)) * len, p[1] + Math.sin(rad(ang)) * len];
  const lE = step(lS, move.lUpper, upper), lW = step(lE, move.lFore, fore);
  const rE = step(rS, move.rUpper, upper), rW = step(rE, move.rFore, fore);
  const lK = step(lH, move.lThigh, thigh), lA = step(lK, move.lShin, shin);
  const rK = step(rH, move.rThigh, thigh), rA = step(rK, move.rShin, shin);

  g.save();
  g.globalAlpha = opts.alpha ?? 1;
  g.lineCap = 'round';
  g.lineJoin = 'round';

  const limbs: [number, number][][] = [
    [lS, lE, lW], [rS, rE, rW], [lH, lK, lA], [rH, rK, rA],
  ];
  const pass = (stroke: string, width: number, blur: number) => {
    g.strokeStyle = stroke;
    g.shadowColor = color;
    g.shadowBlur = blur;
    g.lineWidth = width;
    for (const l of limbs) {
      g.beginPath();
      g.moveTo(l[0][0], l[0][1]);
      for (const p of l.slice(1)) g.lineTo(p[0], p[1]);
      g.stroke();
    }
    // torso as a tapered shape
    g.fillStyle = stroke;
    g.beginPath();
    g.moveTo(lS[0], lS[1]);
    g.lineTo(rS[0], rS[1]);
    g.lineTo(rH[0], rH[1]);
    g.lineTo(lH[0], lH[1]);
    g.closePath();
    g.fill();
    g.stroke();
    // head
    g.beginPath();
    g.arc(x, neckY - 0.95 * u, 0.7 * u + (width - u * 0.6) * 0.5, 0, Math.PI * 2);
    g.fill();
  };
  if (opts.outline) pass(opts.outline, u * 0.85, 0);
  pass(color, u * 0.6, opts.glow ?? 40);
  g.restore();
}

/** Player skeleton from live landmarks inside a rect (landmarks already mirrored). */
const BONES: [number, number][] = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24],
  [23, 25], [25, 27], [24, 26], [26, 28],
];

export function drawSkeleton(
  g: CanvasRenderingContext2D,
  lm: Landmarks,
  rx: number, ry: number, rw: number, rh: number,
  color: string,
  quality: number,
) {
  g.save();
  g.lineCap = 'round';
  g.strokeStyle = color;
  g.shadowColor = color;
  g.shadowBlur = 20 + quality * 30;
  g.lineWidth = 10 + quality * 8;
  for (const [a, b] of BONES) {
    if ((lm[a].visibility ?? 1) < 0.3 || (lm[b].visibility ?? 1) < 0.3) continue;
    g.beginPath();
    g.moveTo(rx + lm[a].x * rw, ry + lm[a].y * rh);
    g.lineTo(rx + lm[b].x * rw, ry + lm[b].y * rh);
    g.stroke();
  }
  const nose = lm[0];
  g.fillStyle = color;
  g.beginPath();
  g.arc(rx + nose.x * rw, ry + nose.y * rh, 18, 0, Math.PI * 2);
  g.fill();
  g.restore();
}
