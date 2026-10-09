import type { AudioEngine } from '../audio/player';
import type { Library } from '../audio/library';
import type { Effects } from '../render/effects';
import { camCenter, L } from '../render/layout';
import type { Visualizer } from '../render/visualizer';
import { DIFFICULTIES, type Difficulty, type Grade, type Screen, type Song, type SongAnalysis } from '../types';
import type { Vision } from '../vision/vision';
import type { GameApi } from '../voice/api';
import { choreograph, PROFILES, type Step } from './choreo';
import type { Players } from './players';
import { BurnMeter, GRADE_POINTS, gradeFor, poseSimilarity } from './scoring';

export interface Round {
  song: Song;
  analysis: SongAnalysis;
  difficulty: Difficulty;
  steps: Step[];
  /** index of the next step still to be judged */
  idx: number;
  best: number[];
  gestureHit: boolean[];
  grades: Grade[];
  score: number;
  combo: number;
  maxCombo: number;
  missStreak: number;
  level: number;
  burn: BurnMeter;
  beatIdx: number;
  /** live similarity of the current/next move – drives the skeleton glow */
  liveSim: number;
  lastGrade: { grade: Grade; at: number } | null;
  halfwayAnnounced: boolean;
  finalAnnounced: boolean;
  lastStatsAt: number;
}

export interface GameHooks {
  /** a game moment the host should react to out loud */
  event(text: string, opts?: { force?: boolean; minGapMs?: number }): void;
  /** quiet context for the host */
  context(text: string): void;
  /** local fallback commentary when no agent is connected */
  onScreen(screen: Screen): void;
  onEnrollProgress(p: number): void;
  setListening(mode: 'conversation' | 'gameplay'): void;
}

const GRADE_COLORS: Record<Grade, string> = {
  PERFECT: '#ffe600', GREAT: '#00ffa3', GOOD: '#00e5ff', OK: '#b388ff', MISS: '#ff3355',
};

export class Game implements GameApi {
  screen: Screen = 'boot';
  difficulty: Difficulty = 'medium';
  song: Song | null = null;
  round: Round | null = null;
  lastRound: (Round & { stars: number; accuracy: number; kcal: number; newBest: boolean }) | null = null;
  countdown = 0;
  private countdownEnd = 0;
  enrollName = '';
  private identifyTimer = 0;
  private previewing = false;

  constructor(
    private audio: AudioEngine,
    private library: Library,
    private vision: Vision,
    readonly players: Players,
    private fx: Effects,
    private viz: Visualizer,
    private hooks: GameHooks,
  ) {}

  go(screen: Screen) {
    this.screen = screen;
    this.hooks.onScreen(screen);
  }

  get gradeColors() {
    return GRADE_COLORS;
  }

  // ================= GameApi (voice) =================

  get_game_state(): string {
    const p = this.players.current;
    const r = this.lastRound;
    return JSON.stringify({
      screen: this.screen,
      currentPlayer: p?.name ?? null,
      players: this.players.list.map((x) => x.name),
      selectedSong: this.song ? this.library.describe(this.song) : null,
      difficulty: this.difficulty,
      songsInLibrary: this.library.songs.length,
      round: this.round ? { score: this.round.score, combo: this.round.combo, speedLevel: this.round.level + 1 } : null,
      lastRound: r ? { player: this.players.list.find((x) => x.id === this.players.currentId)?.name, song: r.song.title, score: r.score, stars: r.stars, accuracy: Math.round(r.accuracy * 100) + '%', maxCombo: r.maxCombo, kcal: Math.round(r.kcal) } : null,
    });
  }

  list_songs(): string {
    if (!this.library.songs.length) return 'The library is empty. Tell them to drop audio files into the music folder or onto the screen, then say "rescan my music".';
    return this.library.songs.slice(0, 40).map((s) => this.library.describe(s)).join('; ');
  }

  async select_song({ query }: { query: string }): Promise<string> {
    const s = this.library.find(query ?? '');
    if (!s) return `No song matches "${query}". Available: ${this.list_songs()}`;
    return this.pickSong(s);
  }

  async random_song({ mood }: { mood?: string } = {}): Promise<string> {
    let pool = this.library.songs;
    if (mood) {
      const m = pool.filter((s) => s.analysis?.mood === mood.toLowerCase() || s.analysis?.genre.toLowerCase().includes(mood.toLowerCase()));
      if (m.length) pool = m;
    }
    if (!pool.length) return 'No songs in the library yet.';
    return this.pickSong(pool[Math.floor(Math.random() * pool.length)]);
  }

  private async pickSong(s: Song): Promise<string> {
    this.song = s;
    if (this.screen !== 'play' && this.screen !== 'countdown') this.go('songs');
    const a = await this.library.analyse(s);
    this.viz.setTheme(a.theme);
    void this.preview();
    return `Selected ${this.library.describe(s)}. Visual theme: ${a.theme.name}. Difficulty is ${this.difficulty}.`;
  }

  set_difficulty({ level }: { level: string }): string {
    const map: Record<string, Difficulty> = { normal: 'medium', insane: 'extreme', expert: 'extreme', beginner: 'easy' };
    const d = (map[level?.toLowerCase()] ?? level?.toLowerCase()) as Difficulty;
    if (!DIFFICULTIES.includes(d)) return `Unknown difficulty "${level}". Options: ${DIFFICULTIES.join(', ')}.`;
    this.difficulty = d;
    const p = PROFILES[d];
    return `Difficulty set to ${p.label}: moves as fast as every ${Math.min(...p.intervals)} beat(s), ${p.gestures ? 'with' : 'without'} hand-gesture bonuses.`;
  }

  async enroll_player({ name }: { name: string }): Promise<string> {
    if (!name?.trim()) return 'I need a name to enroll.';
    this.stopPreview();
    this.enrollName = name.trim();
    this.go('enroll');
    try {
      const p = await this.players.enroll(this.enrollName, this.vision, (n) => this.hooks.onEnrollProgress(n));
      this.fx.burst(L.W / 2, L.H * 0.4, [p.color, '#fff'], 80);
      this.audio.sfxLevelUp();
      this.go('lobby');
      return `Enrolled ${p.name}. They are now the current player. ${this.players.list.length} players enrolled.`;
    } catch (e) {
      this.go('lobby');
      return (e as Error).message;
    }
  }

  async identify_player(): Promise<string> {
    for (let i = 0; i < 6; i++) {
      const m = this.players.identify(this.vision);
      if (m) {
        this.players.setCurrent(m.player);
        return `Recognised ${m.player.name} (confidence ${Math.round(m.confidence * 100)}%). They are the current player.`;
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    return this.players.list.length
      ? `I can't confidently recognise who is in front of the camera. Ask their name and either set_current_player or enroll_player. Known players: ${this.players.list.map((p) => p.name).join(', ')}.`
      : 'Nobody is enrolled yet. Ask for their name and call enroll_player.';
  }

  set_current_player({ name }: { name: string }): string {
    const p = this.players.byName(name ?? '');
    if (!p) return `No player called ${name}. Enrolled: ${this.players.list.map((x) => x.name).join(', ') || 'nobody'}.`;
    this.players.setCurrent(p);
    return `${p.name} is up.`;
  }

  next_player(): string {
    const p = this.players.next();
    if (this.screen === 'results' || this.screen === 'leaderboard') this.go('lobby');
    return p ? `It's ${p.name}'s turn. Their total so far: ${p.stats.totalScore} points over ${p.stats.rounds} rounds.` : 'No players enrolled.';
  }

  list_players(): string {
    if (!this.players.list.length) return 'No players enrolled yet.';
    return this.players.leaderboard().map((r, i) => `${i + 1}. ${r.player.name}: ${r.total} pts total, best ${r.best}, ${r.rounds} rounds, ${Math.round(r.kcal)} kcal`).join('; ');
  }

  remove_player({ name }: { name: string }): string {
    const p = this.players.byName(name ?? '');
    if (!p) return `No player called ${name}.`;
    void this.players.remove(p);
    return `Removed ${p.name}.`;
  }

  async start_game(): Promise<string> {
    if (this.screen === 'play' || this.screen === 'countdown') return 'A round is already running.';
    if (this.screen === 'paused') return this.resume_game();
    if (!this.song) {
      if (!this.library.songs.length) return 'No songs in the library. Add music first.';
      return 'No song selected yet. Ask the player which song (or call random_song).';
    }
    if (!this.players.current) return 'Nobody is enrolled. Ask for a name and call enroll_player first.';
    const analysis = await this.library.analyse(this.song);
    const buf = await this.library.decode(this.song);
    this.stopPreview();
    await this.audio.resume();
    this.audio.load(buf);
    const steps = choreograph(analysis, this.difficulty, this.song.id);
    this.round = {
      song: this.song, analysis, difficulty: this.difficulty, steps, idx: 0,
      best: steps.map(() => 0), gestureHit: steps.map(() => false), grades: [],
      score: 0, combo: 0, maxCombo: 0, missStreak: 0, level: 0,
      burn: new BurnMeter(), beatIdx: 0, liveSim: 0, lastGrade: null,
      halfwayAnnounced: false, finalAnnounced: false, lastStatsAt: 0,
    };
    this.viz.setTheme(analysis.theme);
    this.vision.wantGestures = PROFILES[this.difficulty].gestures;
    this.countdownEnd = performance.now() + 3999;
    this.countdown = 3.999;
    this.go('countdown');
    this.hooks.setListening('gameplay');
    return `Countdown started for ${this.players.current.name} on ${this.song.title} (${PROFILES[this.difficulty].label}). Fire them up in a few words – the music starts in 3 seconds.`;
  }

  pause_game(): string {
    if (this.screen !== 'play' && this.screen !== 'countdown') return 'Nothing to pause.';
    this.audio.pause();
    this.go('paused');
    this.hooks.setListening('conversation');
    return 'Paused. Say "resume" to continue or "stop" to quit.';
  }

  resume_game(): string {
    if (this.screen !== 'paused' || !this.round) return 'Nothing is paused.';
    this.audio.play();
    this.go('play');
    this.hooks.setListening('gameplay');
    return 'Resumed.';
  }

  stop_game(): string {
    if (!this.round) {
      this.go('lobby');
      return 'Back in the lobby.';
    }
    this.audio.stop();
    this.round = null;
    this.vision.wantGestures = false;
    this.hooks.setListening('conversation');
    this.go('lobby');
    return 'Round abandoned. Back to the lobby.';
  }

  show_leaderboard(): string {
    if (this.screen === 'play' || this.screen === 'countdown') return 'Not during a round.';
    this.go('leaderboard');
    return this.list_players();
  }

  show_lobby(): string {
    if (this.screen === 'play' || this.screen === 'countdown') return 'Not during a round – pause or stop first.';
    this.go('lobby');
    return 'Lobby.';
  }

  async rescan_music(): Promise<string> {
    const added = await this.library.rescan();
    return `${added} new song(s) found. ${this.library.songs.length} in the library. New songs are being analysed for genre, tempo and mood.`;
  }

  set_volume({ level }: { level: number }): string {
    const v = Math.max(0, Math.min(10, Number(level) || 0));
    this.audio.setVolume(v / 10);
    return `Volume ${v}/10.`;
  }

  // ================= song preview =================

  private async preview() {
    if (!this.song?.analysis || this.inRound()) return;
    const song = this.song;
    const buf = await this.library.decode(song);
    if (this.song !== song || this.inRound()) return;
    await this.audio.resume();
    this.audio.load(buf);
    const a = song.analysis!;
    const drop = a.drops[0] != null ? a.beats[a.drops[0]] : a.duration * 0.3;
    this.audio.setVolume(this.audio.volume);
    this.audio.play(Math.max(0, drop - 2));
    this.previewing = true;
  }

  private inRound() {
    return this.screen === 'play' || this.screen === 'countdown' || this.screen === 'paused';
  }

  private stopPreview() {
    if (this.previewing) this.audio.stop();
    this.previewing = false;
  }

  // ================= frame loop =================

  update(dt: number, now: number) {
    // Lobby: quietly figure out who just walked up.
    if (this.screen === 'lobby' && this.players.list.length) {
      this.identifyTimer -= dt;
      if (this.identifyTimer <= 0) {
        this.identifyTimer = 2;
        const m = this.players.identify(this.vision);
        if (m && m.player.id !== this.players.currentId) {
          this.players.setCurrent(m.player);
          this.hooks.event(`${m.player.name} just stepped up to the camera (face recognised). Greet them by name and ask what song they want.`, { minGapMs: 4000 });
        }
      }
    }

    if (this.screen === 'countdown') {
      // wall-clock, so a slow frame can't stretch the countdown
      const before = Math.ceil(this.countdown);
      this.countdown = Math.max(0, (this.countdownEnd - now) / 1000);
      const after = Math.ceil(this.countdown);
      if (after !== before) {
        this.audio.sfxCount(after === 0);
        if (after === 0) {
          this.fx.announce('GO!', '#ffe600');
          this.fx.strobe = 0.3;
          this.audio.play(0);
          this.go('play');
        }
      }
    }

    if (this.screen === 'play' && this.round) this.updateRound(now);
  }

  private updateRound(now: number) {
    const r = this.round!;
    const t = this.audio.time;
    const prof = PROFILES[r.difficulty];
    const lm = this.vision.latest.landmarks;
    const aspect = this.vision.video.videoWidth / (this.vision.video.videoHeight || 1) || 16 / 9;
    r.burn.update(lm, now);

    // beat-synced effects
    while (r.beatIdx < r.analysis.beats.length && r.analysis.beats[r.beatIdx] <= t) {
      const e = r.analysis.beatEnergy[r.beatIdx] ?? 0.5;
      this.viz.beat(0.4 + e * 0.6);
      if (r.analysis.drops.includes(r.beatIdx)) {
        this.viz.hype = 1;
        this.fx.strobe = 0.6;
        this.fx.shake = 40;
        this.fx.confettiRain(L.W, r.analysis.theme.palette);
        this.fx.announce('DROP!', r.analysis.theme.palette[1]);
        this.hooks.event('The beat just dropped! Scream something hype, max 5 words.', { minGapMs: 5000 });
      }
      if (r.beatIdx % 4 === 0 && e > 0.75) this.fx.shake = Math.max(this.fx.shake, 10 * e);
      r.beatIdx++;
    }

    // judge steps
    const win = prof.window / 1000;
    for (let k = r.idx; k < r.steps.length; k++) {
      const s = r.steps[k];
      if (t < s.time - win) break;
      if (t <= s.time + win * 0.6 && lm) {
        const sim = poseSimilarity(lm, s.move, aspect);
        r.best[k] = Math.max(r.best[k], sim);
        const g = this.vision.latestGesture;
        if (s.move.gesture && g && g.name === s.move.gesture && now - g.t < 400) r.gestureHit[k] = true;
      }
    }
    const nxt = r.steps[r.idx];
    if (nxt && lm) r.liveSim += (poseSimilarity(lm, nxt.move, aspect) - r.liveSim) * 0.3;

    while (r.idx < r.steps.length && t > r.steps[r.idx].time + win * 0.6) {
      this.finishStep(r, r.idx, prof.thresholds);
      r.idx++;
    }

    // speed level changes → "it gets faster"
    const cur = r.steps[r.idx];
    if (cur && cur.level > r.level) {
      r.level = cur.level;
      this.fx.announce(['', 'SPEED UP!', 'FASTER!!', 'MAX SPEED!!!'][r.level] ?? 'FASTER!', r.analysis.theme.palette[2]);
      this.audio.sfxLevelUp();
      this.audio.sfxWhoosh();
      this.hooks.event(`Speed level ${r.level + 1} of 4 – the moves just got faster. Warn ${this.players.current?.name} in a few words.`, { minGapMs: 6000 });
    }

    const prog = t / r.analysis.duration;
    if (!r.halfwayAnnounced && prog > 0.5) {
      r.halfwayAnnounced = true;
      this.hooks.event(`Halfway. ${this.statsLine(r)}. One short line: taunt or hype depending on how they're doing.`);
    }
    if (!r.finalAnnounced && r.analysis.duration - t < 20) {
      r.finalAnnounced = true;
      this.hooks.event(`20 seconds left! ${this.statsLine(r)}. Push them for the final stretch in a few words.`, { minGapMs: 4000 });
    }
    if (now - r.lastStatsAt > 10000) {
      r.lastStatsAt = now;
      this.hooks.context(`Live stats: ${this.statsLine(r)}.`);
    }

    if (!this.audio.playing && t >= r.analysis.duration - 0.5) this.finishRound();
  }

  private statsLine(r: Round) {
    const judged = r.grades.length || 1;
    const hits = r.grades.filter((g) => g === 'PERFECT' || g === 'GREAT').length;
    return `${this.players.current?.name}: score ${r.score}, combo ${r.combo}, ${Math.round((hits / judged) * 100)}% great-or-better, ${r.grades.filter((g) => g === 'MISS').length} misses, ${Math.round(r.burn.kcal)} kcal`;
  }

  private finishStep(r: Round, k: number, th: [number, number, number, number]) {
    const s = r.steps[k];
    let sim = r.best[k];
    if (s.move.gesture && r.gestureHit[k]) sim = Math.min(1, sim + 0.08);
    const grade = gradeFor(sim, th);
    r.grades.push(grade);
    const mult = 1 + Math.min(3, Math.floor(r.combo / 10));
    r.score += Math.round(GRADE_POINTS[grade] * mult * (s.drop ? 2 : 1) * (r.gestureHit[k] ? 1.25 : 1));

    const { x: cx, y: panelY } = camCenter();
    const color = GRADE_COLORS[grade];
    this.audio.sfxGrade(grade);
    this.fx.popup(grade, cx, panelY - L.cam.h * 0.3, color, grade === 'PERFECT' ? 110 : 90, 'grade');
    if (grade === 'MISS') {
      r.combo = 0;
      r.missStreak++;
      this.fx.shake = Math.max(this.fx.shake, 18);
      if (r.missStreak === 3 || r.missStreak === 6) {
        this.hooks.event(`${this.players.current?.name} just missed ${r.missStreak} moves in a row (move was "${s.move.name}"). Roast them – one savage, playful line.`);
      }
    } else {
      r.missStreak = 0;
      if (grade !== 'OK') r.combo++;
      r.maxCombo = Math.max(r.maxCombo, r.combo);
      if (grade === 'PERFECT') {
        this.fx.burst(cx, panelY, [color, r.analysis.theme.palette[0], '#fff'], 50);
        this.fx.ring(cx, panelY, color);
        this.viz.beat(1);
      } else if (grade === 'GREAT') {
        this.fx.burst(cx, panelY, [color, '#fff'], 25, 600);
      }
      if (r.gestureHit[k]) this.fx.popup(`${s.move.gesture!.replace('_', ' ')} BONUS`, cx, panelY - L.cam.h * 0.45, '#fff', 50);
      if ([10, 25, 50, 100].includes(r.combo)) {
        this.fx.announce(`${r.combo} COMBO!`, r.analysis.theme.palette[0]);
        this.fx.confettiRain(L.W, r.analysis.theme.palette, 60);
        this.hooks.event(`${this.players.current?.name} hit a ${r.combo}-move combo! Hype them up, one line.`);
      }
    }
    r.lastGrade = { grade, at: performance.now() };
  }

  private finishRound() {
    const r = this.round!;
    while (r.idx < r.steps.length) this.finishStep(r, r.idx++, PROFILES[r.difficulty].thresholds);
    const accuracy = r.grades.reduce((s, g) => s + GRADE_POINTS[g], 0) / (r.grades.length * GRADE_POINTS.PERFECT || 1);
    const stars = Math.max(0, Math.min(5, Math.floor(accuracy * 5 + 0.15)));
    const player = this.players.current!;
    const prevBest = this.players.best(player.id, r.song.id)?.score ?? 0;
    const kcal = r.burn.kcal;
    void this.players.recordScore({
      playerId: player.id, songId: r.song.id, difficulty: r.difficulty, score: r.score,
      accuracy, maxCombo: r.maxCombo, kcal, stars, at: Date.now(),
    });
    this.lastRound = { ...r, stars, accuracy, kcal, newBest: r.score > prevBest };
    this.round = null;
    this.vision.wantGestures = false;
    this.fx.confettiRain(L.W, r.analysis.theme.palette, 200);
    this.go('results');
    this.hooks.setListening('conversation');
    const board = this.players.leaderboard().map((x) => `${x.player.name} ${x.total}`).join(', ');
    this.hooks.event(
      `Round over. ${player.name} scored ${r.score} on "${r.song.title}" (${r.difficulty}): ${stars}/5 stars, ` +
        `${Math.round(accuracy * 100)}% accuracy, best combo ${r.maxCombo}, ~${Math.round(kcal)} kcal burned` +
        `${r.score > prevBest ? ', a new personal best' : ''}. Leaderboard totals: ${board}. ` +
        `React (roast if bad, crown them if great), then ask who's next.`,
      { force: true },
    );
  }
}
