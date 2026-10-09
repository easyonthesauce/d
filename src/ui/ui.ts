import type { Library } from '../audio/library';
import { PROFILES } from '../game/choreo';
import type { Game } from '../game/game';
import { DIFFICULTIES } from '../types';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const MOOD_EMOJI: Record<string, string> = { euphoric: '🤩', aggressive: '😤', dreamy: '🌙', melancholic: '🥀' };

/** DOM overlay screens. Pure render-from-state; voice is the only input. */
export class UI {
  bootStatus = 'Loading…';
  bootNeedsTap = false;
  enrollProgress = 0;
  hints: string[] = [];
  private last = '';

  constructor(private root: HTMLElement, private game: Game, private library: Library) {}

  render(force = false) {
    const html = this.html();
    if (force || html !== this.last) {
      this.root.innerHTML = html;
      this.last = html;
    }
  }

  private html(): string {
    switch (this.game.screen) {
      case 'boot': return this.boot();
      case 'lobby': return this.lobby();
      case 'enroll': return this.enroll();
      case 'songs': return this.songs();
      case 'results': return this.results();
      case 'leaderboard': return this.leaderboard();
      default: return '';
    }
  }

  private boot() {
    return `<section class="screen boot">
      <h1 class="logo">MOVE<span>OR</span>LOSE</h1>
      <p class="status">${esc(this.bootStatus)}</p>
      ${this.bootNeedsTap ? `<p class="tap pulse">Press any key or tap to wake me up</p>` : ''}
    </section>`;
  }

  private hintBox(lines: string[]) {
    return `<div class="hints">${lines.map((l) => `<div class="hint">🎙️ “${esc(l)}”</div>`).join('')}</div>`;
  }

  private lobby() {
    const g = this.game;
    const p = g.players.current;
    const song = g.song;
    return `<section class="screen lobby">
      <h1 class="logo small">MOVE<span>OR</span>LOSE</h1>
      <div class="spacer cam-spacer"></div>
      <div class="now-up">${p ? `<div class="label">NOW UP</div><div class="name" style="color:${p.color}">${esc(p.name)}</div>` : `<div class="label">NO DANCERS YET</div>`}</div>
      <div class="players">${g.players.list
        .map((x) => `<div class="pl ${x.id === p?.id ? 'active' : ''}" style="--c:${x.color}"><img src="${x.avatar}" alt=""><span>${esc(x.name)}</span><small>${x.stats.totalScore.toLocaleString()}</small></div>`)
        .join('')}</div>
      <div class="setup">
        <div class="card song-card">${song ? this.songLine(song.id) : '<span class="dim">No song picked</span>'}</div>
        <div class="diffs">${DIFFICULTIES.map((d) => `<span class="chip ${d === g.difficulty ? 'on' : ''}">${PROFILES[d].label}</span>`).join('')}</div>
      </div>
      ${this.hintBox(
        !g.players.list.length
          ? ['Enroll me as Sam', 'Add player Alex']
          : !song
            ? ['Play something energetic', 'What songs have we got?', 'Make it extreme']
            : ["I'm ready, let's go!", 'Make it hard', 'Who am I?', 'Show the leaderboard'],
      )}
      ${!this.library.songs.length ? `<p class="dim center">Press <b>M</b> to pick your music folder (or drag songs onto this screen), then say “rescan my music” whenever you add more.</p>` : ''}
    </section>`;
  }

  private songLine(id: string) {
    const s = this.library.songs.find((x) => x.id === id);
    if (!s) return '';
    const a = s.analysis;
    return `<div class="song-line">
      <div class="t">${esc(s.title)}${s.artist ? `<small> · ${esc(s.artist)}</small>` : ''}</div>
      ${
        a
          ? `<div class="tags"><span>${esc(a.genre)}</span><span>${Math.round(a.bpm)} BPM</span><span>${MOOD_EMOJI[a.mood]} ${a.mood}</span><span>${a.key} ${a.scale}</span><span class="theme" style="--c:${a.theme.palette[0]}">🎨 ${esc(a.theme.name)}</span></div>
             <div class="meters"><i style="--v:${a.energy}">energy</i><i style="--v:${a.danceability}">groove</i><i style="--v:${a.valence}">happy</i></div>`
          : this.library.analysing.has(s.id) ? '<div class="tags"><span class="pulse">analysing…</span></div>' : '<div class="tags"><span>queued</span></div>'
      }
    </div>`;
  }

  private enroll() {
    return `<section class="screen enroll">
      <h2>Look at the screen,<br><b>${esc(this.game.enrollName)}</b></h2>
      <div class="spacer enroll-spacer"></div>
      <div class="bar"><i style="width:${Math.round(this.enrollProgress * 100)}%"></i></div>
      <p class="dim">Hold still… scanning your gorgeous face</p>
    </section>`;
  }

  private songs() {
    const g = this.game;
    const list = this.library.songs;
    return `<section class="screen songs">
      <h2>PICK YOUR POISON</h2>
      <div class="song-list">${list
        .map((s) => `<div class="card ${s.id === g.song?.id ? 'selected' : ''}">${this.songLine(s.id)}</div>`)
        .join('')}</div>
      ${this.hintBox(g.song ? ["Let's go!", 'Make it extreme', 'Play something else'] : ['Play the first one', 'Something angry'])}
    </section>`;
  }

  private results() {
    const r = this.game.lastRound;
    if (!r) return '';
    const p = this.game.players.current;
    const counts = (['PERFECT', 'GREAT', 'GOOD', 'OK', 'MISS'] as const).map((k) => [k, r.grades.filter((g) => g === k).length] as const);
    return `<section class="screen results">
      ${p ? `<img class="avatar big" src="${p.avatar}" style="--c:${p.color}">` : ''}
      <h2>${p ? esc(p.name) : ''}</h2>
      <div class="stars">${'★'.repeat(r.stars)}<span>${'★'.repeat(5 - r.stars)}</span></div>
      <div class="big-score">${r.score.toLocaleString()}</div>
      ${r.newBest ? '<div class="badge pulse">NEW PERSONAL BEST</div>' : ''}
      <div class="stat-grid">
        <div><b>${Math.round(r.accuracy * 100)}%</b>accuracy</div>
        <div><b>${r.maxCombo}</b>max combo</div>
        <div><b>${r.kcal.toFixed(1)}</b>kcal burned*</div>
      </div>
      <div class="grades">${counts.map(([k, n]) => `<span style="color:${this.game.gradeColors[k]}">${k} <b>${n}</b></span>`).join('')}</div>
      ${this.hintBox(['Next player', 'Run it back', 'Show the leaderboard'])}
      <p class="fine">*rough estimate from how much you moved</p>
    </section>`;
  }

  private leaderboard() {
    const rows = this.game.players.leaderboard();
    return `<section class="screen leaderboard">
      <h2>HALL OF SWEAT</h2>
      <ol>${rows
        .map((r, i) => `<li style="--c:${r.player.color}"><span class="rank">${i === 0 ? '👑' : i + 1}</span><img src="${r.player.avatar}"><span class="n">${esc(r.player.name)}</span><span class="s">${r.total.toLocaleString()}<small>best ${r.best.toLocaleString()} · ${Math.round(r.kcal)} kcal</small></span></li>`)
        .join('')}</ol>
      ${this.hintBox(['Back to the lobby', 'Next player'])}
    </section>`;
  }
}
