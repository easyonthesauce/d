import {
  FilesetResolver,
  FaceLandmarker,
  GestureRecognizer,
  ImageEmbedder,
  PoseLandmarker,
  type NormalizedLandmark,
} from '@mediapipe/tasks-vision';

const WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.0/wasm';
const MODELS = 'https://storage.googleapis.com/mediapipe-models';

export type Landmarks = NormalizedLandmark[];

export interface PoseFrame {
  /** mirrored (selfie view) landmarks, x/y in 0..1 of the video frame */
  landmarks: Landmarks | null;
  t: number;
}

/**
 * Owns the webcam and every MediaPipe task. Pose runs every frame; face and
 * gesture only run when someone asks, so the TV box doesn't melt.
 */
export class Vision {
  readonly video = document.createElement('video');
  pose!: PoseLandmarker;
  face!: FaceLandmarker;
  gesture: GestureRecognizer | null = null;
  embedder!: ImageEmbedder;
  latest: PoseFrame = { landmarks: null, t: 0 };
  latestGesture: { name: string; score: number; t: number } | null = null;
  wantGestures = false;
  private lastVideoTime = -1;
  private crop = document.createElement('canvas');

  async init(onStatus: (s: string) => void) {
    onStatus('Waking up the camera…');
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
      audio: false,
    });
    this.video.srcObject = stream;
    this.video.muted = true;
    this.video.playsInline = true;
    await this.video.play();

    onStatus('Loading pose brain…');
    const fileset = await FilesetResolver.forVisionTasks(WASM);
    // ?cpu forces the CPU delegate; otherwise try GPU and fall back.
    let delegate: 'GPU' | 'CPU' = new URLSearchParams(location.search).has('cpu') ? 'CPU' : 'GPU';
    const poseOpts = (d: 'GPU' | 'CPU') => ({
      baseOptions: { modelAssetPath: `${MODELS}/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task`, delegate: d },
      runningMode: 'VIDEO' as const,
      numPoses: 1,
      minPoseDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
    try {
      this.pose = await PoseLandmarker.createFromOptions(fileset, poseOpts(delegate));
    } catch (e) {
      if (delegate === 'CPU') throw e;
      console.warn('GPU delegate failed, using CPU', e);
      delegate = 'CPU';
      this.pose = await PoseLandmarker.createFromOptions(fileset, poseOpts(delegate));
    }
    onStatus('Loading face recognition…');
    this.face = await FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: `${MODELS}/face_landmarker/face_landmarker/float16/1/face_landmarker.task`, delegate },
      runningMode: 'VIDEO',
      numFaces: 1,
    });
    this.embedder = await ImageEmbedder.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: `${MODELS}/image_embedder/mobilenet_v3_small/float32/1/mobilenet_v3_small.tflite` },
      runningMode: 'IMAGE',
      l2Normalize: true,
    });
    onStatus('Loading gesture recognizer…');
    try {
      this.gesture = await GestureRecognizer.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: `${MODELS}/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task`, delegate },
        runningMode: 'VIDEO',
        numHands: 2,
      });
    } catch (e) {
      console.warn('gesture recognizer unavailable', e);
    }
  }

  get ready() {
    return this.video.readyState >= 2 && !!this.pose;
  }

  private frameNo = 0;

  /** Run pose (and gestures if wanted) on the newest camera frame. */
  tick(now: number) {
    if (!this.ready || this.video.currentTime === this.lastVideoTime) return;
    this.lastVideoTime = this.video.currentTime;
    this.frameNo++;
    const res = this.pose.detectForVideo(this.video, now);
    const lm = res.landmarks[0];
    this.latest = { landmarks: lm ? lm.map((p) => ({ ...p, x: 1 - p.x })) : null, t: now };

    if (this.wantGestures && this.gesture && this.frameNo % 2 === 0) {
      const g = this.gesture.recognizeForVideo(this.video, now);
      let best: { name: string; score: number } | null = null;
      for (const hand of g.gestures) {
        const c = hand[0];
        if (c && c.categoryName !== 'None' && (!best || c.score > best.score)) best = { name: c.categoryName, score: c.score };
      }
      if (best) this.latestGesture = { ...best, t: now };
    }
  }

  /**
   * Snapshot of whoever is in front of the camera: geometry signature,
   * appearance embedding and a square avatar crop.
   */
  captureFace(now: number): { geometry: number[]; embedding: number[]; avatar: string } | null {
    if (!this.ready) return null;
    const res = this.face.detectForVideo(this.video, now);
    const lm = res.faceLandmarks[0];
    if (!lm) return null;
    const geometry = faceGeometry(lm);

    const vw = this.video.videoWidth, vh = this.video.videoHeight;
    let minX = 1, minY = 1, maxX = 0, maxY = 0;
    for (const p of lm) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    }
    const cx = ((minX + maxX) / 2) * vw, cy = ((minY + maxY) / 2) * vh;
    const size = Math.max((maxX - minX) * vw, (maxY - minY) * vh) * 1.5;
    this.crop.width = this.crop.height = 256;
    const g = this.crop.getContext('2d')!;
    g.save();
    g.translate(256, 0);
    g.scale(-1, 1); // mirror, like the on-screen preview
    g.drawImage(this.video, cx - size / 2, cy - size / 2, size, size, 0, 0, 256, 256);
    g.restore();
    const emb = this.embedder.embed(this.crop).embeddings[0];
    const embedding = emb?.floatEmbedding ? Array.from(emb.floatEmbedding) : [];
    return { geometry, embedding, avatar: this.crop.toDataURL('image/jpeg', 0.85) };
  }
}

/**
 * Scale-invariant face shape signature: distances between stable landmarks
 * normalised by inter-ocular distance. Crude, but fine for telling a
 * household's worth of dancers apart.
 */
const KEY_POINTS = [33, 263, 1, 61, 291, 199, 10, 152, 234, 454, 70, 300, 168, 6, 13, 14, 133, 362, 98, 327];
function faceGeometry(lm: Landmarks): number[] {
  const iod = Math.hypot(lm[33].x - lm[263].x, lm[33].y - lm[263].y, lm[33].z - lm[263].z) || 1;
  const out: number[] = [];
  for (let i = 0; i < KEY_POINTS.length; i++) {
    for (let j = i + 1; j < KEY_POINTS.length; j++) {
      const a = lm[KEY_POINTS[i]], b = lm[KEY_POINTS[j]];
      out.push(Math.hypot(a.x - b.x, a.y - b.y) / iod);
    }
  }
  return out;
}

export function cosine(a: number[], b: number[]): number {
  if (!a.length || a.length !== b.length) return 0;
  let d = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return d / (Math.sqrt(na * nb) || 1);
}

/** Similarity 0..1 between two face geometry vectors. */
export function geometrySimilarity(a: number[], b: number[]): number {
  if (!a.length || a.length !== b.length) return 0;
  let err = 0;
  for (let i = 0; i < a.length; i++) err += Math.abs(a[i] - b[i]) / Math.max(0.05, (a[i] + b[i]) / 2);
  return Math.max(0, 1 - (err / a.length) * 4);
}
