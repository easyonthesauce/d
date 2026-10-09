/// <reference lib="webworker" />
import { ANALYSIS_VERSION, clamp, fft, percentile } from './dsp';
import type { Mood, SongAnalysis, Theme } from '../types';



interface Req { samples: Float32Array; sampleRate: number; taggedGenre?: string }

self.onmessage = (e: MessageEvent<Req>) => {
  const { samples, sampleRate, taggedGenre } = e.data;
  try {
    (self as unknown as Worker).postMessage({ ok: true, analysis: analyse(samples, sampleRate, taggedGenre) });
  } catch (err) {
    (self as unknown as Worker).postMessage({ ok: false, error: String(err) });
  }
};

const N = 1024;
const HOP = 256;
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
// Krumhansl–Kessler key profiles
const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

function analyse(input: Float32Array, inRate: number, taggedGenre?: string): SongAnalysis {
  // Decimate to ~22kHz – plenty for rhythm/tonal features.
  const dec = Math.max(1, Math.round(inRate / 22050));
  const sr = inRate / dec;
  const x = new Float32Array(Math.floor(input.length / dec));
  for (let i = 0; i < x.length; i++) {
    let s = 0;
    for (let k = 0; k < dec; k++) s += input[i * dec + k];
    x[i] = s / dec;
  }
  const duration = x.length / sr;
  const frames = Math.max(1, Math.floor((x.length - N) / HOP));
  const fps = sr / HOP;

  const win = new Float32Array(N).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)));
  const re = new Float32Array(N), im = new Float32Array(N);
  let prev = new Float32Array(N / 2), cur = new Float32Array(N / 2);
  const flux = new Float32Array(frames);
  const lowFlux = new Float32Array(frames);
  const rms = new Float32Array(frames);
  const chroma = new Float64Array(12);
  let centroidSum = 0, lowSum = 0, totalSum = 0;

  const binHz = sr / N;
  const lowBin = Math.ceil(150 / binHz);
  const pitchClass = new Int8Array(N / 2).map((_, b) => {
    const f = b * binHz;
    if (f < 60 || f > 2000) return -1;
    return ((Math.round(12 * Math.log2(f / 440)) % 12) + 12 + 9) % 12; // A=9
  });

  for (let f = 0; f < frames; f++) {
    const off = f * HOP;
    let e = 0;
    for (let i = 0; i < N; i++) {
      const v = x[off + i];
      e += v * v;
      re[i] = v * win[i];
      im[i] = 0;
    }
    rms[f] = Math.sqrt(e / N);
    fft(re, im);
    let fl = 0, lfl = 0, num = 0, den = 0;
    for (let b = 1; b < N / 2; b++) {
      const mag = Math.hypot(re[b], im[b]);
      const c = Math.log1p(10 * mag);
      cur[b] = c;
      const d = c - prev[b];
      if (d > 0) {
        fl += d;
        if (b < lowBin) lfl += d;
      }
      num += b * binHz * mag;
      den += mag;
      if (b < lowBin) lowSum += mag;
      totalSum += mag;
      const pc = pitchClass[b];
      if (pc >= 0) chroma[pc] += mag * mag;
    }
    flux[f] = fl;
    lowFlux[f] = lfl;
    if (den > 0) centroidSum += num / den;
    [prev, cur] = [cur, prev];
  }

  // Kicks live in a handful of bass bins, hats smear across hundreds, so give
  // the bass band equal say or the tracker locks onto the off-beat.
  const fluxScale = percentile(flux, 0.95) / (percentile(lowFlux, 0.95) || 1);
  for (let f = 0; f < frames; f++) flux[f] = 0.5 * flux[f] + 0.5 * lowFlux[f] * fluxScale;

  // Onset envelope: flux minus local mean, half-wave rectified, normalised.
  const onset = new Float32Array(frames);
  const half = Math.round(fps * 0.25);
  let acc = 0;
  for (let i = 0; i < Math.min(frames, 2 * half + 1); i++) acc += flux[i];
  for (let i = 0; i < frames; i++) {
    const lo = i - half - 1, hi = i + half;
    if (lo >= 0) acc -= flux[lo];
    if (hi < frames && i > half) acc += flux[hi];
    const mean = acc / (2 * half + 1);
    onset[i] = Math.max(0, flux[i] - mean);
  }
  const onsetMax = percentile(onset, 0.99) || 1;
  for (let i = 0; i < frames; i++) onset[i] = Math.min(1.5, onset[i] / onsetMax);

  // Tempo via autocorrelation with a log-Gaussian prior around 120 BPM.
  const minLag = Math.floor((60 / 190) * fps), maxLag = Math.ceil((60 / 60) * fps);
  const ac = new Float32Array(maxLag + 2);
  for (let lag = minLag; lag <= maxLag + 1; lag++) {
    let s = 0;
    for (let i = lag; i < frames; i++) s += onset[i] * onset[i - lag];
    ac[lag] = s / (frames - lag);
  }
  let bestLag = minLag, bestScore = -1;
  for (let lag = minLag; lag <= maxLag; lag++) {
    const bpm = (60 * fps) / lag;
    const prior = Math.exp(-0.5 * (Math.log2(bpm / 120) / 0.9) ** 2);
    const score = (ac[lag] + 0.5 * (ac[lag * 2] ?? 0)) * prior;
    if (score > bestScore) { bestScore = score; bestLag = lag; }
  }
  // parabolic refinement
  const a0 = ac[bestLag - 1] ?? 0, a1 = ac[bestLag], a2 = ac[bestLag + 1] ?? 0;
  const shift = (a0 - a2) / (2 * (a0 - 2 * a1 + a2) || 1);
  let period = bestLag + clamp(shift, -0.5, 0.5);
  let bpm = (60 * fps) / period;
  while (bpm < 80) { bpm *= 2; period /= 2; }
  while (bpm > 175) { bpm /= 2; period *= 2; }

  // Beat tracking: dynamic programming (Ellis 2007).
  const score = new Float32Array(frames);
  const back = new Int32Array(frames).fill(-1);
  const tightness = 6;
  for (let t = 0; t < frames; t++) {
    let best = 0, arg = -1;
    const from = Math.max(0, Math.round(t - 2 * period)), to = Math.round(t - period / 2);
    for (let p = from; p <= to; p++) {
      const v = score[p] - tightness * Math.log((t - p) / period) ** 2;
      if (v > best) { best = v; arg = p; }
    }
    score[t] = onset[t] + best;
    back[t] = arg;
  }
  let end = 0;
  for (let t = Math.max(0, frames - Math.round(period * 2)); t < frames; t++) if (score[t] > score[end]) end = t;
  const beatFrames: number[] = [];
  for (let t = end; t >= 0; t = back[t]) beatFrames.push(t);
  beatFrames.reverse();
  // Half-beat phase check: downbeats should carry more bass onsets than off-beats.
  const at = (f: number) => lowFlux[Math.max(0, Math.min(frames - 1, Math.round(f)))];
  let on = 0, off = 0;
  for (const f of beatFrames) { on += at(f); off += at(f + period / 2); }
  const phaseShift = off > on * 1.15 ? period / 2 : 0;
  let beats = beatFrames.map((f) => ((f + phaseShift) * HOP + N / 2) / sr).filter((t) => t < duration);
  // Extrapolate a steady grid over any silent intro/outro so choreography covers the whole song.
  const beatSec = 60 / bpm;
  if (beats.length < 8) beats = Array.from({ length: Math.floor(duration / beatSec) }, (_, i) => i * beatSec);
  while (beats[0] - beatSec > 0.2) beats.unshift(beats[0] - beatSec);
  while (beats[beats.length - 1] + beatSec < duration - 0.2) beats.push(beats[beats.length - 1] + beatSec);

  // Per-beat energy & drops
  const beatEnergyRaw = beats.map((b, i) => {
    const f0 = Math.floor((b * sr) / HOP), f1 = Math.max(f0 + 1, Math.floor(((beats[i + 1] ?? b + beatSec) * sr) / HOP));
    let s = 0, c = 0;
    for (let f = f0; f < Math.min(f1, frames); f++) { s += rms[f]; c++; }
    return c ? s / c : 0;
  });
  const eLo = percentile(beatEnergyRaw, 0.05), eHi = percentile(beatEnergyRaw, 0.97) || 1;
  const beatEnergy = beatEnergyRaw.map((v) => clamp((v - eLo) / (eHi - eLo || 1)));
  const drops: number[] = [];
  const W = 8;
  for (let i = W; i < beatEnergy.length - W; i++) {
    let before = 0, after = 0;
    for (let k = 1; k <= W; k++) { before += beatEnergy[i - k]; after += beatEnergy[i + k - 1]; }
    if (after / W - before / W > 0.28 && after / W > 0.6 && (!drops.length || i - drops[drops.length - 1] > 32)) drops.push(i);
  }

  // Key
  let bestKey = 0, bestScale: 'major' | 'minor' = 'major', bestCorr = -Infinity;
  for (let k = 0; k < 12; k++) {
    for (const [prof, scale] of [[MAJOR, 'major'], [MINOR, 'minor']] as const) {
      let c = 0;
      for (let i = 0; i < 12; i++) c += chroma[(i + k) % 12] * prof[i];
      if (c > bestCorr) { bestCorr = c; bestKey = k; bestScale = scale; }
    }
  }

  // High-level descriptors
  const meanRms = rms.reduce((a, b) => a + b, 0) / frames;
  const db = 20 * Math.log10(meanRms + 1e-9);
  const loudness = clamp((db + 32) / 22);
  const brightness = clamp(centroidSum / frames / 3500);
  const bass = clamp((lowSum / (totalSum || 1)) * 6);
  const onsetDensity = clamp(onset.reduce((a, b) => a + (b > 0.3 ? 1 : 0), 0) / frames / 0.25);
  const tempoNorm = clamp((bpm - 70) / 100);
  const pulse = clamp((ac[Math.round(period)] ?? 0) / ((ac[minLag] ?? 0) + 1e-9) / 2);
  const danceability = clamp(0.45 * pulse + 0.3 * (1 - Math.abs(bpm - 118) / 60) + 0.25 * bass);
  const energy = clamp(0.5 * loudness + 0.25 * onsetDensity + 0.25 * tempoNorm);
  const valence = clamp(0.45 * (bestScale === 'major' ? 0.8 : 0.3) + 0.3 * brightness + 0.25 * tempoNorm);

  const mood: Mood =
    energy >= 0.5 ? (valence >= 0.45 ? 'euphoric' : 'aggressive') : valence >= 0.45 ? 'dreamy' : 'melancholic';
  const genre = taggedGenre?.trim() || guessGenre({ bpm, energy, bass, brightness, danceability, onsetDensity });

  return {
    version: ANALYSIS_VERSION,
    duration,
    bpm: Math.round(bpm * 10) / 10,
    beatOffset: beats[0] ?? 0,
    beats,
    beatEnergy,
    drops,
    key: NOTE_NAMES[bestKey],
    scale: bestScale,
    energy,
    valence,
    danceability,
    brightness,
    genre,
    mood,
    theme: pickTheme(mood, genre, energy),
  };
}

function guessGenre(f: { bpm: number; energy: number; bass: number; brightness: number; danceability: number; onsetDensity: number }): string {
  const { bpm, energy, bass, brightness, danceability } = f;
  if (energy < 0.33) return bpm < 95 ? 'Ballad' : 'Acoustic / Chill';
  if (bpm >= 160 && energy > 0.6) return 'Drum & Bass';
  if (bpm >= 118 && bpm <= 132 && bass > 0.45 && danceability > 0.5) return 'House / EDM';
  if (bpm >= 132 && bpm < 160 && bass > 0.4) return 'Trance / Techno';
  if (bpm >= 75 && bpm <= 105 && bass > 0.5) return bpm > 92 ? 'Reggaeton / Latin' : 'Hip-Hop';
  if (brightness > 0.55 && energy > 0.65 && danceability < 0.5) return 'Rock';
  if (bpm >= 100 && bpm <= 125 && danceability > 0.55) return 'Dance Pop';
  return 'Pop';
}

function pickTheme(mood: Mood, genre: string, energy: number): Theme {
  const g = genre.toLowerCase();
  if (/metal|rock|punk|drum|dnb/.test(g) || (mood === 'aggressive' && energy > 0.7))
    return { name: 'Thunderdome', style: 'glitchStorm', palette: ['#ff2a2a', '#ffb000', '#ffffff', '#ff00aa'], background: ['#120000', '#000000'] };
  if (/house|edm|techno|trance|electro|dance/.test(g))
    return { name: 'Club Neon', style: 'neonBars', palette: ['#00f0ff', '#ff00e6', '#7cff00', '#ffffff'], background: ['#05001a', '#000008'] };
  if (/hip|rap|trap|r&b|reggaeton|latin/.test(g))
    return { name: 'Gold Chains', style: 'radialBurst', palette: ['#ffd23f', '#ff6b00', '#b100ff', '#ffffff'], background: ['#140a00', '#05000c'] };
  switch (mood) {
    case 'euphoric':
      return { name: 'Sugar Rush', style: 'radialBurst', palette: ['#ff4fd8', '#ffe74f', '#4fffd2', '#ffffff'], background: ['#2a0038', '#090014'] };
    case 'aggressive':
      return { name: 'Red Alert', style: 'glitchStorm', palette: ['#ff1744', '#ff9100', '#e0e0e0', '#d500f9'], background: ['#1a0004', '#000000'] };
    case 'dreamy':
      return { name: 'Aurora', style: 'liquidWaves', palette: ['#7df9ff', '#b388ff', '#69f0ae', '#ffffff'], background: ['#001a2a', '#05000f'] };
    default:
      return { name: 'Midnight', style: 'starfield', palette: ['#5c7cff', '#a0a0ff', '#00e5ff', '#ffffff'], background: ['#00051a', '#000000'] };
  }
}
