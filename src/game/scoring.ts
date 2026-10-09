import type { Landmarks } from '../vision/vision';
import type { Grade } from '../types';
import { SEGMENTS, type Move, type Segment } from './moves';

/** MediaPipe pose indexes for each segment as seen on the mirrored screen. */
const SEG_POINTS: Record<Segment, [number, number]> = {
  // After mirroring, the player's anatomical right side shows on the screen's left.
  lUpper: [12, 14], lFore: [14, 16],
  rUpper: [11, 13], rFore: [13, 15],
  lThigh: [24, 26], lShin: [26, 28],
  rThigh: [23, 25], rShin: [25, 27],
};
const WEIGHTS: Record<Segment, number> = {
  lUpper: 1.2, lFore: 1, rUpper: 1.2, rFore: 1,
  lThigh: 0.9, lShin: 0.6, rThigh: 0.9, rShin: 0.6,
};

/** Video aspect matters: landmarks are normalised separately in x and y. */
export function segmentAngles(lm: Landmarks, aspect: number): Partial<Record<Segment, { angle: number; vis: number }>> {
  const out: Partial<Record<Segment, { angle: number; vis: number }>> = {};
  for (const s of SEGMENTS) {
    const [a, b] = SEG_POINTS[s];
    const pa = lm[a], pb = lm[b];
    if (!pa || !pb) continue;
    const ang = (Math.atan2(pb.y - pa.y, (pb.x - pa.x) * aspect) * 180) / Math.PI;
    out[s] = { angle: (ang + 360) % 360, vis: Math.min(pa.visibility ?? 1, pb.visibility ?? 1) };
  }
  return out;
}

/**
 * 0..1 similarity between the player's pose and a target move.
 * Scores each limb's angular error, weighted; legs are only judged
 * for leg moves and only if the camera can see them.
 */
export function poseSimilarity(lm: Landmarks, move: Move, aspect: number): number {
  const angles = segmentAngles(lm, aspect);
  let sum = 0, wsum = 0;
  for (const s of SEGMENTS) {
    const isLeg = s.includes('Thigh') || s.includes('Shin');
    const got = angles[s];
    if (isLeg && !move.legs) continue;
    if (!got || got.vis < 0.4) {
      if (isLeg) continue; // legs off-camera: don't punish, TV setups vary
      wsum += WEIGHTS[s];
      continue;
    }
    const diff = (((move[s] - got.angle) % 360) + 540) % 360 - 180;
    // Gaussian on angular error: 15° → 0.91, 25° → 0.78, 35° → 0.61, 50° → 0.37
    const sim = Math.exp(-((diff / 50) ** 2));
    sum += sim * WEIGHTS[s];
    wsum += WEIGHTS[s];
  }
  // (squats are captured by the thigh/shin angles; `crouch` is only for drawing)
  return wsum ? sum / wsum : 0;
}

export function gradeFor(sim: number, t: [number, number, number, number]): Grade {
  return sim >= t[0] ? 'PERFECT' : sim >= t[1] ? 'GREAT' : sim >= t[2] ? 'GOOD' : sim >= t[3] ? 'OK' : 'MISS';
}

export const GRADE_POINTS: Record<Grade, number> = { PERFECT: 1000, GREAT: 700, GOOD: 400, OK: 150, MISS: 0 };

/**
 * Rough calorie burn from how much the body moves. Average landmark speed
 * (in body-heights/s) is mapped to a MET value, then MET × kg × hours.
 */
export class BurnMeter {
  kcal = 0;
  intensity = 0; // smoothed 0..1
  private prev: Landmarks | null = null;
  private prevT = 0;

  update(lm: Landmarks | null, t: number, weightKg = 70) {
    if (!lm) { this.prev = null; return; }
    if (this.prev && t > this.prevT) {
      const dt = (t - this.prevT) / 1000;
      if (dt > 0 && dt < 0.25) {
        const height = Math.abs((lm[27].y + lm[28].y) / 2 - (lm[0].y)) || 0.8;
        let move = 0;
        for (const i of [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28]) {
          move += Math.hypot(lm[i].x - this.prev[i].x, lm[i].y - this.prev[i].y);
        }
        const speed = move / 13 / height / dt; // body heights / s
        const target = Math.min(1, speed / 1.2);
        this.intensity += (target - this.intensity) * 0.1;
        const met = 2.5 + this.intensity * 7.5; // light dancing → full-on aerobic
        this.kcal += (met * weightKg * dt) / 3600;
      }
    }
    this.prev = lm;
    this.prevT = t;
  }
}
