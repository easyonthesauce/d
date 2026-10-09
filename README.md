# 🕺 MOVE OR LOSE

A Just Dance–style, voice-only, sweat-guaranteed party game for a **portrait 60" TV + webcam**.
You dance to *your own* music, MediaPipe scores your poses, the visuals are themed to each song,
and **BLAZE** – an ElevenLabs conversational agent – runs the whole show, hypes you up and roasts
you when you miss.

> "Ok, you ready to play, tiger? …Meow? **GO.**"

## What's in the box

| | |
|---|---|
| **Players** | Enroll by voice ("enroll me as Sam"). Your face is captured as your avatar and a face signature (MediaPipe Face Landmarker geometry + image embedding) lets the game recognise who just stepped up. |
| **Your music** | Drop audio files in `music/` (or drag them onto the screen) and say "rescan my music". |
| **Song analysis** | Each new song is decoded and analysed in a Web Worker: BPM + beat grid (onset envelope → autocorrelation → dynamic-programming beat tracker), per-beat energy, **drops**, key/scale (Krumhansl), energy/valence/danceability → **mood** (euphoric / aggressive / dreamy / melancholic) and **genre** (ID3 tag if present, otherwise a heuristic guess). |
| **Themes** | Mood + genre pick a visual theme: *Club Neon* bars & lasers, *Gold Chains* radial burst, *Thunderdome* glitch + lightning, *Aurora* liquid waves, *Midnight* warp starfield, *Sugar Rush*… |
| **Choreography** | Generated per song+difficulty (deterministic, so you can practise a routine). Moves land on beats; the song is split into **4 speed levels** so it gets faster as it goes; loud sections push the speed up, quiet ones give a breather; harder move tiers unlock as you go. |
| **Difficulty** | Easy (arms only, slow) → Medium → Hard (legs, squats, gesture bonuses) → Extreme (kicks, 1 move per beat, tight timing window). |
| **Scoring** | Pose Landmarker limb angles vs. the target pose → PERFECT / GREAT / GOOD / OK / MISS, combo multiplier up to ×4, drops score double, ✌️👍☝️🤟✊ hand gestures (Gesture Recognizer) earn bonuses. Rough **kcal burned** from how much you actually move. |
| **Effects** | Beat-synced pulses, confetti, shockwaves, strobes and screen shake on drops, "SPEED UP!" banners, live kick detection driving the visualizer. |
| **Voice** | All navigation is by voice. BLAZE (ElevenLabs agent) calls 19 client tools to drive the game and gets live `[GAME EVENT]`s (miss streaks, combos, speed-ups, drops, results) to react to. Without an agent configured, the game falls back to browser speech recognition + local TTS trash talk. |

## Run it

```bash
npm install
cp .env.example .env      # put your agent id in VITE_ELEVENLABS_AGENT_ID
npm run dev               # http://localhost:5173
```

Use **Chrome or Edge**. For the TV, run it as a kiosk so it starts hands-free:

```bash
google-chrome --kiosk --autoplay-policy=no-user-gesture-required \
  --use-fake-ui-for-media-stream http://localhost:5173
```

(`--autoplay-policy` lets the audio start without a click – otherwise you need one keypress at boot.
`--use-fake-ui-for-media-stream` auto-allows the camera/mic prompt; only use it on a machine you trust.)

Landscape TV? Set `VITE_ORIENTATION=landscape`.

### The ElevenLabs agent

The agent **BLAZE – Move or Lose hype host** (`agent_4101m4h556q0emn92a73ydswh30d`) already exists in
your ElevenLabs workspace with the system prompt from `agent/system-prompt.md` and all 19 client tools
attached (they mirror `src/voice/api.ts`). Put that id in `.env`.

- **Public agent** (no auth): the browser connects directly with the agent id.
- **Private agent**: also set `ELEVENLABS_API_KEY` in `.env`; the dev server mints a signed URL at
  `/api/signed-url` so the key never reaches the browser.
- It uses the default voice. For a proper roast-master voice, add one from the Voice Library
  (e.g. "Witty McGee – Snarky & Warm") and select it on the agent.

**Mic during songs:** the agent's mic is muted while a song plays (otherwise it tries to chat with
the lyrics). A lightweight local listener still catches "pause the game" / "stop the game".

## Voice commands (examples)

- "Enroll me as Sam" · "Who am I?" · "It's Alex's turn" · "Next player"
- "What songs have we got?" · "Play Levitating" · "Something angry" · "Surprise me"
- "Make it extreme" · "I'm ready, let's go!"
- "Pause the game" · "Resume" · "Stop the game"
- "Show the leaderboard" · "Rescan my music" · "Volume 6"

With BLAZE you can just talk normally.

## Layout

```
src/
  audio/    analysis.worker.ts (BPM/beats/key/mood/genre), library.ts (music folder, uploads, ID3, cache), player.ts (playback, analyser, ducking, SFX)
  vision/   vision.ts (camera, Pose/Face/Gesture/Embedder, face signatures)
  game/     moves.ts (move library), choreo.ts (routine generator + difficulty), scoring.ts, players.ts, game.ts (state machine + voice API)
  render/   visualizer.ts (themed backgrounds), effects.ts, figure.ts (coach + skeleton), renderer.ts, layout.ts
  voice/    agent.ts (ElevenLabs), speech.ts (Web Speech fallback), localHost.ts (offline trash talk), api.ts (tool list)
  ui/       ui.ts (DOM screens)
agent/system-prompt.md
```

Debug: `?cpu` forces MediaPipe's CPU delegate. In dev, `window.__game` exposes the game API in the console
(e.g. `__game.select_song({query: 'neon'})`).

## Honest caveats

- Face recognition is lightweight (landmark geometry + a generic image embedding). It's great for telling
  a household apart, not for security. If it's unsure it asks rather than guesses.
- Genre is a vibe guess unless your files have an ID3 genre tag.
- Calories are a rough estimate from movement intensity, not medical advice.
- Put the camera at about chest height, 2.5–3.5 m back, so it sees you head to knees (legs are only
  judged on leg moves, and only if visible).
