import { speak } from './speech';

const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];

const ROASTS = [
  "Was that a dance move or are you swatting a wasp?",
  "My grandma's screensaver has better moves.",
  "Bold choice, ignoring the music entirely.",
  "That was a miss. And a miss. And honestly, a cry for help.",
  "Are you dancing or buffering?",
  "The pose is on the screen. The screen. Up there.",
];
const HYPE = ["Oh you're COOKING!", "Somebody call the fire department!", "Unstoppable!", "That's how it's done!", "Look at you go, superstar!"];
const DROP = ["Here it comes!", "DROP IT!", "Go go go!"];
const SPEED = ["Faster! Keep up!", "Speed's going up, tiger!", "Oh it's getting spicy now!"];

/**
 * Canned hype-host lines using the browser's TTS, for when no ElevenLabs
 * agent is configured. Much less clever, still rude.
 */
export class LocalHost {
  private last = 0;
  constructor(private onSpeaking: (s: boolean) => void, private onCaption: (t: string) => void) {}

  say(text: string) {
    this.onCaption(text);
    speak(text, () => this.onSpeaking(true), () => this.onSpeaking(false));
  }

  event(text: string, force = false) {
    const now = performance.now();
    if (!force && now - this.last < 7000) return;
    this.last = now;
    let line: string | null = null;
    const name = text.match(/^(\w+) (just|hit)/)?.[1];
    if (text.includes('missed')) line = pick(ROASTS);
    else if (text.includes('combo')) line = `${name ?? 'You'}! ${pick(HYPE)}`;
    else if (text.includes('dropped')) line = pick(DROP);
    else if (text.includes('Speed level')) line = pick(SPEED);
    else if (text.includes('stepped up')) line = `Hey ${name}! What are we dancing to?`;
    else if (text.startsWith('Round over')) {
      const stars = Number(text.match(/(\d)\/5 stars/)?.[1] ?? 0);
      line = stars >= 4 ? `${pick(HYPE)} ${stars} stars! Who's next?` : stars >= 2 ? `${stars} stars. Respectable. Barely. Who's next?` : `${stars} stars. ${pick(ROASTS)} Who's next?`;
    } else if (text.includes('Halfway')) line = 'Halfway there, keep moving!';
    else if (text.includes('20 seconds')) line = 'Final stretch! Leave it all on the floor!';
    if (line) this.say(line);
  }
}
