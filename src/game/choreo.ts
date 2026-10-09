import type { Difficulty, SongAnalysis } from '../types';
import { MOVES, type Move } from './moves';

export interface Step {
  move: Move;
  /** song time (s) the pose must be hit */
  time: number;
  beat: number;
  /** 0-based speed level this step belongs to (for "it gets faster" UI) */
  level: number;
  /** step falls on a drop – extra effects + double points */
  drop: boolean;
}

export interface DifficultyProfile {
  label: string;
  maxTier: number;
  /** beats between moves at speed level 0,1,2,3 */
  intervals: number[];
  /** ± ms around the hit time that counts */
  window: number;
  /** similarity thresholds for PERFECT/GREAT/GOOD/OK */
  thresholds: [number, number, number, number];
  gestures: boolean;
}

export const PROFILES: Record<Difficulty, DifficultyProfile> = {
  easy: { label: 'Easy', maxTier: 1, intervals: [8, 4, 4, 4], window: 450, thresholds: [0.82, 0.72, 0.6, 0.45], gestures: false },
  medium: { label: 'Medium', maxTier: 2, intervals: [4, 4, 2, 2], window: 380, thresholds: [0.86, 0.76, 0.64, 0.5], gestures: false },
  hard: { label: 'Hard', maxTier: 3, intervals: [4, 2, 2, 1], window: 320, thresholds: [0.89, 0.8, 0.68, 0.54], gestures: true },
  extreme: { label: 'Extreme', maxTier: 4, intervals: [2, 2, 1, 1], window: 260, thresholds: [0.91, 0.83, 0.72, 0.58], gestures: true },
};

/** Seeded PRNG so the same song+difficulty always gets the same routine. */
function rng(seed: string) {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h ^= h << 13; h ^= h >>> 17; h ^= h << 5;
    return ((h >>> 0) % 100000) / 100000;
  };
}

/**
 * Builds the routine: moves land on beats, the gap between moves shrinks as
 * the song progresses (and when the music gets louder), and harder moves
 * unlock as the speed level climbs.
 */
export function choreograph(a: SongAnalysis, difficulty: Difficulty, seed: string): Step[] {
  const p = PROFILES[difficulty];
  const rand = rng(seed + difficulty);
  const steps: Step[] = [];
  const beats = a.beats;
  // skip a short intro so the player can get into position
  let i = Math.max(4, beats.findIndex((t) => t > 3.5));
  // align to bar
  i += (4 - (i % 4)) % 4;
  const dropSet = new Set(a.drops);
  let lastId = '';

  while (i < beats.length - 2) {
    const progress = beats[i] / a.duration;
    let level = progress < 0.25 ? 0 : progress < 0.5 ? 1 : progress < 0.75 ? 2 : 3;
    // calm passages give a breather, hype passages push one level up
    const e = a.beatEnergy[i] ?? 0.5;
    if (e < 0.25) level = Math.max(0, level - 1);
    if (e > 0.85) level = Math.min(3, level + 1);
    // never ask for more than ~2.5 moves per second
    let interval = p.intervals[level];
    while ((60 / a.bpm) * interval < 0.4) interval *= 2;

    const tierCap = Math.min(p.maxTier, 1 + Math.floor(level * 0.7 + (p.maxTier - 1) * progress));
    const pool = MOVES.filter((m) => m.tier <= tierCap && (p.gestures || !m.gesture) && m.id !== lastId);
    // favour the newest tier so it ramps up visibly
    const weighted = pool.flatMap((m) => (m.tier === tierCap ? [m, m] : [m]));
    const move = weighted[Math.floor(rand() * weighted.length)];
    lastId = move.id;
    const drop = [...dropSet].some((d) => d >= i && d < i + interval);
    steps.push({ move, time: beats[i], beat: i, level, drop });
    i += interval;
  }
  return steps;
}
