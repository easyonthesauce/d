import type { GameApi } from './api';

// Web Speech API isn't in lib.dom yet.
interface SpeechRecognitionLike extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
}

const Ctor: (new () => SpeechRecognitionLike) | undefined =
  (window as unknown as Record<string, new () => SpeechRecognitionLike>).SpeechRecognition ??
  (window as unknown as Record<string, new () => SpeechRecognitionLike>).webkitSpeechRecognition;

export const speechSupported = !!Ctor;

/**
 * Browser speech recognition used (a) as the whole voice UI when no ElevenLabs
 * agent is configured, and (b) as a "pause/stop" listener during songs while
 * the agent's mic is muted so it doesn't try to chat with the lyrics.
 */
export class SpeechCommands {
  private rec: SpeechRecognitionLike | null = null;
  private running = false;
  /** 'full' = whole command set, 'gameplay' = pause/stop only */
  mode: 'full' | 'gameplay' | 'off' = 'off';
  onHeard: (text: string) => void = () => {};
  onReply: (text: string) => void = () => {};

  constructor(private api: GameApi) {}

  setMode(mode: 'full' | 'gameplay' | 'off') {
    this.mode = mode;
    if (mode === 'off') this.stop();
    else this.start();
  }

  private start() {
    if (!Ctor || this.running) return;
    this.rec = new Ctor();
    this.rec.continuous = true;
    this.rec.interimResults = false;
    this.rec.lang = 'en-US';
    this.rec.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) void this.handle(e.results[i][0].transcript);
      }
    };
    this.rec.onend = () => {
      this.running = false;
      if (this.mode !== 'off') setTimeout(() => this.start(), 250); // Chrome stops after silence
    };
    this.rec.onerror = (e) => console.debug('speech', e.error);
    try {
      this.rec.start();
      this.running = true;
    } catch { /* already started */ }
  }

  private stop() {
    this.running = false;
    try { this.rec?.stop(); } catch { /* noop */ }
    this.rec = null;
  }

  private async handle(raw: string) {
    const t = raw.toLowerCase().trim();
    if (!t) return;
    const reply = await this.parse(t);
    if (reply) {
      this.onHeard(raw);
      this.onReply(reply);
    }
  }

  private async parse(t: string): Promise<string | null> {
    const a = this.api;
    const has = (...w: string[]) => w.some((x) => t.includes(x));
    if (this.mode === 'gameplay') {
      // strict phrases only – the mic is also hearing the song's lyrics
      if (/\b(pause|hold) (the )?(game|round|song|it)\b|\btime ?out\b/.test(t)) return a.pause_game();
      if (/\b(stop|quit|end|abort) (the )?(game|round|song)\b/.test(t)) return a.stop_game();
      return null;
    }
    if (has('pause', 'hold on')) return a.pause_game();
    if (has('stop game', 'quit', 'abort', 'end game')) return a.stop_game();

    if (has('resume', 'continue', 'unpause')) return a.resume_game();
    let m = t.match(/(?:enrol+|register|add)\s+(?:me|player)?\s*(?:as|called|named)?\s+([a-z][a-z' -]{0,20})$/);
    if (m) return a.enroll_player({ name: titleCase(m[1]) });
    if (has('who am i', 'recognise me', 'recognize me', 'scan my face', "it's me", 'my turn')) return a.identify_player();
    m = t.match(/(?:it'?s|player is|switch to)\s+([a-z][a-z' -]{0,20})'?s?\s*(?:turn)?$/);
    if (m) return a.set_current_player({ name: titleCase(m[1].replace(/ turn$/, '')) });
    if (has('next player', 'next person', "who's next", 'whos next')) return a.next_player();
    m = t.match(/\b(easy|medium|normal|hard|extreme|insane)\b/);
    if (m && has('difficulty', 'mode', 'level', 'make it', 'set')) return a.set_difficulty({ level: m[1] });
    m = t.match(/(?:play|choose|pick|select|song)\s+(.+)$/);
    if (m && !/^(again|the game)$/.test(m[1])) {
      if (/random|anything|surprise/.test(m[1])) return a.random_song({});
      return a.select_song({ query: m[1] });
    }
    if (has('start', "let's go", 'lets go', 'go go', "i'm ready", 'im ready', 'ready')) return a.start_game();
    if (has('leaderboard', 'high score', 'scores')) return a.show_leaderboard();
    if (has('rescan', 'scan music', 'new songs', 'refresh music')) return a.rescan_music();
    if (has('list songs', 'what songs', 'song list')) return a.list_songs();
    if (has('who is playing', 'players', 'list players')) return a.list_players();
    if (has('home', 'lobby', 'menu', 'back')) return a.show_lobby();
    m = t.match(/volume\s+(\d+)/);
    if (m) return a.set_volume({ level: Number(m[1]) });
    return null;
  }
}

const titleCase = (s: string) => s.trim().replace(/\b\w/g, (c) => c.toUpperCase());

/** Local TTS for the offline fallback. */
export function speak(text: string, onStart?: () => void, onEnd?: () => void) {
  if (!('speechSynthesis' in window)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 1.08;
  u.pitch = 1.05;
  u.onstart = () => onStart?.();
  u.onend = () => onEnd?.();
  speechSynthesis.speak(u);
}
