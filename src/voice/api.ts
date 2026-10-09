/**
 * Everything the game can be told to do by voice. The ElevenLabs agent calls
 * these as client tools; the offline fallback parses speech into the same calls.
 * Every function returns a short sentence for the agent to react to.
 */
export interface GameApi {
  get_game_state(): string;
  list_songs(): string;
  select_song(p: { query: string }): Promise<string>;
  random_song(p: { mood?: string }): Promise<string>;
  set_difficulty(p: { level: string }): string;
  enroll_player(p: { name: string }): Promise<string>;
  identify_player(): Promise<string>;
  set_current_player(p: { name: string }): string;
  next_player(): string;
  list_players(): string;
  remove_player(p: { name: string }): string;
  start_game(): Promise<string>;
  pause_game(): string;
  resume_game(): string;
  stop_game(): string;
  show_leaderboard(): string;
  show_lobby(): string;
  rescan_music(): Promise<string>;
  set_volume(p: { level: number }): string;
}

export type ToolName = keyof GameApi;

/** JSON-schema-ish descriptions, used to provision the ElevenLabs agent (see agent/). */
export const TOOL_SPECS: { name: ToolName; description: string; params?: Record<string, { type: 'string' | 'number'; description: string; required?: boolean }> }[] = [
  { name: 'get_game_state', description: 'Get the current screen, current player, selected song, difficulty, enrolled players and the latest scores. Call this whenever you are unsure what is going on.' },
  { name: 'list_songs', description: 'List the songs in the library with genre, BPM and mood.' },
  { name: 'select_song', description: 'Pick a song for the next round by (partial) title, artist, genre or mood.', params: { query: { type: 'string', description: 'What the player asked for, e.g. "levitating" or "something angry"', required: true } } },
  { name: 'random_song', description: 'Pick a random song, optionally matching a mood (euphoric, aggressive, dreamy, melancholic).', params: { mood: { type: 'string', description: 'optional mood' } } },
  { name: 'set_difficulty', description: 'Set difficulty: easy, medium, hard or extreme.', params: { level: { type: 'string', description: 'easy | medium | hard | extreme', required: true } } },
  { name: 'enroll_player', description: 'Register a new player: captures the face of the person standing in front of the camera as their avatar. Ask them to look at the screen first.', params: { name: { type: 'string', description: "The player's name", required: true } } },
  { name: 'identify_player', description: 'Use face recognition to work out which enrolled player is standing in front of the camera and make them the current player.' },
  { name: 'set_current_player', description: 'Make a named enrolled player the current player.', params: { name: { type: 'string', description: 'Player name', required: true } } },
  { name: 'next_player', description: "Rotate to the next player's turn." },
  { name: 'list_players', description: 'List enrolled players and their stats.' },
  { name: 'remove_player', description: 'Delete an enrolled player.', params: { name: { type: 'string', description: 'Player name', required: true } } },
  { name: 'start_game', description: 'Start the round with the current player, song and difficulty. Runs a 3-2-1 countdown first. Only call this once the player says they are ready.' },
  { name: 'pause_game', description: 'Pause the current round.' },
  { name: 'resume_game', description: 'Resume a paused round.' },
  { name: 'stop_game', description: 'Abandon the current round and go back to the lobby.' },
  { name: 'show_leaderboard', description: 'Show the leaderboard screen.' },
  { name: 'show_lobby', description: 'Go back to the lobby / home screen.' },
  { name: 'rescan_music', description: 'Re-scan the music folder for newly added songs and analyse them.' },
  { name: 'set_volume', description: 'Set music volume 0-10.', params: { level: { type: 'number', description: '0 (mute) to 10 (max)', required: true } } },
];
