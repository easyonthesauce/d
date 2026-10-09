// Vercel function: mints an ElevenLabs signed URL for private agents so the API key
// stays server-side. Returns 204 when no key is configured (public agent).
export default async function handler(_req, res) {
  const key = process.env.ELEVENLABS_API_KEY;
  const agentId = process.env.VITE_ELEVENLABS_AGENT_ID;
  if (!key || !agentId) return res.status(204).end();
  const r = await fetch(
    `https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=${encodeURIComponent(agentId)}`,
    { headers: { 'xi-api-key': key } },
  );
  res.status(r.status).setHeader('Content-Type', 'application/json').send(await r.text());
}
