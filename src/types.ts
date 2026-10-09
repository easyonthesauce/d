export type Difficulty = 'easy' | 'medium' | 'hard' | 'extreme';
export const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard', 'extreme'];

export type Mood = 'euphoric' | 'aggressive' | 'dreamy' | 'melancholic';

export type VisualStyle = 'neonBars' | 'radialBurst' | 'liquidWaves' | 'glitchStorm' | 'starfield';

export interface Theme {
  name: string;
  style: VisualStyle;
  /** CSS colours, primary → accent */
  palette: [string, string, string, string];
  background: [string, string];
}

export interface SongAnalysis {
  version: number;
  duration: number;
  bpm: number;
  /** first beat offset in seconds */
  beatOffset: number;
  /** seconds of every beat */
  beats: number[];
  /** normalised 0..1 energy per beat */
  beatEnergy: number[];
  /** beat indexes where the track "drops" (big energy jump) */
  drops: number[];
  key: string;
  scale: 'major' | 'minor';
  /** 0..1 */
  energy: number;
  /** 0..1 – how "happy" the track sounds */
  valence: number;
  /** 0..1 */
  danceability: number;
  brightness: number;
  genre: string;
  mood: Mood;
  theme: Theme;
}

export interface Song {
  id: string;
  title: string;
  artist?: string;
  /** genre tag from file metadata, if present */
  taggedGenre?: string;
  source: { kind: 'folder'; file: string } | { kind: 'upload' };
  size: number;
  analysis?: SongAnalysis;
}

export interface Player {
  id: string;
  name: string;
  color: string;
  /** dataURL of their face crop */
  avatar: string;
  /** face identity signature (landmark geometry + image embedding) */
  faceGeometry: number[];
  faceEmbedding: number[];
  createdAt: number;
  stats: { rounds: number; totalScore: number; kcal: number; bestCombo: number };
}

export interface ScoreEntry {
  playerId: string;
  songId: string;
  difficulty: Difficulty;
  score: number;
  accuracy: number;
  maxCombo: number;
  kcal: number;
  stars: number;
  at: number;
}

export type Grade = 'PERFECT' | 'GREAT' | 'GOOD' | 'OK' | 'MISS';

export type Screen = 'boot' | 'lobby' | 'enroll' | 'songs' | 'countdown' | 'play' | 'paused' | 'results' | 'leaderboard';
