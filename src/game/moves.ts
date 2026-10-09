/**
 * Dance move library. A move is described by the screen-space direction of each
 * limb segment as the player should appear on the (mirrored) screen.
 * Angles in degrees: 0 = pointing right, 90 = pointing down, 180 = left, 270 = up.
 * "L" means the limb on the left of the screen.
 */
export interface Move {
  id: string;
  name: string;
  /** 1 (easy) … 4 (spicy) */
  tier: 1 | 2 | 3 | 4;
  lUpper: number; lFore: number;
  rUpper: number; rFore: number;
  lThigh: number; lShin: number;
  rThigh: number; rShin: number;
  /** body drop as a fraction of torso length (squats/lunges) */
  crouch?: number;
  /** optional hand gesture bonus (MediaPipe gesture names) */
  gesture?: 'Victory' | 'Thumb_Up' | 'Pointing_Up' | 'Open_Palm' | 'Closed_Fist' | 'ILoveYou';
  /** whether leg segments are scored (arms only otherwise) */
  legs?: boolean;
}

const STAND = { lThigh: 95, lShin: 90, rThigh: 85, rShin: 90 };
const WIDE = { lThigh: 110, lShin: 100, rThigh: 70, rShin: 80 };
const SQUAT = { lThigh: 140, lShin: 70, rThigh: 40, rShin: 110, crouch: 0.35 };

export const MOVES: Move[] = [
  // ---- tier 1: arms only, big & readable ----
  { id: 'v', name: 'Victory V', tier: 1, lUpper: 225, lFore: 225, rUpper: 315, rFore: 315, ...STAND },
  { id: 'tpose', name: 'T-Pose', tier: 1, lUpper: 180, lFore: 180, rUpper: 0, rFore: 0, ...STAND },
  { id: 'hands-up', name: 'Raise the Roof', tier: 1, lUpper: 200, lFore: 270, rUpper: 340, rFore: 270, ...STAND },
  { id: 'point-l', name: 'Point Left', tier: 1, lUpper: 180, lFore: 180, rUpper: 120, rFore: 200, ...STAND },
  { id: 'point-r', name: 'Point Right', tier: 1, lUpper: 60, lFore: 340, rUpper: 0, rFore: 0, ...STAND },
  { id: 'disco-l', name: 'Disco Left', tier: 1, lUpper: 220, lFore: 220, rUpper: 120, rFore: 135, ...STAND },
  { id: 'disco-r', name: 'Disco Right', tier: 1, lUpper: 45, lFore: 45, rUpper: 320, rFore: 320, ...STAND },
  { id: 'flex', name: 'Double Flex', tier: 1, lUpper: 180, lFore: 270, rUpper: 0, rFore: 270, ...STAND },

  // ---- tier 2: asymmetry + stance ----
  { id: 'star', name: 'Starjump', tier: 2, lUpper: 225, lFore: 225, rUpper: 315, rFore: 315, ...WIDE, legs: true },
  { id: 'cross', name: 'X Marks It', tier: 2, lUpper: 60, lFore: 20, rUpper: 120, rFore: 160, ...STAND },
  { id: 'wave-l', name: 'Wave Left', tier: 2, lUpper: 200, lFore: 160, rUpper: 20, rFore: 340, ...WIDE, legs: true },
  { id: 'wave-r', name: 'Wave Right', tier: 2, lUpper: 160, lFore: 200, rUpper: 340, rFore: 20, ...WIDE, legs: true },
  { id: 'dab-l', name: 'Dab', tier: 2, lUpper: 200, lFore: 210, rUpper: 160, rFore: 250, ...STAND },
  { id: 'dab-r', name: 'Reverse Dab', tier: 2, lUpper: 20, lFore: 290, rUpper: 340, rFore: 330, ...STAND },
  { id: 'peace', name: 'Peace Out', tier: 2, lUpper: 100, lFore: 100, rUpper: 330, rFore: 270, ...STAND, gesture: 'Victory' },
  { id: 'thumbs', name: 'Thumbs Up', tier: 2, lUpper: 135, lFore: 270, rUpper: 45, rFore: 270, ...STAND, gesture: 'Thumb_Up' },

  // ---- tier 3: legs & squats ----
  { id: 'squat', name: 'Power Squat', tier: 3, lUpper: 180, lFore: 180, rUpper: 0, rFore: 0, ...SQUAT, legs: true },
  { id: 'knee-l', name: 'Knee Up Left', tier: 3, lUpper: 200, lFore: 270, rUpper: 340, rFore: 270, lThigh: 195, lShin: 100, rThigh: 85, rShin: 90, legs: true },
  { id: 'knee-r', name: 'Knee Up Right', tier: 3, lUpper: 200, lFore: 270, rUpper: 340, rFore: 270, lThigh: 95, lShin: 90, rThigh: 345, rShin: 80, legs: true },
  { id: 'lunge-l', name: 'Lunge Left', tier: 3, lUpper: 180, lFore: 180, rUpper: 300, rFore: 270, lThigh: 150, lShin: 90, rThigh: 60, rShin: 60, crouch: 0.2, legs: true },
  { id: 'lunge-r', name: 'Lunge Right', tier: 3, lUpper: 240, lFore: 270, rUpper: 0, rFore: 0, lThigh: 120, lShin: 120, rThigh: 30, rShin: 90, crouch: 0.2, legs: true },
  { id: 'rock', name: 'Rock On', tier: 3, lUpper: 200, lFore: 250, rUpper: 340, rFore: 290, ...WIDE, legs: true, gesture: 'ILoveYou' },

  // ---- tier 4: chaos ----
  { id: 'kick-l', name: 'High Kick Left', tier: 4, lUpper: 0, lFore: 0, rUpper: 315, rFore: 315, lThigh: 200, lShin: 200, rThigh: 85, rShin: 90, legs: true },
  { id: 'kick-r', name: 'High Kick Right', tier: 4, lUpper: 225, lFore: 225, rUpper: 180, rFore: 180, lThigh: 95, lShin: 90, rThigh: 340, rShin: 340, legs: true },
  { id: 'sumo', name: 'Sumo Slam', tier: 4, lUpper: 160, lFore: 90, rUpper: 20, rFore: 90, lThigh: 150, lShin: 90, rThigh: 30, rShin: 90, crouch: 0.4, legs: true, gesture: 'Closed_Fist' },
  { id: 'superman', name: 'Superhero Landing', tier: 4, lUpper: 140, lFore: 120, rUpper: 300, rFore: 270, lThigh: 160, lShin: 60, rThigh: 60, rShin: 100, crouch: 0.45, legs: true },
  { id: 'sky', name: 'Reach the Sky', tier: 4, lUpper: 260, lFore: 260, rUpper: 280, rFore: 280, lThigh: 95, lShin: 90, rThigh: 20, rShin: 90, legs: true, gesture: 'Pointing_Up' },
];

export const NEUTRAL: Move = {
  id: 'neutral', name: 'Ready', tier: 1,
  lUpper: 105, lFore: 95, rUpper: 75, rFore: 85, ...STAND,
};

export const SEGMENTS = ['lUpper', 'lFore', 'rUpper', 'rFore', 'lThigh', 'lShin', 'rThigh', 'rShin'] as const;
export type Segment = (typeof SEGMENTS)[number];

/** shortest-path angle interpolation */
export function lerpAngle(a: number, b: number, t: number): number {
  const d = ((((b - a) % 360) + 540) % 360) - 180;
  return a + d * t;
}

export function blendMoves(a: Move, b: Move, t: number): Move {
  const out = { ...b };
  for (const s of SEGMENTS) out[s] = lerpAngle(a[s], b[s], t);
  out.crouch = (a.crouch ?? 0) + ((b.crouch ?? 0) - (a.crouch ?? 0)) * t;
  return out;
}
