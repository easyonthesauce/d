import { Conversation, type Mode, type Status } from '@elevenlabs/client';
import type { GameApi } from './api';

type AnyConversation = Awaited<ReturnType<typeof Conversation.startSession>>;

export interface AgentCallbacks {
  onSpeaking: (speaking: boolean) => void;
  onStatus: (s: Status | 'unconfigured' | 'error') => void;
  onCaption: (who: 'agent' | 'player', text: string) => void;
}

/**
 * The hype-host: an ElevenLabs Conversational AI agent that drives the game
 * through client tools and reacts to game events we feed it.
 */
export class HypeAgent {
  private convo: AnyConversation | null = null;
  readonly agentId = import.meta.env.VITE_ELEVENLABS_AGENT_ID as string | undefined;
  private lastEventAt = 0;

  constructor(private api: GameApi, private cb: AgentCallbacks) {}

  get configured() {
    return !!this.agentId;
  }

  get connected() {
    return !!this.convo?.isOpen();
  }

  async start(dynamicVariables: Record<string, string | number | boolean>) {
    if (!this.agentId) {
      this.cb.onStatus('unconfigured');
      return;
    }
    const clientTools: Record<string, (p: any) => Promise<string>> = {};
    for (const name of Object.keys(this.api) as (keyof GameApi)[]) {
      clientTools[name] = async (params: any) => {
        try {
          const res = await (this.api[name] as (p: unknown) => string | Promise<string>)(params ?? {});
          console.debug('[tool]', name, params, '→', res);
          return res;
        } catch (e) {
          return `Error: ${(e as Error).message}`;
        }
      };
    }

    // Private agents need a signed URL minted by our dev server; public ones connect by id.
    let signedUrl: string | undefined;
    try {
      const r = await fetch('/api/signed-url');
      if (r.status === 200) signedUrl = (await r.json()).signed_url;
    } catch { /* public agent */ }

    this.convo = await Conversation.startSession({
      ...(signedUrl ? { signedUrl } : { agentId: this.agentId, connectionType: 'websocket' as const }),
      clientTools,
      dynamicVariables,
      onModeChange: ({ mode }: { mode: Mode }) => this.cb.onSpeaking(mode === 'speaking'),
      onStatusChange: ({ status }: { status: Status }) => this.cb.onStatus(status),
      onMessage: ({ message, source }) => this.cb.onCaption(source === 'ai' ? 'agent' : 'player', message),
      onError: (msg: string) => {
        console.error('agent error', msg);
        this.cb.onStatus('error');
      },
      onDisconnect: () => this.cb.onStatus('disconnected'),
    });
  }

  async stop() {
    await this.convo?.endSession();
    this.convo = null;
  }

  /** Background facts the agent should know but needn't respond to. */
  context(text: string) {
    if (this.connected) this.convo!.sendContextualUpdate(text);
  }

  /**
   * A game event the agent should react to out loud (roast, hype, etc.).
   * Throttled so it doesn't talk over the whole song.
   */
  event(text: string, opts: { force?: boolean; minGapMs?: number } = {}) {
    if (!this.connected) return false;
    const now = performance.now();
    if (!opts.force && now - this.lastEventAt < (opts.minGapMs ?? 9000)) {
      this.context(text);
      return false;
    }
    this.lastEventAt = now;
    this.convo!.sendUserMessage(`[GAME EVENT] ${text}`);
    return true;
  }

  /** Mute the agent's ears during a song (the mic would hear the music). */
  setListening(on: boolean) {
    if (this.connected) this.convo!.setMicMuted(!on);
  }

  setVolume(v: number) {
    if (this.connected) this.convo!.setVolume({ volume: v });
  }
}
