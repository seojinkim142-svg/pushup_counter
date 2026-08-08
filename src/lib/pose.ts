import { KnownPoseLandmarks } from 'react-native-mediapipe';
import { OneEuroFilter } from './oneEuroFilter';

export type Point = { x: number; y: number; score: number };

// BlazePose (MediaPipe Pose Landmarker) always outputs all 33 landmarks, even
// when no person is in frame — it just gives its best (low-confidence)
// guess. A single low threshold lets stray points latch onto
// furniture/background objects, so we require a higher per-point confidence
// AND a minimum number of confident points before treating the frame as
// "a person is here".
export const MIN_KEYPOINT_SCORE = 0.45;
export const MIN_VISIBLE_KEYPOINTS = 14; // out of 33

/** True once enough landmarks clear MIN_KEYPOINT_SCORE to plausibly be a person. */
export function isPersonPresent(points: Point[]): boolean {
  let count = 0;
  for (let i = 0; i < points.length; i++) {
    if (points[i].score > MIN_KEYPOINT_SCORE) count++;
  }
  return count >= MIN_VISIBLE_KEYPOINTS;
}

// Trimmed skeleton: torso, upper arm, forearm, legs only — no face outline,
// and skips BlazePose's finger/hand and foot-index landmarks, which add
// per-frame draw cost without being useful for rep counting.
export const SKELETON_EDGES: Array<[number, number]> = [
  [KnownPoseLandmarks.leftShoulder, KnownPoseLandmarks.rightShoulder],
  [KnownPoseLandmarks.leftShoulder, KnownPoseLandmarks.leftHip],
  [KnownPoseLandmarks.rightShoulder, KnownPoseLandmarks.rightHip],
  [KnownPoseLandmarks.leftHip, KnownPoseLandmarks.rightHip],
  [KnownPoseLandmarks.leftShoulder, KnownPoseLandmarks.leftElbow],
  [KnownPoseLandmarks.leftElbow, KnownPoseLandmarks.leftWrist],
  [KnownPoseLandmarks.rightShoulder, KnownPoseLandmarks.rightElbow],
  [KnownPoseLandmarks.rightElbow, KnownPoseLandmarks.rightWrist],
  [KnownPoseLandmarks.leftHip, KnownPoseLandmarks.leftKnee],
  [KnownPoseLandmarks.leftKnee, KnownPoseLandmarks.leftAnkle],
  [KnownPoseLandmarks.rightHip, KnownPoseLandmarks.rightKnee],
  [KnownPoseLandmarks.rightKnee, KnownPoseLandmarks.rightAnkle],
];

/** Landmark indices actually drawn — used to skip rendering the rest. */
export const VISIBLE_LANDMARK_INDICES: number[] = Array.from(
  new Set(SKELETON_EDGES.flat())
);

export type ExerciseId = 'pushup' | 'squat';

interface BaseExerciseConfig {
  id: ExerciseId;
  label: string;
  downLabel: string;
  upLabel: string;
  /**
   * Extra body-position gate beyond the rep signal, so e.g. standing and
   * just bending your arms doesn't count as a push-up. Returns false when
   * the person is visible but not actually in the exercise position.
   */
  isValidPosture?: (points: Point[]) => boolean;
  /** Hint shown when isValidPosture fails. */
  postureHint?: string;
}

export interface AngleExerciseConfig extends BaseExerciseConfig {
  signal: 'angle';
  /** [proximal, vertex, distal] landmark indices for each side of the body. */
  left: [number, number, number];
  right: [number, number, number];
  /** Angle (degrees) below which the rep counts as "down". */
  downThreshold: number;
  /** Angle (degrees) above which, coming from "down", the rep counts as complete. */
  upThreshold: number;
}

export interface DisplacementExerciseConfig extends BaseExerciseConfig {
  signal: 'verticalDisplacement';
  /** Landmark indices averaged into the tracked vertical position. */
  landmarks: number[];
  /**
   * Extra confirmation checked only at the instant the depth gauge crosses
   * into the green zone — rejects the rep (but keeps the gauge/hysteresis
   * running normally) if it fails, e.g. a half-squat that never really got
   * low enough. Receives (rawLandmarks, screenSpaceLandmarks) since some
   * checks (angles) want raw coordinates and others (Y-position compares)
   * want the rotation-corrected screen-space ones.
   */
  depthConfirm?: (rawPoints: Point[], screenPoints: Point[]) => boolean;
}

export interface SideAngleExerciseConfig extends BaseExerciseConfig {
  signal: 'sideAngle';
  /** [hip, knee, ankle] landmark indices for each leg. */
  left: [number, number, number];
  right: [number, number, number];
}

export type ExerciseConfig = AngleExerciseConfig | DisplacementExerciseConfig | SideAngleExerciseConfig;

// There's no depth sensor to detect "the ground" directly, but a push-up
// keeps the hands planted well below shoulder height for the whole rep
// (unlike standing and just bending your elbows, where a curl-style motion
// brings the wrist up near/above the shoulder at the "bent" position).
// Hips are the more intuitive reference, but push-up camera angles (phone
// propped low, facing the person) very often crop the hips out of frame
// entirely, or drop their confidence below MIN_KEYPOINT_SCORE — shoulders
// stay visible in essentially every framing, so they're the safer signal.
const PUSHUP_WRIST_BELOW_SHOULDER_MARGIN = 0.04;

export function averageVisibleY(points: Point[], indices: number[]): number | null {
  const ys: number[] = [];
  for (const i of indices) {
    if (points[i].score > MIN_KEYPOINT_SCORE) ys.push(points[i].y);
  }
  if (ys.length === 0) return null;
  return ys.reduce((a, b) => a + b, 0) / ys.length;
}

export const EXERCISES: Record<ExerciseId, ExerciseConfig> = {
  pushup: {
    id: 'pushup',
    label: '푸시업',
    // Facing the camera, the upper/forearm point toward/away from the lens,
    // so elbow angle is badly foreshortened and jitters with the lite
    // model's landmark noise. Shoulder height moving down-and-up on screen
    // is a far more stable signal for a front-facing camera.
    signal: 'verticalDisplacement',
    landmarks: [KnownPoseLandmarks.leftShoulder, KnownPoseLandmarks.rightShoulder],
    downLabel: '내려가는 중',
    upLabel: '준비',
    isValidPosture: (points) => {
      const wristY = averageVisibleY(points, [KnownPoseLandmarks.leftWrist, KnownPoseLandmarks.rightWrist]);
      const shoulderY = averageVisibleY(points, [
        KnownPoseLandmarks.leftShoulder,
        KnownPoseLandmarks.rightShoulder,
      ]);
      if (wristY == null || shoulderY == null) return false;
      return wristY > shoulderY + PUSHUP_WRIST_BELOW_SHOULDER_MARGIN;
    },
    postureHint: '손을 바닥에 짚고 엎드린 자세를 잡아주세요',
  },
  squat: {
    id: 'squat',
    label: '스쿼트',
    // Side-on to the camera, knee angle (hip-knee-ankle) isn't foreshortened
    // the way it is head-on, so it's the primary signal here — unlike
    // push-ups/front-view squats where a vertical-position signal wins.
    signal: 'sideAngle',
    left: [KnownPoseLandmarks.leftHip, KnownPoseLandmarks.leftKnee, KnownPoseLandmarks.leftAnkle],
    right: [KnownPoseLandmarks.rightHip, KnownPoseLandmarks.rightKnee, KnownPoseLandmarks.rightAnkle],
    downLabel: '앉는 중',
    upLabel: '준비',
    isValidPosture: (points) => {
      const leftOk = [KnownPoseLandmarks.leftHip, KnownPoseLandmarks.leftKnee, KnownPoseLandmarks.leftAnkle].every(
        (i) => points[i].score > MIN_KEYPOINT_SCORE
      );
      const rightOk = [
        KnownPoseLandmarks.rightHip,
        KnownPoseLandmarks.rightKnee,
        KnownPoseLandmarks.rightAnkle,
      ].every((i) => points[i].score > MIN_KEYPOINT_SCORE);
      return leftOk || rightOk;
    },
    postureHint: '카메라 옆쪽에 서서 엉덩이·무릎·발목이 다 보이게 해주세요',
  },
};

/** Angle at vertex `b`, formed by points a-b-c, in degrees (0-180). */
export function angleDegrees(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number
): number {
  const abX = ax - bx;
  const abY = ay - by;
  const cbX = cx - bx;
  const cbY = cy - by;
  const dot = abX * cbX + abY * cbY;
  const abLen = Math.sqrt(abX * abX + abY * abY);
  const cbLen = Math.sqrt(cbX * cbX + cbY * cbY);
  if (abLen === 0 || cbLen === 0) return 180;
  const cos = Math.max(-1, Math.min(1, dot / (abLen * cbLen)));
  return (Math.acos(cos) * 180) / Math.PI;
}

/**
 * Averages a left/right joint angle, falling back to whichever side is
 * confidently visible. Returns null if neither side has all three
 * landmarks above MIN_KEYPOINT_SCORE.
 */
export function averageAngleForSides(
  points: Point[],
  left: [number, number, number],
  right: [number, number, number]
): number | null {
  const l = points[left[0]];
  const lv = points[left[1]];
  const ld = points[left[2]];
  const r = points[right[0]];
  const rv = points[right[1]];
  const rd = points[right[2]];

  const leftValid =
    l.score > MIN_KEYPOINT_SCORE && lv.score > MIN_KEYPOINT_SCORE && ld.score > MIN_KEYPOINT_SCORE;
  const rightValid =
    r.score > MIN_KEYPOINT_SCORE && rv.score > MIN_KEYPOINT_SCORE && rd.score > MIN_KEYPOINT_SCORE;

  if (leftValid && rightValid) {
    const la = angleDegrees(l.x, l.y, lv.x, lv.y, ld.x, ld.y);
    const ra = angleDegrees(r.x, r.y, rv.x, rv.y, rd.x, rd.y);
    return (la + ra) / 2;
  }
  if (leftValid) return angleDegrees(l.x, l.y, lv.x, lv.y, ld.x, ld.y);
  if (rightValid) return angleDegrees(r.x, r.y, rv.x, rv.y, rd.x, rd.y);
  return null;
}

export function averageJointAngle(points: Point[], config: AngleExerciseConfig): number | null {
  return averageAngleForSides(points, config.left, config.right);
}

/**
 * Maps a joint angle to a 0-1 depth gauge: 0 at upThreshold (fully
 * extended/"up") and 1 at downThreshold (fully bent/"down" — the target
 * depth for a rep). Clamped, so overshooting either end doesn't run off
 * the gauge.
 */
export function angleToProgress(angle: number, config: AngleExerciseConfig): number {
  const { upThreshold, downThreshold } = config;
  const raw = (upThreshold - angle) / (upThreshold - downThreshold);
  return Math.max(0, Math.min(1, raw));
}

// Below this, a small shift-in-place or camera shake is enough to "open"
// calibration, after which ordinary landmark jitter can cross the 70%/30%
// zones on its own and rack up false reps. 0.08 (8% of screen height) is
// comfortably smaller than a real rep's travel but big enough that noise
// alone won't reach it.
const MIN_CALIBRATION_RANGE = 0.08; // normalized screen-height units
const DOWN_NORM_THRESHOLD = 0.7;
const UP_NORM_THRESHOLD = 0.3;
// Floor on time between counted reps — guards against a single noisy frame
// (a landmark jump that clears both zones almost instantly) registering as a
// full rep. Comfortably faster than any real push-up/squat cadence.
const MIN_REP_INTERVAL_MS = 400;

export type RepUpdate = { progress: number; stage: 'up' | 'down'; justCounted: boolean };

/**
 * Rep counter driven by a smoothed, self-calibrating vertical position
 * instead of a joint angle. There's no way to know up front how far down a
 * given person's shoulder/hip moves at their distance from the camera, so
 * instead of a fixed pixel threshold this tracks the observed min/max range
 * and counts a rep once the signal crosses 70%/30% of that range — the
 * range keeps widening as bigger reps are observed, so it self-calibrates
 * over the first rep or two rather than needing an explicit calibration step.
 *
 * Counting happens on the "red → green" transition (reaching full depth),
 * not on the way back up: from `up`, crossing into the green zone counts
 * the rep and moves to `down`; the counter then has to see the signal climb
 * back past the red-zone edge (back to `up`) before the next green-zone
 * crossing can count again — so a rep is exactly one red→green→red cycle.
 */
export class VerticalRepCounter {
  private filter: OneEuroFilter;
  private minY = Infinity;
  private maxY = -Infinity;
  private lastCountTimestamp = -Infinity;
  stage: 'up' | 'down' = 'up';
  count = 0;

  constructor(minCutoff = 1.2, beta = 0.4, dCutoff = 1.0) {
    this.filter = new OneEuroFilter(minCutoff, beta, dCutoff);
  }

  reset(): void {
    this.filter.reset();
    this.minY = Infinity;
    this.maxY = -Infinity;
    this.lastCountTimestamp = -Infinity;
    this.stage = 'up';
    this.count = 0;
  }

  /**
   * Feed one frame's raw (unfiltered) vertical position.
   * @param confirmDown extra check applied only at the instant of crossing
   * into the green zone — if false, the stage still flips to `down` (so
   * hysteresis stays correct) but the rep isn't counted.
   */
  update(rawY: number, timestampMs: number, confirmDown = true): RepUpdate | null {
    const y = this.filter.filter(rawY, timestampMs);

    if (y < this.minY) this.minY = y;
    if (y > this.maxY) this.maxY = y;

    const range = this.maxY - this.minY;
    if (range < MIN_CALIBRATION_RANGE) return null;

    const norm = Math.max(0, Math.min(1, (y - this.minY) / range));
    let justCounted = false;

    if (norm > DOWN_NORM_THRESHOLD && this.stage === 'up') {
      this.stage = 'down';
      if (confirmDown && timestampMs - this.lastCountTimestamp >= MIN_REP_INTERVAL_MS) {
        this.count += 1;
        this.lastCountTimestamp = timestampMs;
        justCounted = true;
      }
    } else if (norm < UP_NORM_THRESHOLD && this.stage === 'down') {
      this.stage = 'up';
    }

    return { progress: norm, stage: this.stage, justCounted };
  }
}

/**
 * Rep counter for the fixed-threshold `angle` signal — smooths the joint
 * angle with a One-Euro filter and applies the same MIN_REP_INTERVAL_MS
 * debounce as VerticalRepCounter/SideAngleRepCounter, so an exercise added
 * with this signal gets the same jitter/false-positive protections instead
 * of comparing a raw per-frame angle straight against the threshold.
 */
export class AngleRepCounter {
  private filter: OneEuroFilter;
  private lastCountTimestamp = -Infinity;
  stage: 'up' | 'down' = 'up';
  count = 0;

  constructor(minCutoff = 1.2, beta = 0.4, dCutoff = 1.0) {
    this.filter = new OneEuroFilter(minCutoff, beta, dCutoff);
  }

  reset(): void {
    this.filter.reset();
    this.lastCountTimestamp = -Infinity;
    this.stage = 'up';
    this.count = 0;
  }

  update(rawAngle: number, timestampMs: number, config: AngleExerciseConfig): RepUpdate {
    const angle = this.filter.filter(rawAngle, timestampMs);
    const progress = angleToProgress(angle, config);
    let justCounted = false;

    if (angle < config.downThreshold && this.stage === 'up') {
      this.stage = 'down';
      if (timestampMs - this.lastCountTimestamp >= MIN_REP_INTERVAL_MS) {
        this.count += 1;
        this.lastCountTimestamp = timestampMs;
        justCounted = true;
      }
    } else if (angle > config.upThreshold && this.stage === 'down') {
      this.stage = 'up';
    }

    return { progress, stage: this.stage, justCounted };
  }
}

type LegTriple = { hip: Point; knee: Point; ankle: Point };
export type AngleRepUpdate = { angle: number; progress: number; stage: 'up' | 'down'; justCounted: boolean };

// Fixed fallback thresholds (degrees) used until enough angle range has been
// observed to trust dynamic calibration.
const SIDE_ANGLE_DOWN_FALLBACK = 100;
const SIDE_ANGLE_UP_FALLBACK = 160;
const SIDE_ANGLE_DEPTH_FALLBACK = 90;
const SIDE_ANGLE_MIN_CALIBRATION_RANGE = 20; // degrees
const SIDE_ANGLE_DOWN_FRACTION = 0.3; // from the straight/top end
const SIDE_ANGLE_UP_FRACTION = 0.15;
const SIDE_ANGLE_DEPTH_FRACTION = 0.15; // from the bent/bottom end
// Only switch which leg is tracked if the other side's visibility clears the
// currently-tracked side's by this much — otherwise near-equal frame-to-frame
// scores flip the selected side back and forth, resetting the angle filters
// (see the reset below) on every flip and making the angle signal jumpy.
const SIDE_SWITCH_MARGIN = 0.15;

/**
 * Rep counter for a side-on camera view, driven by knee (hip-knee-ankle)
 * angle instead of vertical position — from the side, the thigh/shin don't
 * foreshorten toward the lens the way an elbow does facing the camera, so
 * angle is the stable signal here (the opposite of the push-up/front-squat
 * case). Every frame it picks whichever leg (left/right) is more visible —
 * from the side, the far leg is partly self-occluded — so it auto-adapts to
 * whichever way the person is facing without needing to be told.
 *
 * Counts on the classic down→up transition (squat back to standing), and
 * only if the knee angle actually reached full depth at some point during
 * the descent — otherwise a half-squat still moves the gauge but doesn't
 * count.
 */
export class SideAngleRepCounter {
  private filters: Record<'hipX' | 'hipY' | 'kneeX' | 'kneeY' | 'ankleX' | 'ankleY', OneEuroFilter>;
  private selectedSide: 'left' | 'right' | null = null;
  private minAngleSeen = Infinity;
  private maxAngleSeen = -Infinity;
  private minAngleThisRep = Infinity;
  private lastCountTimestamp = -Infinity;
  stage: 'up' | 'down' = 'up';
  count = 0;

  constructor(minCutoff = 1.2, beta = 0.4, dCutoff = 1.0) {
    this.filters = {
      hipX: new OneEuroFilter(minCutoff, beta, dCutoff),
      hipY: new OneEuroFilter(minCutoff, beta, dCutoff),
      kneeX: new OneEuroFilter(minCutoff, beta, dCutoff),
      kneeY: new OneEuroFilter(minCutoff, beta, dCutoff),
      ankleX: new OneEuroFilter(minCutoff, beta, dCutoff),
      ankleY: new OneEuroFilter(minCutoff, beta, dCutoff),
    };
  }

  reset(): void {
    for (const f of Object.values(this.filters)) f.reset();
    this.selectedSide = null;
    this.minAngleSeen = Infinity;
    this.maxAngleSeen = -Infinity;
    this.minAngleThisRep = Infinity;
    this.lastCountTimestamp = -Infinity;
    this.stage = 'up';
    this.count = 0;
  }

  /** Raw (rotation-doesn't-matter) hip/knee/ankle landmarks for each leg. */
  update(left: LegTriple, right: LegTriple, timestampMs: number): AngleRepUpdate | null {
    const leftVis = Math.min(left.hip.score, left.knee.score, left.ankle.score);
    const rightVis = Math.min(right.hip.score, right.knee.score, right.ankle.score);

    let side: 'left' | 'right';
    if (this.selectedSide === 'left' && leftVis >= rightVis - SIDE_SWITCH_MARGIN) {
      side = 'left';
    } else if (this.selectedSide === 'right' && rightVis >= leftVis - SIDE_SWITCH_MARGIN) {
      side = 'right';
    } else {
      side = leftVis >= rightVis ? 'left' : 'right';
    }
    const chosen = side === 'left' ? left : right;
    const chosenVis = side === 'left' ? leftVis : rightVis;

    if (chosenVis < MIN_KEYPOINT_SCORE) return null;

    if (side !== this.selectedSide) {
      // Switched which leg we're tracking — reset filters so stale state
      // from the other leg doesn't leak into the newly selected one.
      for (const f of Object.values(this.filters)) f.reset();
      this.selectedSide = side;
    }

    const hipX = this.filters.hipX.filter(chosen.hip.x, timestampMs);
    const hipY = this.filters.hipY.filter(chosen.hip.y, timestampMs);
    const kneeX = this.filters.kneeX.filter(chosen.knee.x, timestampMs);
    const kneeY = this.filters.kneeY.filter(chosen.knee.y, timestampMs);
    const ankleX = this.filters.ankleX.filter(chosen.ankle.x, timestampMs);
    const ankleY = this.filters.ankleY.filter(chosen.ankle.y, timestampMs);

    const angle = angleDegrees(hipX, hipY, kneeX, kneeY, ankleX, ankleY);

    if (angle < this.minAngleSeen) this.minAngleSeen = angle;
    if (angle > this.maxAngleSeen) this.maxAngleSeen = angle;
    const range = this.maxAngleSeen - this.minAngleSeen;

    let downThreshold = SIDE_ANGLE_DOWN_FALLBACK;
    let upThreshold = SIDE_ANGLE_UP_FALLBACK;
    let depthThreshold = SIDE_ANGLE_DEPTH_FALLBACK;
    if (range >= SIDE_ANGLE_MIN_CALIBRATION_RANGE) {
      downThreshold = this.maxAngleSeen - SIDE_ANGLE_DOWN_FRACTION * range;
      upThreshold = this.maxAngleSeen - SIDE_ANGLE_UP_FRACTION * range;
      depthThreshold = this.minAngleSeen + SIDE_ANGLE_DEPTH_FRACTION * range;
    }

    let justCounted = false;

    if (angle < downThreshold && this.stage === 'up') {
      this.stage = 'down';
      this.minAngleThisRep = angle;
    } else if (this.stage === 'down') {
      if (angle < this.minAngleThisRep) this.minAngleThisRep = angle;
      if (angle > upThreshold) {
        this.stage = 'up';
        if (
          this.minAngleThisRep <= depthThreshold &&
          timestampMs - this.lastCountTimestamp >= MIN_REP_INTERVAL_MS
        ) {
          this.count += 1;
          this.lastCountTimestamp = timestampMs;
          justCounted = true;
        }
      }
    }

    const progress = Math.max(0, Math.min(1, (upThreshold - angle) / (upThreshold - downThreshold)));

    return { angle, progress, stage: this.stage, justCounted };
  }
}
