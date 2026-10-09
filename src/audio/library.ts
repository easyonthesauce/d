import { db } from '../db';
import type { Song, SongAnalysis } from '../types';
import { ANALYSIS_VERSION } from './dsp';

const AUDIO_RE = /\.(mp3|m4a|aac|wav|ogg|oga|flac|webm)$/i;

function prettyTitle(file: string): { title: string; artist?: string } {
  const base = file.split('/').pop()!.replace(AUDIO_RE, '').replace(/[_]+/g, ' ').replace(/^\d+[\s.-]+/, '').trim();
  const m = base.match(/^(.+?)\s+-\s+(.+)$/);
  return m ? { artist: m[1].trim(), title: m[2].trim() } : { title: base };
}

/** Minimal ID3v2 reader for title / artist / genre. */
function readId3(buf: ArrayBuffer): { title?: string; artist?: string; genre?: string } {
  const b = new Uint8Array(buf);
  if (b.length < 10 || b[0] !== 0x49 || b[1] !== 0x44 || b[2] !== 0x33) return {};
  const ver = b[3];
  const syncsafe = (o: number) => (b[o] << 21) | (b[o + 1] << 14) | (b[o + 2] << 7) | b[o + 3];
  const size = syncsafe(6) + 10;
  const out: Record<string, string> = {};
  let p = 10;
  while (p + 10 < Math.min(size, b.length)) {
    const id = String.fromCharCode(b[p], b[p + 1], b[p + 2], b[p + 3]);
    if (!/^[A-Z0-9]{4}$/.test(id)) break;
    const len = ver === 4 ? syncsafe(p + 4) : (b[p + 4] << 24) | (b[p + 5] << 16) | (b[p + 6] << 8) | b[p + 7];
    if (len <= 0 || p + 10 + len > b.length) break;
    if (id === 'TIT2' || id === 'TPE1' || id === 'TCON') {
      const enc = b[p + 10];
      const body = b.subarray(p + 11, p + 10 + len);
      const text = new TextDecoder(enc === 1 ? 'utf-16' : enc === 2 ? 'utf-16be' : enc === 3 ? 'utf-8' : 'latin1').decode(body);
      out[id] = text.replace(/\0/g, '').replace(/^\((\d+)\)/, '').trim();
    }
    p += 10 + len;
  }
  return { title: out.TIT2 || undefined, artist: out.TPE1 || undefined, genre: out.TCON || undefined };
}

// File System Access API bits that lib.dom doesn't ship yet.
type PermState = 'granted' | 'denied' | 'prompt';
interface FsHandle { kind: 'file' | 'directory'; name: string }
interface FsFileHandle extends FsHandle { getFile(): Promise<File> }
interface FsDirHandle extends FsHandle {
  values(): AsyncIterable<FsHandle>;
  queryPermission(o: { mode: 'read' }): Promise<PermState>;
  requestPermission(o: { mode: 'read' }): Promise<PermState>;
}

let ctx: AudioContext | null = null;
const audioCtx = () => (ctx ??= new AudioContext());

export class Library {
  songs: Song[] = [];
  onChange: () => void = () => {};
  /** songs currently being analysed: id → progress label */
  analysing = new Set<string>();

  async load(): Promise<void> {
    this.songs = await db.all<Song>('songs');
    await this.rescan();
  }

  /** Rescan the server-side music folder (local dev server) and/or the picked folder. Returns number of new songs. */
  async rescan(): Promise<number> {
    return (await this.scanServerFolder()) + (await this.scanPickedFolder());
  }

  private async scanServerFolder(): Promise<number> {
    let files: { file: string; size: number }[] = [];
    try {
      const r = await fetch('/api/music');
      if (!r.ok || !r.headers.get('content-type')?.includes('json')) return 0; // hosted build: no server folder
      files = await r.json();
    } catch {
      return 0;
    }
    let added = 0;
    for (const f of files) {
      const id = `f:${f.file}:${f.size}`;
      if (this.songs.some((s) => s.id === id)) continue;
      const song: Song = { id, ...prettyTitle(f.file), source: { kind: 'folder', file: f.file }, size: f.size };
      this.songs.push(song);
      await db.put('songs', id, song);
      added++;
    }
    // forget folder songs whose files vanished
    const present = new Set(files.map((f) => `f:${f.file}:${f.size}`));
    for (const s of this.songs.filter((s) => s.source.kind === 'folder' && !present.has(s.id))) await db.del('songs', s.id);
    this.songs = this.songs.filter((s) => s.source.kind !== 'folder' || present.has(s.id));
    this.onChange();
    void this.analyseAll();
    return added;
  }

  // ---- picked folder (hosted builds, File System Access API) ----
  // The browser needs one click/keypress to grant access; after that the handle
  // is remembered and re-scanned on "rescan my music".
  private dir: FsDirHandle | null = null;

  get canPickFolder() {
    return 'showDirectoryPicker' in window;
  }

  /** Must run inside a user gesture. */
  async pickFolder(): Promise<number> {
    if (!this.canPickFolder) return this.pickFiles();
    try {
      this.dir = await (window as unknown as { showDirectoryPicker(o: object): Promise<FsDirHandle> }).showDirectoryPicker({ id: 'music', mode: 'read' });
    } catch {
      return 0; // cancelled
    }
    await db.put('kv', 'musicDir', this.dir);
    return this.scanPickedFolder();
  }

  /** Fallback for browsers without folder access: a multi-file picker. */
  private pickFiles(): Promise<number> {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.multiple = true;
      input.accept = 'audio/*';
      input.onchange = async () => resolve(await this.addFiles([...(input.files ?? [])]));
      input.click();
    });
  }

  /** Re-attach the remembered folder. Pass `gesture` when called from a click/keypress so we may prompt. */
  async restoreFolder(gesture: boolean): Promise<number> {
    this.dir ??= (await db.get<FsDirHandle>('kv', 'musicDir')) ?? null;
    if (!this.dir) return 0;
    let perm = await this.dir.queryPermission({ mode: 'read' });
    if (perm !== 'granted' && gesture) perm = await this.dir.requestPermission({ mode: 'read' }).catch(() => 'denied' as const);
    return perm === 'granted' ? this.scanPickedFolder() : 0;
  }

  get hasFolder() {
    return !!this.dir;
  }

  private async scanPickedFolder(): Promise<number> {
    if (!this.dir || (await this.dir.queryPermission({ mode: 'read' })) !== 'granted') return 0;
    const files: File[] = [];
    const walk = async (d: FsDirHandle, depth: number) => {
      for await (const h of d.values()) {
        if (h.kind === 'file' && AUDIO_RE.test(h.name)) files.push(await (h as FsFileHandle).getFile());
        else if (h.kind === 'directory' && depth < 3) await walk(h as FsDirHandle, depth + 1);
      }
    };
    await walk(this.dir, 0);
    return this.addFiles(files);
  }

  async addFiles(files: File[]): Promise<number> {
    let added = 0;
    for (const file of files.filter((f) => AUDIO_RE.test(f.name) || f.type.startsWith('audio/'))) {
      const id = `u:${file.name}:${file.size}`;
      if (this.songs.some((s) => s.id === id)) continue;
      await db.put('blobs', id, file);
      const song: Song = { id, ...prettyTitle(file.name), source: { kind: 'upload' }, size: file.size };
      this.songs.push(song);
      await db.put('songs', id, song);
      added++;
    }
    this.onChange();
    void this.analyseAll();
    return added;
  }

  async remove(id: string) {
    this.songs = this.songs.filter((s) => s.id !== id);
    await db.del('songs', id);
    await db.del('blobs', id);
    this.onChange();
  }

  async getBytes(song: Song): Promise<ArrayBuffer> {
    if (song.source.kind === 'folder') {
      const r = await fetch('/music/' + song.source.file.split('/').map(encodeURIComponent).join('/'));
      if (!r.ok) throw new Error(`Could not load ${song.title}`);
      return r.arrayBuffer();
    }
    const blob = await db.get<Blob>('blobs', song.id);
    if (!blob) throw new Error(`Missing audio for ${song.title}`);
    return blob.arrayBuffer();
  }

  async decode(song: Song): Promise<AudioBuffer> {
    return audioCtx().decodeAudioData(await this.getBytes(song));
  }

  private queue: Promise<void> = Promise.resolve();

  analyseAll(): Promise<void> {
    for (const s of this.songs) {
      if (s.analysis?.version === ANALYSIS_VERSION || this.analysing.has(s.id)) continue;
      this.analysing.add(s.id);
      this.queue = this.queue.then(() => this.analyse(s).then(
        () => {},
        (e) => console.warn('analysis failed', s.title, e),
      ));
    }
    return this.queue;
  }

  private inflight = new Map<string, Promise<SongAnalysis>>();

  /** Decode + run the analysis worker; caches the result on the song record. */
  analyse(song: Song): Promise<SongAnalysis> {
    if (song.analysis?.version === ANALYSIS_VERSION) return Promise.resolve(song.analysis);
    let p = this.inflight.get(song.id);
    if (!p) {
      p = this.runAnalysis(song).finally(() => this.inflight.delete(song.id));
      this.inflight.set(song.id, p);
    }
    return p;
  }

  private async runAnalysis(song: Song): Promise<SongAnalysis> {
    this.analysing.add(song.id);
    this.onChange();
    try {
      const bytes = await this.getBytes(song);
      const tags = readId3(bytes.slice(0, 256 * 1024));
      if (tags.title) song.title = tags.title;
      if (tags.artist) song.artist = tags.artist;
      if (tags.genre) song.taggedGenre = tags.genre;
      const buf = await audioCtx().decodeAudioData(bytes);
      const mono = new Float32Array(buf.length);
      for (let c = 0; c < buf.numberOfChannels; c++) {
        const d = buf.getChannelData(c);
        for (let i = 0; i < d.length; i++) mono[i] += d[i] / buf.numberOfChannels;
      }
      const analysis = await new Promise<SongAnalysis>((resolve, reject) => {
        const w = new Worker(new URL('./analysis.worker.ts', import.meta.url), { type: 'module' });
        w.onmessage = (e) => {
          w.terminate();
          e.data.ok ? resolve(e.data.analysis) : reject(new Error(e.data.error));
        };
        w.onerror = (e) => { w.terminate(); reject(e); };
        w.postMessage({ samples: mono, sampleRate: buf.sampleRate, taggedGenre: song.taggedGenre }, [mono.buffer]);
      });
      song.analysis = analysis;
      await db.put('songs', song.id, song);
      return analysis;
    } finally {
      this.analysing.delete(song.id);
      this.onChange();
    }
  }

  /** Fuzzy match a spoken song request. */
  find(query: string): Song | undefined {
    const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
    const q = norm(query);
    if (!q) return undefined;
    const qWords = q.split(' ');
    let best: Song | undefined, bestScore = 0;
    for (const s of this.songs) {
      const hay = norm(`${s.title} ${s.artist ?? ''} ${s.analysis?.genre ?? ''} ${s.analysis?.mood ?? ''}`);
      let score = hay.includes(q) ? 10 : 0;
      for (const w of qWords) if (w.length > 1 && hay.includes(w)) score += w.length;
      if (score > bestScore) { bestScore = score; best = s; }
    }
    return best;
  }

  describe(s: Song): string {
    const a = s.analysis;
    const name = s.artist ? `${s.title} by ${s.artist}` : s.title;
    return a ? `${name} (${a.genre}, ${Math.round(a.bpm)} BPM, ${a.mood}, ${a.key} ${a.scale})` : `${name} (still analysing)`;
  }
}
