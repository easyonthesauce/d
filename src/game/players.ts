import { db } from '../db';
import type { Player, ScoreEntry } from '../types';
import { cosine, geometrySimilarity, type Vision } from '../vision/vision';

const COLORS = ['#ff2bd6', '#00e5ff', '#ffe600', '#7cff00', '#ff7a00', '#b388ff', '#ff4060', '#00ffa3'];

/** Match confidence needed before we'll greet someone by name. */
const MATCH_THRESHOLD = 0.72;
const MATCH_MARGIN = 0.03;

export class Players {
  list: Player[] = [];
  scores: ScoreEntry[] = [];
  currentId: string | null = null;

  async load() {
    this.list = (await db.all<Player>('players')).sort((a, b) => a.createdAt - b.createdAt);
    this.scores = await db.all<ScoreEntry>('scores');
    this.currentId = (await db.get<string>('kv', 'currentPlayer')) ?? this.list[0]?.id ?? null;
  }

  get current(): Player | undefined {
    return this.list.find((p) => p.id === this.currentId);
  }

  setCurrent(p: Player | undefined) {
    this.currentId = p?.id ?? null;
    void db.put('kv', 'currentPlayer', this.currentId);
  }

  byName(name: string): Player | undefined {
    const n = name.toLowerCase().trim();
    return this.list.find((p) => p.name.toLowerCase() === n) ?? this.list.find((p) => p.name.toLowerCase().startsWith(n) || n.startsWith(p.name.toLowerCase()));
  }

  /** Captures several frames and averages them into a sturdier signature. */
  async enroll(name: string, vision: Vision, onProgress: (n: number) => void): Promise<Player> {
    const samples: NonNullable<ReturnType<Vision['captureFace']>>[] = [];
    const deadline = performance.now() + 8000;
    while (samples.length < 6 && performance.now() < deadline) {
      await new Promise((r) => setTimeout(r, 250));
      const s = vision.captureFace(performance.now());
      if (s) {
        samples.push(s);
        onProgress(samples.length / 6);
      }
    }
    if (samples.length < 3) throw new Error("I couldn't see a face. Step closer and look at the screen.");
    const avg = (vs: number[][]) => vs[0].map((_, i) => vs.reduce((s, v) => s + v[i], 0) / vs.length);
    const existing = this.byName(name);
    const player: Player = {
      id: existing?.id ?? crypto.randomUUID(),
      name,
      color: existing?.color ?? COLORS[this.list.length % COLORS.length],
      avatar: samples[Math.floor(samples.length / 2)].avatar,
      faceGeometry: avg(samples.map((s) => s.geometry)),
      faceEmbedding: avg(samples.map((s) => s.embedding)),
      createdAt: existing?.createdAt ?? Date.now(),
      stats: existing?.stats ?? { rounds: 0, totalScore: 0, kcal: 0, bestCombo: 0 },
    };
    await db.put('players', player.id, player);
    this.list = [...this.list.filter((p) => p.id !== player.id), player];
    this.setCurrent(player);
    return player;
  }

  /** Who is that? Returns the best match above threshold, if any. */
  identify(vision: Vision): { player: Player; confidence: number } | null {
    const face = vision.captureFace(performance.now());
    if (!face || !this.list.length) return null;
    const ranked = this.list
      .map((p) => ({ player: p, confidence: 0.55 * cosine(face.embedding, p.faceEmbedding) + 0.45 * geometrySimilarity(face.geometry, p.faceGeometry) }))
      .sort((a, b) => b.confidence - a.confidence);
    const [best, second] = ranked;
    if (best.confidence < MATCH_THRESHOLD) return null;
    if (second && best.confidence - second.confidence < MATCH_MARGIN) return null;
    return best;
  }

  async remove(p: Player) {
    this.list = this.list.filter((x) => x.id !== p.id);
    await db.del('players', p.id);
    if (this.currentId === p.id) this.setCurrent(this.list[0]);
  }

  next(): Player | undefined {
    if (!this.list.length) return undefined;
    const i = this.list.findIndex((p) => p.id === this.currentId);
    const p = this.list[(i + 1) % this.list.length];
    this.setCurrent(p);
    return p;
  }

  async recordScore(e: ScoreEntry) {
    this.scores.push(e);
    const p = this.list.find((x) => x.id === e.playerId);
    if (p) {
      p.stats.rounds++;
      p.stats.totalScore += e.score;
      p.stats.kcal += e.kcal;
      p.stats.bestCombo = Math.max(p.stats.bestCombo, e.maxCombo);
    }
    await db.put('scores', `${e.at}:${e.playerId}`, e);
    if (p) await db.put('players', p.id, p);
  }

  best(playerId: string, songId?: string): ScoreEntry | undefined {
    return this.scores
      .filter((s) => s.playerId === playerId && (!songId || s.songId === songId))
      .sort((a, b) => b.score - a.score)[0];
  }

  leaderboard(): { player: Player; best: number; total: number; kcal: number; rounds: number }[] {
    return this.list
      .map((p) => ({ player: p, best: this.best(p.id)?.score ?? 0, total: p.stats.totalScore, kcal: p.stats.kcal, rounds: p.stats.rounds }))
      .sort((a, b) => b.total - a.total);
  }
}
