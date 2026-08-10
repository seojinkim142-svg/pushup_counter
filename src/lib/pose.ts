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

export type ExerciseId = 'pushup' | 'squat' | 'jumpingJack' | 'armCurlTest';

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
   * If set, the tracked value becomes avg(landmarks.y) - avg(referenceLandmarks.y)
   * instead of the raw landmark position — a relative offset between two
   * body points, immune to the whole body translating up/down on screen
   * (moving closer to/further from the camera, standing vs. already being
   * roughly in position, camera shake). Only the *relative* motion between
   * the two point sets — e.g. elbow bending relative to the shoulder —
   * moves the signal, so incidental whole-body movement can't get mistaken
   * for rep progress or inflate the calibrated range the way it can with a
   * single landmark's raw position.
   */
  referenceLandmarks?: number[];
  /**
   * Overrides VerticalRepCounter's default calibration-range floor for this
   * exercise's signal. Needed when the signal's real full-rep amplitude
   * (e.g. a relative offset between two nearby points) is much smaller than
   * the default threshold was tuned for (an absolute landmark position) —
   * without this, real reps could never accumulate enough range to finish
   * calibrating at all.
   */
  minCalibrationRange?: number;
  /**
   * Extra per-frame condition, evaluated every frame (not just at the
   * counting instant) and OR'd by VerticalRepCounter across the whole "up"
   * phase — the rep is only counted if this was true at some point during
   * that phase, so a secondary signal that doesn't peak on the exact same
   * frame as the primary one (e.g. legs spreading vs. wrists reaching the
   * top for a jumping jack) still gets picked up. Receives
   * (rawLandmarks, screenSpaceLandmarks) since some checks (angles) want raw
   * coordinates and others (position/distance compares) want the
   * rotation-corrected screen-space ones.
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

// Standing and just bending down/swinging arms (warming up) can momentarily
// satisfy "wrist below shoulder" too, without being anywhere near a plank —
// so when hips are visible, also require the torso to look roughly
// horizontal (prone) rather than upright: standing has a large shoulder-hip
// vertical span relative to shoulder width (~2.5x+ in practice), while a
// low-camera plank view keeps that span comparatively small. Skipped when
// hips aren't confidently visible (common for push-up framings), same as
// the vertical-displacement signal falling back to shoulders-only.
const PUSHUP_TORSO_UPRIGHT_RATIO = 2.0;

export function averageVisibleY(points: Point[], indices: number[]): number | null {
  const ys: number[] = [];
  for (const i of indices) {
    if (points[i].score > MIN_KEYPOINT_SCORE) ys.push(points[i].y);
  }
  if (ys.length === 0) return null;
  return ys.reduce((a, b) => a + b, 0) / ys.length;
}

/**
 * Like averageVisibleY, but relative to a second landmark set when
 * `referenceLandmarks` is given — see DisplacementExerciseConfig.referenceLandmarks
 * for why. Returns null if either side isn't confidently visible.
 */
export function relativeVisibleY(
  points: Point[],
  landmarks: number[],
  referenceLandmarks?: number[]
): number | null {
  const y = averageVisibleY(points, landmarks);
  if (y == null) return null;
  if (!referenceLandmarks) return y;
  const refY = averageVisibleY(points, referenceLandmarks);
  if (refY == null) return null;
  return y - refY;
}

// Ankle spread wider than this multiple of shoulder width counts as "legs
// open" for a jumping jack. Normalized by shoulder width (rather than a
// fixed distance) so it doesn't depend on how far the person is from the
// camera.
export const JUMPING_JACK_SPREAD_RATIO = 1.4;

/**
 * Ratio of ankle horizontal distance to shoulder width, in screen-space
 * (rotation-corrected) coordinates — a distance ratio needs "left/right on
 * screen", not raw sensor-space x/y. Returns null if any of the four
 * landmarks isn't confidently visible (e.g. one leg stepped out of frame),
 * in which case callers should treat leg-spread as unknown rather than
 * false, so a person the camera can't fully see isn't penalized.
 */
export function ankleSpreadRatio(screenPoints: Point[]): number | null {
  const leftAnkle = screenPoints[KnownPoseLandmarks.leftAnkle];
  const rightAnkle = screenPoints[KnownPoseLandmarks.rightAnkle];
  const leftShoulder = screenPoints[KnownPoseLandmarks.leftShoulder];
  const rightShoulder = screenPoints[KnownPoseLandmarks.rightShoulder];
  if (
    leftAnkle.score <= MIN_KEYPOINT_SCORE ||
    rightAnkle.score <= MIN_KEYPOINT_SCORE ||
    leftShoulder.score <= MIN_KEYPOINT_SCORE ||
    rightShoulder.score <= MIN_KEYPOINT_SCORE
  ) {
    return null;
  }
  const shoulderWidth = Math.abs(leftShoulder.x - rightShoulder.x);
  if (shoulderWidth < 1e-6) return null;
  return Math.abs(leftAnkle.x - rightAnkle.x) / shoulderWidth;
}

export const EXERCISES: Record<ExerciseId, ExerciseConfig> = {
  pushup: {
    id: 'pushup',
    label: '푸시업',
    // Facing the camera, the upper/forearm point toward/away from the lens,
    // so elbow *angle* is badly foreshortened and jitters with the lite
    // model's landmark noise — but elbow height *relative to the shoulder*
    // doesn't have that problem and, unlike tracking shoulder position
    // outright, is immune to the whole body translating on screen. On-device
    // this signal's real range runs roughly 0.03-0.12 (much smaller than
    // shoulder position's), well under the default MIN_CALIBRATION_RANGE
    // (0.08, tuned for the old signal) — minCalibrationRange below scales
    // it down to match, or full reps would never finish calibrating.
    signal: 'verticalDisplacement',
    landmarks: [KnownPoseLandmarks.leftElbow, KnownPoseLandmarks.rightElbow],
    referenceLandmarks: [KnownPoseLandmarks.leftShoulder, KnownPoseLandmarks.rightShoulder],
    minCalibrationRange: 0.025,
    downLabel: '내려가는 중',
    upLabel: '준비',
    isValidPosture: (points) => {
      const wristY = averageVisibleY(points, [KnownPoseLandmarks.leftWrist, KnownPoseLandmarks.rightWrist]);
      const shoulderY = averageVisibleY(points, [
        KnownPoseLandmarks.leftShoulder,
        KnownPoseLandmarks.rightShoulder,
      ]);
      if (wristY == null || shoulderY == null) return false;
      if (wristY <= shoulderY + PUSHUP_WRIST_BELOW_SHOULDER_MARGIN) return false;

      const hipY = averageVisibleY(points, [KnownPoseLandmarks.leftHip, KnownPoseLandmarks.rightHip]);
      if (hipY != null) {
        const leftShoulder = points[KnownPoseLandmarks.leftShoulder];
        const rightShoulder = points[KnownPoseLandmarks.rightShoulder];
        if (leftShoulder.score > MIN_KEYPOINT_SCORE && rightShoulder.score > MIN_KEYPOINT_SCORE) {
          const shoulderWidth = Math.abs(leftShoulder.x - rightShoulder.x);
          const torsoVerticalSpan = Math.abs(shoulderY - hipY);
          if (shoulderWidth > 1e-6 && torsoVerticalSpan / shoulderWidth > PUSHUP_TORSO_UPRIGHT_RATIO) {
            return false; // torso looks upright/standing, not prone
          }
        }
      }
      return true;
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
  jumpingJack: {
    id: 'jumpingJack',
    label: '팔벌려뛰기',
    // Facing the camera, the wrists travel a huge vertical distance —
    // sides-down at rest to overhead at the peak — making them a much
    // stronger front-view signal than the shoulders (used for push-ups),
    // and unlike an elbow/knee angle there's no foreshortening concern
    // since it's a position signal, not an angle.
    signal: 'verticalDisplacement',
    landmarks: [KnownPoseLandmarks.leftWrist, KnownPoseLandmarks.rightWrist],
    // Resting between reps is arms-down (large wrist Y, the counter's
    // "down" stage), unlike push-ups/squats where the rest position is the
    // "up" stage — so the label mapping is flipped relative to those.
    downLabel: '준비',
    upLabel: '점프!',
    isValidPosture: (points) => {
      const shoulderY = averageVisibleY(points, [
        KnownPoseLandmarks.leftShoulder,
        KnownPoseLandmarks.rightShoulder,
      ]);
      const hipY = averageVisibleY(points, [KnownPoseLandmarks.leftHip, KnownPoseLandmarks.rightHip]);
      // Rough "standing and facing the camera" check — shoulders need to be
      // above hips on screen, which fails if the person is lying down, bent
      // over, or the camera is at a strange angle.
      if (shoulderY == null || hipY == null) return false;
      return shoulderY < hipY;
    },
    // Arms alone can't tell a jumping jack from someone just waving their
    // arms overhead while standing still — legs spreading is the other half
    // of the motion. Checked every frame (not just at the wrist-signal's
    // down-crossing) and OR'd across the rep by VerticalRepCounter, so it
    // doesn't matter that leg-spread doesn't peak on the exact same frame as
    // the wrists reaching the top. Unmeasurable (ankles/shoulders not
    // visible) defaults to true rather than rejecting the rep outright.
    depthConfirm: (_rawPoints, screenPoints) => {
      const ratio = ankleSpreadRatio(screenPoints);
      return ratio == null || ratio > JUMPING_JACK_SPREAD_RATIO;
    },
    postureHint: '카메라를 정면으로 보고 전신이 화면에 들어오게 서주세요',
  },
  // Temporary tuning aid, not a real workout mode: counts a standing arm
  // curl (shoulder-elbow-wrist angle) instead of a push-up/squat, so the
  // counting pipeline (calibration, hysteresis, debounce, gauge) can be
  // sanity-checked by just bending an arm while standing — no repeated
  // getting down on the floor needed. Exercises the AngleRepCounter path,
  // which push-up/squat don't currently use.
  armCurlTest: {
    id: 'armCurlTest',
    label: '테스트(팔)',
    signal: 'angle',
    left: [KnownPoseLandmarks.leftShoulder, KnownPoseLandmarks.leftElbow, KnownPoseLandmarks.leftWrist],
    right: [KnownPoseLandmarks.rightShoulder, KnownPoseLandmarks.rightElbow, KnownPoseLandmarks.rightWrist],
    downThreshold: 90,
    upThreshold: 150,
    downLabel: '굽히는 중',
    upLabel: '펴짐',
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
// A small minCalibrationRange (for low-amplitude signals) can be spanned by
// as few as two sparse/unrepresentative frames — this requires calibration
// to also see at least this many frames before it can "lock in", so the
// observed min/max have had a real chance to visit the signal's true
// extremes rather than whatever the first couple of frames happened to be.
const MIN_CALIBRATION_SAMPLES = 10;
const DOWN_NORM_THRESHOLD = 0.7;
const UP_NORM_THRESHOLD = 0.3;
// Floor on time between counted reps — guards against a single noisy frame
// (a landmark jump that clears both zones almost instantly) registering as a
// full rep. Comfortably faster than any real push-up/squat cadence.
const MIN_REP_INTERVAL_MS = 400;
// Only switch which side (left/right limb) is tracked if the other side's
// visibility clears the currently-tracked side's by this much — otherwise
// near-equal frame-to-frame scores flip the selected side back and forth,
// resetting the angle filter on every flip and making the signal jumpy.
// Also what makes single-limb use (e.g. only one arm in frame) stable: once
// a side is locked in, a briefly-glimpsed/noisy other side won't steal it.
const SIDE_SWITCH_MARGIN = 0.15;

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
  // Whether `auxValid` was true at any point during the current "up" (away
  // from rest) phase — not just on the single frame the down-crossing
  // happens to land on. A secondary signal (e.g. legs spread, for jumping
  // jacks) rarely peaks on the exact same frame as the primary one, so
  // requiring it only at the crossing instant would miss valid reps.
  private auxConfirmedThisRep = true;
  private minCalibrationRange: number;
  // Frames seen since the last reset/recalibrate. A small minCalibrationRange
  // (needed for low-amplitude signals) means as few as two noisy/unrepresentative
  // frames can span it by coincidence — requiring a minimum sample count too
  // means calibration can't "lock in" off a couple of sparse points before the
  // signal has had a real chance to visit its true extremes.
  private samplesSeen = 0;
  // Set by seedReference(): "rest" position captured deliberately rather
  // than inferred from organic min/max. Which *direction* real rep motion
  // moves the raw signal from here isn't knowable in advance (depends on
  // camera angle, body proportions, exactly how the reference was posed) —
  // tracking deviation in both directions instead of assuming "up" means
  // the rest position is always norm 0 and the furthest point reached is
  // always norm 1, regardless of which way the signal actually moves.
  private referenceY: number | null = null;
  private maxDeviation = 0;
  stage: 'up' | 'down' = 'up';
  count = 0;

  constructor(minCutoff = 1.2, beta = 0.4, dCutoff = 1.0, minCalibrationRange = MIN_CALIBRATION_RANGE) {
    this.filter = new OneEuroFilter(minCutoff, beta, dCutoff);
    this.minCalibrationRange = minCalibrationRange;
  }

  reset(): void {
    this.filter.reset();
    this.minY = Infinity;
    this.maxY = -Infinity;
    this.lastCountTimestamp = -Infinity;
    this.auxConfirmedThisRep = true;
    this.samplesSeen = 0;
    this.referenceY = null;
    this.maxDeviation = 0;
    this.stage = 'up';
    this.count = 0;
  }

  /**
   * Like reset(), but keeps `count` — for "just settled into position"
   * transitions (e.g. isValidPosture going false → true), where whatever
   * range got calibrated *before* the person was actually in position
   * (standing, warming up, getting set up) shouldn't carry over: a wide
   * swing during that transition can make the calibrated range wider than
   * a real rep's travel, so real reps then fall short of the down
   * threshold, or — conversely — a small settling motion right after
   * transitioning can look like a full rep against a range that hasn't
   * calibrated yet. Falls back to organic min/max tracking (referenceY
   * cleared) — there's no new deliberate reference to seed here.
   */
  recalibrate(): void {
    this.filter.reset();
    this.minY = Infinity;
    this.maxY = -Infinity;
    this.lastCountTimestamp = -Infinity;
    this.auxConfirmedThisRep = true;
    this.samplesSeen = 0;
    this.referenceY = null;
    this.maxDeviation = 0;
    this.stage = 'up';
  }

  /**
   * Anchors calibration at a deliberately-captured reference value (e.g.
   * held for a few seconds at the top of the rep before tracking starts)
   * instead of letting the range emerge from whatever the first few organic
   * frames happen to be — organic tracking can complete off just a couple
   * of unrepresentative frames once MIN_CALIBRATION_SAMPLES is satisfied,
   * which is exactly the failure mode a deliberate reference point is meant
   * to avoid. Switches update() into deviation-from-reference mode (see
   * `referenceY`) rather than min/max mode.
   */
  seedReference(value: number): void {
    this.filter.reset();
    this.referenceY = value;
    this.maxDeviation = 0;
    this.lastCountTimestamp = -Infinity;
    this.auxConfirmedThisRep = true;
    this.samplesSeen = 0;
    this.stage = 'up';
  }

  /**
   * Feed one frame's raw (unfiltered) vertical position.
   * @param auxValid secondary per-frame condition (e.g. "legs currently
   * spread") — true whenever the exercise doesn't need one. OR'd across every
   * frame of the current "up" phase; the rep only counts if it was true at
   * least once during that phase, checked when the down-crossing happens.
   */
  update(rawY: number, timestampMs: number, auxValid = true): RepUpdate | null {
    const y = this.filter.filter(rawY, timestampMs);
    this.samplesSeen += 1;

    let norm: number;
    if (this.referenceY != null) {
      // Deviation-from-reference mode (see seedReference): direction-agnostic —
      // moving further from the reference in *either* direction raises norm.
      const deviation = Math.abs(y - this.referenceY);
      if (deviation > this.maxDeviation) this.maxDeviation = deviation;
      if (this.maxDeviation < this.minCalibrationRange || this.samplesSeen < MIN_CALIBRATION_SAMPLES) {
        return null;
      }
      norm = Math.max(0, Math.min(1, deviation / this.maxDeviation));
    } else {
      if (y < this.minY) this.minY = y;
      if (y > this.maxY) this.maxY = y;
      const range = this.maxY - this.minY;
      if (range < this.minCalibrationRange || this.samplesSeen < MIN_CALIBRATION_SAMPLES) return null;
      norm = Math.max(0, Math.min(1, (y - this.minY) / range));
    }

    if (this.stage === 'up' && auxValid) this.auxConfirmedThisRep = true;

    let justCounted = false;

    if (norm > DOWN_NORM_THRESHOLD && this.stage === 'up') {
      this.stage = 'down';
      if (this.auxConfirmedThisRep && timestampMs - this.lastCountTimestamp >= MIN_REP_INTERVAL_MS) {
        this.count += 1;
        this.lastCountTimestamp = timestampMs;
        justCounted = true;
      }
    } else if (norm < UP_NORM_THRESHOLD && this.stage === 'down') {
      this.stage = 'up';
      this.auxConfirmedThisRep = auxValid;
    }

    return { progress: norm, stage: this.stage, justCounted };
  }
}

export type AngleTriple = { proximal: Point; vertex: Point; distal: Point };

/**
 * Rep counter for the fixed-threshold `angle` signal — smooths the joint
 * angle with a One-Euro filter and applies the same MIN_REP_INTERVAL_MS
 * debounce as VerticalRepCounter/SideAngleRepCounter.
 *
 * Tracks a single side (left or right limb) rather than averaging both, with
 * the same sticky side-selection as SideAngleRepCounter: only one limb needs
 * to be in frame and moving (e.g. a one-arm curl) to drive the count. If both
 * sides happened to be visible and averaged instead, a stationary second limb
 * would dilute the signal and could keep it from ever reaching the threshold.
 */
export class AngleRepCounter {
  private filter: OneEuroFilter;
  private selectedSide: 'left' | 'right' | null = null;
  private lastCountTimestamp = -Infinity;
  stage: 'up' | 'down' = 'up';
  count = 0;

  constructor(minCutoff = 1.2, beta = 0.4, dCutoff = 1.0) {
    this.filter = new OneEuroFilter(minCutoff, beta, dCutoff);
  }

  reset(): void {
    this.filter.reset();
    this.selectedSide = null;
    this.lastCountTimestamp = -Infinity;
    this.stage = 'up';
    this.count = 0;
  }

  update(
    left: AngleTriple,
    right: AngleTriple,
    timestampMs: number,
    config: AngleExerciseConfig
  ): AngleRepUpdate | null {
    const leftVis = Math.min(left.proximal.score, left.vertex.score, left.distal.score);
    const rightVis = Math.min(right.proximal.score, right.vertex.score, right.distal.score);

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
      // Switched limbs — reset the filter so stale state from the other
      // side doesn't leak into the newly selected one.
      this.filter.reset();
      this.selectedSide = side;
    }

    const rawAngle = angleDegrees(
      chosen.proximal.x,
      chosen.proximal.y,
      chosen.vertex.x,
      chosen.vertex.y,
      chosen.distal.x,
      chosen.distal.y
    );
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

    return { angle, progress, stage: this.stage, justCounted };
  }
}

type LegTriple = { hip: Point; knee: Point; ankle: Point };
export type AngleRepUpdate = { angle: number; progress: number; stage: 'up' | 'down'; justCounted: boolean };

// Fixed fallback thresholds (degrees) used until enough angle range has been
// observed to trust dynamic calibration.
const SIDE_ANGLE_DOWN_FALLBACK = 100;
const SIDE_ANGLE_UP_FALLBACK = 160;
const SIDE_ANGLE_MIN_CALIBRATION_RANGE = 20; // degrees
const SIDE_ANGLE_DOWN_FRACTION = 0.3; // from the straight/top end
const SIDE_ANGLE_UP_FRACTION = 0.15;
// Full-depth requirement for a rep to count. Fixed (not derived from the
// self-calibrated min/max range) on purpose: a dynamic "reached 15% short of
// whatever the deepest observed angle was" threshold quietly re-anchors to
// shallow squats if that's all the person has done so far, so a string of
// half-squats ends up counting itself as "full depth". A real squat brings
// the knee angle to roughly parallel-thigh (~90-100°), so require that
// regardless of what's been observed this session.
const SIDE_ANGLE_DEPTH_ABSOLUTE_DEG = 100;
// Second, independent depth check: how far the hip has dropped toward knee
// height, normalized by thigh length so it doesn't depend on distance from
// the camera. 0 = hip level with knee (thighs parallel to the ground, the
// standard "full squat" depth); positive = hip still above knee (shallow).
// Knee angle alone drifts with leg proportions and exact stance, so
// requiring both this AND the angle threshold catches shallow squats (and
// posture faults like bending only at the hips) that either check alone
// could miss.
const SIDE_ANGLE_DEPTH_RATIO_THRESHOLD = 0.1;
// The gauge's green zone starts at progress 0.8 (see ProgressGauge's
// gaugeZone flex values in CameraScreen.tsx). Cap displayed progress just
// below that whenever hasDepth is false so the gauge can't visually read
// "full depth" purely from the knee angle while the hip-drop check hasn't
// actually passed yet — otherwise the gauge and the count criteria disagree
// about what counts as deep enough.
const SIDE_ANGLE_PROGRESS_CEILING_WITHOUT_DEPTH = 0.78;

/**
 * Rep counter for a side-on camera view, driven by knee (hip-knee-ankle)
 * angle instead of vertical position — from the side, the thigh/shin don't
 * foreshorten toward the lens the way an elbow does facing the camera, so
 * angle is the stable signal here (the opposite of the push-up/front-squat
 * case). Every frame it picks whichever leg (left/right) is more visible —
 * from the side, the far leg is partly self-occluded — so it auto-adapts to
 * whichever way the person is facing without needing to be told.
 *
 * Counts the instant full depth (hasDepth) is reached during the descent —
 * in sync with the gauge entering its green zone — rather than waiting for
 * the return to standing, so the numeric count and the visual "you're deep
 * enough" moment land together. A half-squat that never reaches full depth
 * still moves the gauge but never counts.
 */
export class SideAngleRepCounter {
  private filters: Record<'hipX' | 'hipY' | 'kneeX' | 'kneeY' | 'ankleX' | 'ankleY', OneEuroFilter>;
  private selectedSide: 'left' | 'right' | null = null;
  private minAngleSeen = Infinity;
  private maxAngleSeen = -Infinity;
  private reachedDepthThisRep = false;
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
    this.reachedDepthThisRep = false;
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

    const thigh = Math.hypot(kneeX - hipX, kneeY - hipY);
    // thigh is near-zero only for degenerate/unusable landmarks (hip and
    // knee collapsed onto each other); treat that as "not deep" rather than
    // dividing by ~0.
    const depthRatio = thigh > 1e-6 ? (kneeY - hipY) / thigh : Infinity;
    const hasDepth = angle <= SIDE_ANGLE_DEPTH_ABSOLUTE_DEG && depthRatio <= SIDE_ANGLE_DEPTH_RATIO_THRESHOLD;

    if (angle < this.minAngleSeen) this.minAngleSeen = angle;
    if (angle > this.maxAngleSeen) this.maxAngleSeen = angle;
    const range = this.maxAngleSeen - this.minAngleSeen;

    let downThreshold = SIDE_ANGLE_DOWN_FALLBACK;
    let upThreshold = SIDE_ANGLE_UP_FALLBACK;
    if (range >= SIDE_ANGLE_MIN_CALIBRATION_RANGE) {
      downThreshold = this.maxAngleSeen - SIDE_ANGLE_DOWN_FRACTION * range;
      upThreshold = this.maxAngleSeen - SIDE_ANGLE_UP_FRACTION * range;
    }
    // Keep the "down" entry comfortably above the fixed depth requirement —
    // otherwise a dynamically-calibrated downThreshold that drifts at or
    // below the depth angle would let a frame cross straight from "up" to
    // past full depth in one step, skipping the depth-tracking done in the
    // 'down' branch below.
    downThreshold = Math.max(downThreshold, SIDE_ANGLE_DEPTH_ABSOLUTE_DEG + 30);
    // upThreshold needs the same floor: someone who never fully locks out
    // (calibrated max angle stays low, e.g. ~104°) can otherwise pull it
    // down to/below the depth angle, which makes progress's denominator
    // (upThreshold - depthAngle) zero or negative — the gauge then reads
    // stuck at 0 for the whole rep even at real depth. Anchoring it above
    // downThreshold also keeps the up/down hysteresis band from collapsing.
    upThreshold = Math.max(upThreshold, downThreshold + 10);

    let justCounted = false;

    if (angle < downThreshold && this.stage === 'up') {
      this.stage = 'down';
      this.reachedDepthThisRep = false;
    }
    if (this.stage === 'down') {
      // Count the instant hasDepth first turns true — in sync with the
      // gauge entering green — instead of waiting for the return to
      // standing. reachedDepthThisRep still gates it to once per descent so
      // lingering or bouncing at depth doesn't rack up extra counts.
      if (hasDepth && !this.reachedDepthThisRep) {
        this.reachedDepthThisRep = true;
        if (timestampMs - this.lastCountTimestamp >= MIN_REP_INTERVAL_MS) {
          this.count += 1;
          this.lastCountTimestamp = timestampMs;
          justCounted = true;
        }
      }
      if (angle > upThreshold) {
        this.stage = 'up';
      }
    }

    // Anchored to the fixed depth angle (not the dynamically-calibrated
    // downThreshold) so the gauge doesn't read "full depth" just because
    // the person's deepest squat so far happened to be shallow.
    let progress = Math.max(
      0,
      Math.min(1, (upThreshold - angle) / (upThreshold - SIDE_ANGLE_DEPTH_ABSOLUTE_DEG))
    );
    if (!hasDepth) {
      progress = Math.min(progress, SIDE_ANGLE_PROGRESS_CEILING_WITHOUT_DEPTH);
    }

    return { angle, progress, stage: this.stage, justCounted };
  }
}
