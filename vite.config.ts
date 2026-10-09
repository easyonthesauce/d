import { defineConfig, loadEnv, type Connect, type Plugin } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

const AUDIO_EXT = /\.(mp3|m4a|aac|wav|ogg|oga|flac|webm)$/i;
const MIME: Record<string, string> = {
  mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav',
  ogg: 'audio/ogg', oga: 'audio/ogg', flac: 'audio/flac', webm: 'audio/webm',
};

/**
 * Serves the local music folder and mints ElevenLabs signed URLs so the API key
 * stays on the machine. Works for both `vite` and `vite preview`.
 */
function gameServer(env: Record<string, string>): Plugin {
  const musicDir = path.resolve(env.MUSIC_DIR || './music');

  const middleware: Connect.NextHandleFunction = async (req, res, next) => {
    const url = new URL(req.url ?? '/', 'http://localhost');

    if (url.pathname === '/api/music') {
      const files = fs.existsSync(musicDir)
        ? fs.readdirSync(musicDir, { recursive: true, encoding: 'utf8' })
            .filter((f) => AUDIO_EXT.test(f))
            .map((f) => {
              const stat = fs.statSync(path.join(musicDir, f));
              return { file: f.split(path.sep).join('/'), size: stat.size, mtime: stat.mtimeMs };
            })
        : [];
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(files));
      return;
    }

    if (url.pathname.startsWith('/music/')) {
      const rel = decodeURIComponent(url.pathname.slice('/music/'.length));
      const file = path.resolve(musicDir, rel);
      if (!file.startsWith(musicDir + path.sep) || !fs.existsSync(file)) {
        res.statusCode = 404;
        res.end();
        return;
      }
      const ext = path.extname(file).slice(1).toLowerCase();
      res.setHeader('Content-Type', MIME[ext] ?? 'application/octet-stream');
      fs.createReadStream(file).pipe(res);
      return;
    }

    if (url.pathname === '/api/signed-url') {
      const agentId = env.VITE_ELEVENLABS_AGENT_ID;
      if (!env.ELEVENLABS_API_KEY || !agentId) {
        res.statusCode = 204;
        res.end();
        return;
      }
      try {
        const r = await fetch(
          `https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=${encodeURIComponent(agentId)}`,
          { headers: { 'xi-api-key': env.ELEVENLABS_API_KEY } },
        );
        res.statusCode = r.status;
        res.setHeader('Content-Type', 'application/json');
        res.end(await r.text());
      } catch (e) {
        res.statusCode = 502;
        res.end(JSON.stringify({ error: String(e) }));
      }
      return;
    }

    next();
  };

  return {
    name: 'game-server',
    configureServer: (server) => void server.middlewares.use(middleware),
    configurePreviewServer: (server) => void server.middlewares.use(middleware),
  };
}

export default defineConfig(({ mode }) => {
  const env = { ...process.env, ...loadEnv(mode, process.cwd(), '') } as Record<string, string>;
  return {
    plugins: [gameServer(env)],
    server: { port: 5173 },
  };
});
