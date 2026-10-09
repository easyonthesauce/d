import './style.css';
import { Library } from './audio/library';
import { AudioEngine } from './audio/player';
import { Game } from './game/game';
import { Players } from './game/players';
import { Effects } from './render/effects';
import { L } from './render/layout';
import { Renderer } from './render/renderer';
import { Visualizer } from './render/visualizer';
import { UI } from './ui/ui';
import { Vision } from './vision/vision';
import { HypeAgent } from './voice/agent';
import { LocalHost } from './voice/localHost';
import { SpeechCommands, speechSupported } from './voice/speech';

const stage = document.getElementById('stage')!;
const canvas = document.getElementById('c') as HTMLCanvasElement;
const uiRoot = document.getElementById('ui')!;
const captionEl = document.getElementById('caption')!;
const orb = document.getElementById('orb')!;

stage.classList.toggle('landscape', !L.portrait);
canvas.width = L.W;
canvas.height = L.H;
stage.style.width = `${L.W}px`;
stage.style.height = `${L.H}px`;
const fit = () => {
  const s = Math.min(innerWidth / L.W, innerHeight / L.H);
  stage.style.transform = `translate(-50%, -50%) scale(${s})`;
};
addEventListener('resize', fit);
fit();

const g = canvas.getContext('2d')!;
const audio = new AudioEngine();
const library = new Library();
const vision = new Vision();
const players = new Players();
const fx = new Effects();
const viz = new Visualizer();

let captionTimer = 0;
function caption(who: 'agent' | 'player', text: string) {
  captionEl.innerHTML = `<span class="${who}">${who === 'agent' ? '🔥' : '🎙️'}</span> ${text.replace(/</g, '&lt;')}`;
  captionEl.classList.add('show');
  clearTimeout(captionTimer);
  captionTimer = window.setTimeout(() => captionEl.classList.remove('show'), 6000);
}
function speaking(on: boolean) {
  orb.classList.toggle('speaking', on);
  audio.duck(on);
}

const localHost = new LocalHost(speaking, (t) => caption('agent', t));
// `agent`, `speech` and `ui` are declared below; the hooks only run after boot.
const game: Game = new Game(audio, library, vision, players, fx, viz, {
  event: (text, opts) => (agent.connected ? agent.event(text, opts) : localHost.event(text, opts?.force)),
  context: (text) => agent.context(text),
  onScreen: () => ui.render(),
  onEnrollProgress: (p) => {
    ui.enrollProgress = p;
    ui.render();
  },
  setListening: (mode) => {
    if (agent.connected) {
      // The agent would otherwise try to converse with the song's lyrics.
      agent.setListening(mode === 'conversation');
      speech.setMode(mode === 'gameplay' ? 'gameplay' : 'off');
    } else {
      speech.setMode(mode === 'gameplay' ? 'gameplay' : 'full');
    }
  },
});
const ui = new UI(uiRoot, game, library);

const agent = new HypeAgent(game, {
  onSpeaking: speaking,
  onStatus: (s) => {
    orb.dataset.status = s;
    if (s === 'disconnected' && game.screen !== 'boot') {
      // fall back to local voice control so the game is never stuck
      speech.setMode(game.screen === 'play' ? 'gameplay' : 'full');
    }
  },
  onCaption: caption,
});
const speech = new SpeechCommands(game);
speech.onHeard = (t) => caption('player', t);
speech.onReply = (t) => {
  if (!agent.connected) localHost.say(shorten(t));
};

const shorten = (t: string) => (t.startsWith('{') ? 'Here you go.' : t.split(/(?<=\.)\s/)[0]);

library.onChange = () => ui.render();

// ---- drag & drop songs (the one non-voice affordance: getting files in) ----
addEventListener('dragover', (e) => e.preventDefault());
addEventListener('drop', async (e: DragEvent) => {
  e.preventDefault();
  const files = [...(e.dataTransfer?.files ?? [])];
  const n = await library.addFiles(files);
  if (n) {
    fx.announce(`+${n} SONG${n > 1 ? 'S' : ''}`, '#00e5ff');
    agent.context(`${n} new song(s) were just added and are being analysed.`);
  }
});

// ---- boot ----
async function boot() {
  game.go('boot');
  ui.bootStatus = 'Warming up…';
  ui.render();
  await Promise.all([players.load(), library.load()]);
  try {
    await vision.init((s) => {
      ui.bootStatus = s;
      ui.render(true);
    });
  } catch (e) {
    ui.bootStatus = `Camera problem: ${(e as Error).message}. Allow camera access and reload.`;
    ui.render(true);
    return;
  }

  await audio.resume().catch(() => {});
  if (audio.ctx.state !== 'running') {
    ui.bootStatus = 'Ready.';
    ui.bootNeedsTap = true;
    ui.render(true);
    await new Promise<void>((resolve) => {
      const go = () => {
        removeEventListener('keydown', go);
        removeEventListener('pointerdown', go);
        resolve();
      };
      addEventListener('keydown', go);
      addEventListener('pointerdown', go);
    });
    await audio.resume();
  }

  game.go('lobby');
  if (agent.configured) {
    try {
      await agent.start({
        players: players.list.map((p) => p.name).join(', ') || 'none yet',
        current_player: players.current?.name ?? 'nobody',
        song_count: library.songs.length,
      });
    } catch (e) {
      console.error(e);
      caption('agent', `Couldn't reach the ElevenLabs agent (${(e as Error).message}). Using local voice commands.`);
    }
  }
  if (!agent.connected) {
    if (!speechSupported) caption('agent', 'Voice control needs Chrome or Edge. Set VITE_ELEVENLABS_AGENT_ID for the full hype host.');
    speech.setMode('full');
    localHost.say(players.list.length ? `Welcome back! Who's dancing?` : `Welcome to Move or Lose! Say "enroll me as" and your name.`);
  }
}

// ---- main loop ----
let last = performance.now();
let uiTick = 0;
function loop(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  vision.tick(now);
  audio.update();
  game.update(dt, now);
  renderer.frame(dt);
  if ((uiTick += dt) > 0.25) {
    uiTick = 0;
    ui.render();
  }
  requestAnimationFrame(loop);
}
const renderer = new Renderer(g, game, audio, vision, viz, fx);
requestAnimationFrame(loop);
void boot();

if (import.meta.env.DEV) Object.assign(window, { __game: game, __players: players, __library: library, __vision: vision });
