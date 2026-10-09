/** Song playback with a live analyser, ducking for the voice agent, and synth SFX. */
export class AudioEngine {
  readonly ctx = new AudioContext({ latencyHint: 'interactive' });
  readonly analyser = this.ctx.createAnalyser();
  private master = this.ctx.createGain();
  private music = this.ctx.createGain();
  private sfx = this.ctx.createGain();
  private src: AudioBufferSourceNode | null = null;
  private buffer: AudioBuffer | null = null;
  private startedAt = 0;
  private pausedAt = 0;
  playing = false;
  onEnded: () => void = () => {};

  readonly freq = new Uint8Array(1024);
  readonly wave = new Uint8Array(2048);
  /** smoothed 0..1 levels */
  bass = 0;
  mid = 0;
  treble = 0;
  level = 0;
  /** true on the frame a kick/transient is detected */
  kick = false;
  private bassHist: number[] = [];
  private lastKick = 0;
  private userVolume = 0.9;
  private ducked = false;

  constructor() {
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.72;
    this.music.connect(this.analyser);
    this.analyser.connect(this.master);
    this.sfx.connect(this.master);
    this.sfx.gain.value = 0.5;
    this.master.connect(this.ctx.destination);
    this.music.gain.value = this.userVolume;
  }

  async resume() {
    if (this.ctx.state !== 'running') await this.ctx.resume();
  }

  load(buf: AudioBuffer) {
    this.stop();
    this.buffer = buf;
    this.pausedAt = 0;
  }

  get duration() {
    return this.buffer?.duration ?? 0;
  }

  /** Song position in seconds (compensates for output latency so visuals land on the beat). */
  get time(): number {
    if (!this.playing) return this.pausedAt;
    return this.ctx.currentTime - this.startedAt - (this.ctx.outputLatency || 0);
  }

  play(at = this.pausedAt) {
    if (!this.buffer) return;
    this.src?.disconnect();
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffer;
    src.connect(this.music);
    src.onended = () => {
      if (this.src === src && this.playing) {
        this.playing = false;
        this.pausedAt = this.buffer?.duration ?? 0;
        this.onEnded();
      }
    };
    src.start(0, at);
    this.src = src;
    this.startedAt = this.ctx.currentTime - at;
    this.playing = true;
  }

  pause() {
    if (!this.playing) return;
    this.pausedAt = this.ctx.currentTime - this.startedAt;
    this.playing = false;
    this.src?.stop();
  }

  stop() {
    this.playing = false;
    try { this.src?.stop(); } catch { /* already stopped */ }
    this.src = null;
    this.pausedAt = 0;
  }

  setVolume(v: number) {
    this.userVolume = Math.max(0, Math.min(1, v));
    this.applyGain();
  }

  get volume() {
    return this.userVolume;
  }

  /** Lower the music while the hype agent is talking. */
  duck(on: boolean) {
    this.ducked = on;
    this.applyGain();
  }

  private applyGain() {
    const target = this.userVolume * (this.ducked ? 0.35 : 1);
    this.music.gain.setTargetAtTime(target, this.ctx.currentTime, 0.12);
  }

  /** Call once per animation frame. */
  update() {
    this.analyser.getByteFrequencyData(this.freq);
    this.analyser.getByteTimeDomainData(this.wave);
    if (!this.playing) this.idleShimmer();
    const band = (lo: number, hi: number) => {
      const hz = this.ctx.sampleRate / this.analyser.fftSize;
      const a = Math.floor(lo / hz), b = Math.max(a + 1, Math.floor(hi / hz));
      let s = 0;
      for (let i = a; i < b; i++) s += this.freq[i];
      return s / (b - a) / 255;
    };
    const b = band(30, 150), m = band(400, 2500), t = band(5000, 14000);
    this.bass += (b - this.bass) * 0.5;
    this.mid += (m - this.mid) * 0.35;
    this.treble += (t - this.treble) * 0.35;
    this.level = (this.bass + this.mid + this.treble) / 3;

    this.bassHist.push(b);
    if (this.bassHist.length > 43) this.bassHist.shift();
    const avg = this.bassHist.reduce((x, y) => x + y, 0) / this.bassHist.length;
    const now = performance.now();
    this.kick = this.playing && b > avg * 1.18 && b > 0.35 && now - this.lastKick > 180;
    if (this.kick) this.lastKick = now;
  }

  /** Silence would leave the visualizer dead; give it a slow 100 BPM heartbeat. */
  private idleShimmer() {
    const t = performance.now() / 1000;
    const beat = Math.pow(Math.max(0, Math.sin(t * Math.PI * (100 / 60))), 8);
    for (let i = 0; i < this.freq.length; i++) {
      const v = 60 + 40 * Math.sin(i * 0.15 + t * 2) + 50 * beat * Math.exp(-i / 60);
      this.freq[i] = Math.max(this.freq[i], v * Math.exp(-i / 400));
    }
    for (let i = 0; i < this.wave.length; i++) this.wave[i] = 128 + 30 * Math.sin(i * 0.02 + t * 3);
  }

  // ---------- synth SFX ----------
  private tone(freq: number, dur: number, type: OscillatorType = 'sine', vol = 0.4, slideTo?: number, delay = 0) {
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.sfx);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  sfxGrade(grade: string) {
    if (grade === 'PERFECT') { this.tone(880, 0.15, 'triangle', 0.35); this.tone(1320, 0.25, 'triangle', 0.3, undefined, 0.06); }
    else if (grade === 'GREAT') this.tone(740, 0.18, 'triangle', 0.3);
    else if (grade === 'GOOD') this.tone(560, 0.15, 'sine', 0.25);
    else if (grade === 'MISS') this.tone(180, 0.25, 'sawtooth', 0.12, 90);
  }

  sfxCount(final = false) {
    this.tone(final ? 1046 : 523, final ? 0.5 : 0.18, 'square', 0.2);
  }

  sfxWhoosh() {
    const t = this.ctx.currentTime;
    const len = this.ctx.sampleRate * 0.6;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.setValueAtTime(300, t);
    f.frequency.exponentialRampToValueAtTime(6000, t + 0.5);
    const g = this.ctx.createGain();
    g.gain.value = 0.35;
    src.connect(f).connect(g).connect(this.sfx);
    src.start(t);
  }

  sfxLevelUp() {
    [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.2, 'square', 0.15, undefined, i * 0.07));
  }
}
