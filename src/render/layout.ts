export interface Rect { x: number; y: number; w: number; h: number }

export interface Layout {
  portrait: boolean;
  W: number;
  H: number;
  hud: Rect;
  coach: { x: number; y: number; size: number };
  track: Rect & { hitX: number; pxPerSec: number };
  cam: Rect;
  footer: Rect;
}

const portrait = (import.meta.env.VITE_ORIENTATION ?? 'portrait') !== 'landscape';

/** Design-space layout; the stage is CSS-scaled to fit the TV. */
export const L: Layout = portrait
  ? {
      portrait: true, W: 1080, H: 1920,
      hud: { x: 0, y: 0, w: 1080, h: 170 },
      coach: { x: 540, y: 630, size: 760 },
      track: { x: 0, y: 990, w: 1080, h: 170, hitX: 170, pxPerSec: 300 },
      cam: { x: 40, y: 1180, w: 1000, h: 640 },
      footer: { x: 0, y: 1840, w: 1080, h: 80 },
    }
  : {
      portrait: false, W: 1920, H: 1080,
      hud: { x: 0, y: 0, w: 1920, h: 130 },
      coach: { x: 520, y: 500, size: 640 },
      track: { x: 0, y: 870, w: 1920, h: 150, hitX: 200, pxPerSec: 380 },
      cam: { x: 1000, y: 150, w: 880, h: 700 },
      footer: { x: 0, y: 1030, w: 1920, h: 50 },
    };

export const camCenter = () => ({ x: L.cam.x + L.cam.w / 2, y: L.cam.y + L.cam.h / 2 });
