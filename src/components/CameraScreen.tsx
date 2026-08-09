import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Dimensions, Pressable, StyleSheet, Text, View } from 'react-native';
import { useCameraPermission, type CameraPosition } from 'react-native-vision-camera';
import {
  Delegate,
  MediapipeCamera,
  RunningMode,
  usePoseDetection,
  type DetectionError,
  type PoseDetectionResultBundle,
  type ViewCoordinator,
} from 'react-native-mediapipe';
import Svg, { Path } from 'react-native-svg';
import {
  AngleRepCounter,
  EXERCISES,
  MIN_KEYPOINT_SCORE,
  SKELETON_EDGES,
  SideAngleRepCounter,
  VISIBLE_LANDMARK_INDICES,
  VerticalRepCounter,
  isPersonPresent,
  relativeVisibleY,
  type ExerciseId,
  type Point,
} from '../lib/pose';

// "full" trades some speed for noticeably better landmark accuracy than
// "lite" — worth it now that GPU delegate + the render fixes give enough
// fps headroom to absorb the extra inference cost. If fps becomes a problem
// again, drop back to "lite" before trying "heavy" (much more expensive
// still, untested on this device).
const POSE_MODEL = 'pose_landmarker_full.task';
const VISIBLE_LANDMARK_SET = new Set(VISIBLE_LANDMARK_INDICES);
const { width: SCREEN_WIDTH } = Dimensions.get('window');
const PREVIEW_SIZE = SCREEN_WIDTH;

const GAUGE_WIDTH = 34;
const GAUGE_HEIGHT = 220;
const GAUGE_DOT_SIZE = 30;

type Stage = 'up' | 'down';
type ScreenPoint = { x: number; y: number; score: number };

// 'idle': not tracking. 'calibrating': counting down while the user gets
// into the starting position — no posture/counting logic runs yet, only the
// verticalDisplacement signal's current value is sampled so it can anchor
// the range once the countdown ends (see CameraScreen's seedReference call).
// 'tracking': normal operation.
type Phase = 'idle' | 'calibrating' | 'tracking';

// How long the user gets to settle into the starting position before
// tracking begins. Deliberately capturing "this moment is the reference
// point" avoids the contamination that came from letting the calibrated
// range emerge organically from whatever the first few real frames were
// (which could be mid-transition, not the true extended/rest position).
const CALIBRATION_SECONDS = 5;

// How long a continuous invalid-posture stretch has to last to count as a
// genuine break (e.g. standing up, repositioning) rather than isValidPosture
// flickering for a moment right at full depth — only a break this long
// triggers a calibration reset. Time-based (not a frame count) so it means
// the same real-world duration regardless of the current detection fps
// (which on this hardware wanders ~9-12fps and occasionally lower).
const REPOSITION_INVALID_MS = 1200;

// isValidPosture can flicker false for a moment even mid-rep (e.g. right at
// full push-up depth, where the torso-orientation/wrist-margin heuristics
// are closest to their thresholds) — gating counting on it directly meant
// that frame's data got silently dropped, which read as the gauge "jumping"
// once the next frame arrived. Tolerating a short invalid stretch (using the
// last-known-good processing path instead of stopping) smooths that over;
// only a longer, genuine break should actually pause counting.
const POSTURE_GRACE_MS = 1000;

// armCurlTest is a temporary tuning aid (see its comment in pose.ts), not a
// real workout mode — remove this tab once pushup/squat tuning is done.
const EXERCISE_ORDER: ExerciseId[] = ['pushup', 'squat', 'jumpingJack', 'armCurlTest'];

const JOINT_RADIUS = 4;

/**
 * Builds one SVG path string for the whole skeleton (all edges as separate
 * M/L subpaths) instead of one <Line> element per edge. On this device,
 * committing ~24 individual react-native-svg host elements every update was
 * itself the render bottleneck (confirmed by measuring rAF throughput with
 * the skeleton removed: steady 60fps vs. ~10fps with it) — a single <Path>
 * element is one native view no matter how many segments its `d` describes.
 */
function buildSkeletonEdgesPath(points: ScreenPoint[]): string {
  let d = '';
  for (const [a, b] of SKELETON_EDGES) {
    const pa = points[a];
    const pb = points[b];
    if (!pa || !pb) continue;
    if (pa.score < MIN_KEYPOINT_SCORE || pb.score < MIN_KEYPOINT_SCORE) continue;
    d += `M${pa.x},${pa.y}L${pb.x},${pb.y}`;
  }
  return d;
}

/** Same idea as buildSkeletonEdgesPath, but for the joint dots (each a two-arc circle subpath). */
function buildSkeletonJointsPath(points: ScreenPoint[], r: number): string {
  let d = '';
  for (const p of points) {
    if (p.score <= MIN_KEYPOINT_SCORE) continue;
    d += `M${p.x - r},${p.y}a${r},${r} 0 1,0 ${2 * r},0a${r},${r} 0 1,0 ${-2 * r},0`;
  }
  return d;
}

/** Exercises with a small-amplitude verticalDisplacement signal need a smaller calibration-range floor than the default. */
function createDisplacementCounter(id: ExerciseId): VerticalRepCounter {
  const config = EXERCISES[id];
  const minCalibrationRange = config.signal === 'verticalDisplacement' ? config.minCalibrationRange : undefined;
  return new VerticalRepCounter(undefined, undefined, undefined, minCalibrationRange);
}

export type SkeletonOverlayHandle = { setTargetPoints: (points: ScreenPoint[]) => void };

/**
 * Isolates the highest-churn state (interpolated skeleton points, up to
 * display refresh rate) in its own leaf component. Parent (CameraScreen)
 * feeds new detections in imperatively via the ref instead of prop/state,
 * so this component's frequent re-renders never touch the tabs, buttons,
 * counter, or gauge — only these two <Path> elements re-render.
 */
const SkeletonOverlay = forwardRef<SkeletonOverlayHandle, { width: number; height: number }>(
  function SkeletonOverlay({ width, height }, ref) {
    const [points, setPoints] = useState<ScreenPoint[]>([]);
    const prevRef = useRef<ScreenPoint[]>([]);
    const prevTimestampRef = useRef(Date.now());
    const targetRef = useRef<ScreenPoint[]>([]);
    const targetTimestampRef = useRef(Date.now());
    const settledRef = useRef(true);

    useImperativeHandle(
      ref,
      () => ({
        setTargetPoints(newPoints: ScreenPoint[]) {
          prevRef.current = targetRef.current;
          prevTimestampRef.current = targetTimestampRef.current;
          targetRef.current = newPoints;
          targetTimestampRef.current = Date.now();
          settledRef.current = false;
        },
      }),
      []
    );

    // Renders at display refresh rate by interpolating between the last two
    // detection results over the interval actually observed between them,
    // instead of holding each result's position until the next one arrives.
    useEffect(() => {
      let frameId: number;

      const tick = () => {
        frameId = requestAnimationFrame(tick);
        if (settledRef.current) return;

        const prev = prevRef.current;
        const target = targetRef.current;
        if (prev.length !== target.length) {
          // Person just appeared/disappeared — nothing to interpolate from.
          setPoints(target);
          settledRef.current = true;
          return;
        }

        const duration = Math.max(1, targetTimestampRef.current - prevTimestampRef.current);
        const t = Math.min(1, (Date.now() - targetTimestampRef.current) / duration);
        setPoints(
          target.map((p, i) => {
            const from = prev[i];
            return { x: from.x + (p.x - from.x) * t, y: from.y + (p.y - from.y) * t, score: p.score };
          })
        );
        if (t >= 1) settledRef.current = true;
      };

      frameId = requestAnimationFrame(tick);
      return () => cancelAnimationFrame(frameId);
    }, []);

    return (
      <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
        <Path d={buildSkeletonEdgesPath(points)} stroke="#39FF88" strokeWidth={2.5} fill="none" />
        <Path d={buildSkeletonJointsPath(points, JOINT_RADIUS)} fill="#39FF88" />
      </Svg>
    );
  }
);

export type ProgressGaugeHandle = { setTargetProgress: (progress: number | null) => void };

/**
 * Same isolation/interpolation trick as SkeletonOverlay, applied to the
 * depth gauge dot: detection results arrive at ~10fps, so snapping the dot
 * straight to each new progress value makes it visibly hop between
 * positions — most noticeably right around a counted rep, where progress,
 * stage, and count all change in the same detection frame. Tweening between
 * the last two values over the interval actually observed between them
 * smooths that out, and doing it in its own leaf component (fed via ref,
 * not CameraScreen state) keeps those up-to-60fps re-renders from touching
 * the tabs/counter/buttons the way the skeleton overlay's did before.
 */
// eslint-disable-next-line @typescript-eslint/ban-types
const ProgressGauge = forwardRef<ProgressGaugeHandle, {}>(function ProgressGauge(_props, ref) {
  const [progress, setProgress] = useState<number | null>(null);
  const prevRef = useRef<number | null>(null);
  const prevTimestampRef = useRef(Date.now());
  const targetRef = useRef<number | null>(null);
  const targetTimestampRef = useRef(Date.now());
  const settledRef = useRef(true);

  useImperativeHandle(
    ref,
    () => ({
      setTargetProgress(newProgress: number | null) {
        prevRef.current = targetRef.current;
        prevTimestampRef.current = targetTimestampRef.current;
        targetRef.current = newProgress;
        targetTimestampRef.current = Date.now();
        settledRef.current = false;
      },
    }),
    []
  );

  useEffect(() => {
    let frameId: number;

    const tick = () => {
      frameId = requestAnimationFrame(tick);
      if (settledRef.current) return;

      const prev = prevRef.current;
      const target = targetRef.current;
      if (prev == null || target == null) {
        // Gauge appearing/disappearing (person present/absent) — nothing to
        // interpolate from, so snap.
        setProgress(target);
        settledRef.current = true;
        return;
      }

      const duration = Math.max(1, targetTimestampRef.current - prevTimestampRef.current);
      const t = Math.min(1, (Date.now() - targetTimestampRef.current) / duration);
      setProgress(prev + (target - prev) * t);
      if (t >= 1) settledRef.current = true;
    };

    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, []);

  if (progress == null) return null;

  return (
    <View style={styles.gaugeTrack}>
      <View style={[styles.gaugeZone, { flex: 0.2, backgroundColor: '#FF4D4D' }]} />
      <View style={[styles.gaugeZone, { flex: 0.6, backgroundColor: '#3B82F6' }]} />
      <View style={[styles.gaugeZone, { flex: 0.2, backgroundColor: '#39FF88' }]} />
      <View style={[styles.gaugeDot, { top: progress * (GAUGE_HEIGHT - GAUGE_DOT_SIZE) }]} />
    </View>
  );
});

export default function CameraScreen() {
  const { hasPermission, requestPermission } = useCameraPermission();

  const [cameraPosition, setCameraPosition] = useState<CameraPosition>('front');
  const [exercise, setExercise] = useState<ExerciseId>('pushup');
  const [count, setCount] = useState(0);
  const [stage, setStage] = useState<Stage>('up');
  const [phase, setPhase] = useState<Phase>('idle');
  const [calibrationSecondsLeft, setCalibrationSecondsLeft] = useState(CALIBRATION_SECONDS);
  const [postureOk, setPostureOk] = useState(true);
  const exerciseConfig = EXERCISES[exercise];

  // Read from refs inside the stable onResults callback so switching
  // exercise/pause doesn't force react-native-mediapipe to recreate the
  // native pose detector.
  const exerciseRef = useRef<ExerciseId>('pushup');
  const phaseRef = useRef<Phase>('idle');
  const stageRef = useRef<Stage>('up');
  const countRef = useRef(0);
  const displacementCounterRef = useRef(createDisplacementCounter('pushup'));
  const sideAngleCounterRef = useRef(new SideAngleRepCounter());
  const angleCounterRef = useRef(new AngleRepCounter());
  const skeletonRef = useRef<SkeletonOverlayHandle>(null);
  const progressGaugeRef = useRef<ProgressGaugeHandle>(null);
  // Timestamp the current invalid-posture stretch started, or null while
  // posture is (or was very recently) valid — used to distinguish a genuine
  // break from brief flicker (see REPOSITION_INVALID_MS/POSTURE_GRACE_MS above).
  const invalidPostureSinceRef = useRef<number | null>(null);
  // Latest verticalDisplacement reading seen during the 'calibrating'
  // countdown — captured every frame so whatever's current when the
  // countdown ends becomes the seeded reference point.
  const calibrationYRef = useRef<number | null>(null);

  useEffect(() => {
    exerciseRef.current = exercise;
  }, [exercise]);
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  // Drives the calibration countdown: ticks calibrationSecondsLeft down once
  // a second, then seeds the displacement counter's reference point (if this
  // exercise uses one) and switches to 'tracking' once it hits zero.
  useEffect(() => {
    if (phase !== 'calibrating') return;
    if (calibrationSecondsLeft <= 0) {
      const config = EXERCISES[exerciseRef.current];
      if (config.signal === 'verticalDisplacement' && calibrationYRef.current != null) {
        displacementCounterRef.current.seedReference(calibrationYRef.current);
      }
      setPhase('tracking');
      return;
    }
    const timer = setTimeout(() => setCalibrationSecondsLeft((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [phase, calibrationSecondsLeft]);

  const onResults = useCallback(
    (result: PoseDetectionResultBundle, vc: ViewCoordinator) => {
      if (phaseRef.current === 'idle') return;

      const landmarks = result.results[0]?.landmarks[0] ?? [];
      if (landmarks.length === 0) {
        skeletonRef.current?.setTargetPoints([]);
        return;
      }

      const pts: Point[] = landmarks.map((lm) => ({
        x: lm.x,
        y: lm.y,
        score: lm.visibility ?? lm.presence ?? 1,
      }));
      const personPresent = isPersonPresent(pts);

      // The raw landmark x/y are in the camera sensor's own orientation
      // (e.g. rotated 90° relative to a portrait screen), not "up/down on
      // screen" — angle math is rotation-invariant so `pts` is fine for
      // that, but any position check (like "is the wrist below the
      // shoulder") needs the rotation-corrected screen-space coordinates
      // from vc.convertPoint instead, or it's comparing the wrong axis.
      const frameDims = vc.getFrameDims(result);
      // vc.convertPoint returns *view pixel* coordinates (denormalized to
      // the camera box's actual rendered size), not 0-1 — used as-is below
      // for drawing the skeleton (which needs real pixel positions), but
      // every pose.ts threshold (MIN_CALIBRATION_RANGE, posture margins,
      // spread ratios) is written assuming normalized screen-height units.
      // Feeding it raw pixel values silently turned those thresholds into
      // near no-ops (e.g. 0.04 is nothing next to a ~300px gap), which is
      // why posture/calibration checks kept passing when they shouldn't
      // have. normScreenPts re-normalizes by PREVIEW_SIZE for that logic;
      // screenPts stays in pixels for rendering.
      const screenPts: Point[] = personPresent
        ? landmarks.map((lm, i) => {
            if (!VISIBLE_LANDMARK_SET.has(i)) return { x: 0, y: 0, score: 0 };
            const p = vc.convertPoint(frameDims, lm);
            return { x: p.x, y: p.y, score: pts[i].score };
          })
        : [];
      const normScreenPts: Point[] = screenPts.map((p) => ({
        x: p.x / PREVIEW_SIZE,
        y: p.y / PREVIEW_SIZE,
        score: p.score,
      }));

      if (phaseRef.current === 'calibrating') {
        // No posture/counting logic yet — just keep the latest reading
        // fresh so whatever it is when the countdown ends becomes the
        // seeded reference (see the countdown effect above).
        const config = EXERCISES[exerciseRef.current];
        if (personPresent && config.signal === 'verticalDisplacement') {
          const y = relativeVisibleY(normScreenPts, config.landmarks, config.referenceLandmarks);
          if (y != null) calibrationYRef.current = y;
        }
        skeletonRef.current?.setTargetPoints(screenPts);
        return;
      }

      if (personPresent) {
        const config = EXERCISES[exerciseRef.current];
        const validPosture = config.isValidPosture ? config.isValidPosture(normScreenPts) : true;

        if (validPosture) {
          if (
            invalidPostureSinceRef.current != null &&
            Date.now() - invalidPostureSinceRef.current >= REPOSITION_INVALID_MS &&
            config.signal === 'verticalDisplacement'
          ) {
            // Coming back valid after a *sustained* invalid stretch (e.g.
            // was standing/getting into position) — discard whatever range
            // got calibrated before, so real reps are judged against a
            // fresh range. A brief flicker (e.g. isValidPosture wobbling
            // right at full depth) must NOT trigger this — it'd wipe the
            // range mid-rep, every rep, which is what was silently breaking
            // counting.
            displacementCounterRef.current.recalibrate();
          }
          invalidPostureSinceRef.current = null;
        } else if (invalidPostureSinceRef.current == null) {
          invalidPostureSinceRef.current = Date.now();
        }

        // Tolerate a brief invalid stretch (see POSTURE_GRACE_MS) instead of
        // dropping that frame's data outright — only a longer, genuine break
        // actually pauses counting or shows the posture hint. Without this,
        // a flicker right at full depth (heuristics closest to their
        // thresholds there) both dropped that frame's data (gauge "jumped")
        // and flashed the hint text on/off every single rep.
        const shouldProcess =
          validPosture ||
          (invalidPostureSinceRef.current != null && Date.now() - invalidPostureSinceRef.current < POSTURE_GRACE_MS);
        setPostureOk(shouldProcess);

        if (shouldProcess) {
          if (config.signal === 'angle') {
            // Rotation doesn't matter for angle math, so raw sensor-space
            // landmarks (pts) are fine here — same reasoning as sideAngle
            // below. AngleRepCounter picks whichever side is confidently
            // visible (with hysteresis) instead of averaging both, so only
            // one limb needs to be in frame and moving.
            const left = {
              proximal: pts[config.left[0]],
              vertex: pts[config.left[1]],
              distal: pts[config.left[2]],
            };
            const right = {
              proximal: pts[config.right[0]],
              vertex: pts[config.right[1]],
              distal: pts[config.right[2]],
            };
            const update = angleCounterRef.current.update(left, right, Date.now(), config);
            if (update != null) {
              progressGaugeRef.current?.setTargetProgress(update.progress);
              if (update.stage !== stageRef.current) {
                stageRef.current = update.stage;
                setStage(update.stage);
              }
              if (update.justCounted) {
                countRef.current = angleCounterRef.current.count;
                setCount(countRef.current);
              }
            }
          } else if (config.signal === 'verticalDisplacement') {
            // Vertical-displacement signal: use rotation-corrected,
            // normalized screen-space Y (normScreenPts), not the raw
            // sensor-space landmarks — same reasoning as the posture check
            // above. VerticalRepCounter's calibration-range threshold is
            // written in normalized units, so this must be normalized too.
            const y = relativeVisibleY(normScreenPts, config.landmarks, config.referenceLandmarks);
            if (y != null) {
              // Evaluated every frame, not just at the count instant —
              // VerticalRepCounter OR's this across the whole "up" phase.
              const auxValid = config.depthConfirm ? config.depthConfirm(pts, normScreenPts) : true;
              const update = displacementCounterRef.current.update(y, Date.now(), auxValid);
              if (update != null) {
                progressGaugeRef.current?.setTargetProgress(update.progress);
                if (update.stage !== stageRef.current) {
                  stageRef.current = update.stage;
                  setStage(update.stage);
                }
                if (update.justCounted) {
                  countRef.current = displacementCounterRef.current.count;
                  setCount(countRef.current);
                }
              }
            }
          } else {
            // Side-angle signal: rotation doesn't matter for angle math, so
            // raw sensor-space landmarks (pts) are fine here.
            const left = {
              hip: pts[config.left[0]],
              knee: pts[config.left[1]],
              ankle: pts[config.left[2]],
            };
            const right = {
              hip: pts[config.right[0]],
              knee: pts[config.right[1]],
              ankle: pts[config.right[2]],
            };
            const update = sideAngleCounterRef.current.update(left, right, Date.now());
            if (update != null) {
              progressGaugeRef.current?.setTargetProgress(update.progress);
              if (update.stage !== stageRef.current) {
                stageRef.current = update.stage;
                setStage(update.stage);
              }
              if (update.justCounted) {
                countRef.current = sideAngleCounterRef.current.count;
                setCount(countRef.current);
              }
            }
          }
        }
      } else {
        setPostureOk(true);
        progressGaugeRef.current?.setTargetProgress(null);
        // No person at all is at least as much "not in position" as a
        // failed posture check — count it the same way so a long absence
        // (walked away, camera lost them) still triggers a recalibration
        // on return, same as a standing-to-prone transition would.
        if (invalidPostureSinceRef.current == null) invalidPostureSinceRef.current = Date.now();
      }

      // Feed the child component imperatively (ref call, not state) so this
      // update never re-renders CameraScreen itself — see SkeletonOverlay.
      skeletonRef.current?.setTargetPoints(screenPts);
    },
    []
  );

  const onError = useCallback((error: DetectionError): void => {
    console.warn('pose detection error', error);
  }, []);

  const poseDetection = usePoseDetection(
    { onResults, onError },
    RunningMode.LIVE_STREAM,
    POSE_MODEL,
    {
      // CPU delegate previously avoided a documented GPU/CameraX preview
      // conflict (glDrawArrays errors, "maxImages already acquired"
      // backlog) on this device, but only reached ~5-9fps and dipped as
      // low as 2fps — JS-side handling is <2ms/frame, so that ceiling is
      // native inference throughput, not something fpsMode or JS can fix.
      // On-device retest (2026-08, clean background) with GPU ran a
      // steady 9-12fps over 45s with no errors, so switching back — if the
      // old conflict resurfaces under real use, revert to Delegate.CPU.
      delegate: Delegate.GPU,
      minPoseDetectionConfidence: 0.5,
      minPosePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
      // Cap the analyzer rate so image buffers get released before the next
      // frame is acquired, instead of racing the raw camera fps.
      fpsMode: 15,
    }
  );

  // Full reset: also drops back to 'idle' so resuming requires a fresh
  // calibration hold — guarantees no stale range ever carries into a new
  // set, which was the whole point of the deliberate-reference approach.
  const handleReset = () => {
    countRef.current = 0;
    stageRef.current = 'up';
    displacementCounterRef.current.reset();
    sideAngleCounterRef.current.reset();
    angleCounterRef.current.reset();
    invalidPostureSinceRef.current = null;
    calibrationYRef.current = null;
    setCount(0);
    setStage('up');
    progressGaugeRef.current?.setTargetProgress(null);
    setPhase('idle');
  };

  const handleSelectExercise = (id: ExerciseId) => {
    if (id === exercise) return;
    setExercise(id);
    setPostureOk(true);
    // Different verticalDisplacement exercises can need different
    // calibration-range floors (see createDisplacementCounter), so rebuild
    // the counter for the newly selected exercise rather than reusing the
    // previous one's.
    displacementCounterRef.current = createDisplacementCounter(id);
    handleReset();
  };

  const handleFlipCamera = () => {
    setCameraPosition((p) => (p === 'front' ? 'back' : 'front'));
  };

  const handleStart = () => {
    setCalibrationSecondsLeft(CALIBRATION_SECONDS);
    calibrationYRef.current = null;
    setPhase('calibrating');
  };

  const handleStop = () => {
    setPhase('idle');
  };

  if (!hasPermission) {
    return (
      <View style={styles.center}>
        <Text style={styles.hint}>운동 횟수를 세려면 카메라 권한이 필요해요.</Text>
        <Pressable style={styles.button} onPress={requestPermission}>
          <Text style={styles.buttonText}>카메라 권한 허용</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.exerciseTabs}>
        {EXERCISE_ORDER.map((id) => (
          <Pressable
            key={id}
            style={[styles.tab, exercise === id && styles.tabActive]}
            onPress={() => handleSelectExercise(id)}
          >
            <Text style={[styles.tabText, exercise === id && styles.tabTextActive]}>
              {EXERCISES[id].label}
            </Text>
          </Pressable>
        ))}
      </View>

      <View style={[styles.cameraBox, { width: PREVIEW_SIZE, height: PREVIEW_SIZE }]}>
        <MediapipeCamera
          style={StyleSheet.absoluteFill}
          solution={poseDetection}
          activeCamera={cameraPosition}
          resizeMode="cover"
        />
        <SkeletonOverlay ref={skeletonRef} width={PREVIEW_SIZE} height={PREVIEW_SIZE} />
        <Pressable style={styles.cameraSwitchButton} onPress={handleFlipCamera}>
          <Text style={styles.cameraSwitchButtonText}>카메라 전환</Text>
        </Pressable>

        {phase === 'calibrating' && (
          <View style={styles.calibrationOverlay}>
            <Text style={styles.calibrationCountdown}>{calibrationSecondsLeft}</Text>
            <Text style={styles.calibrationHint}>시작 자세를 잡고 잠시 멈춰있어 주세요</Text>
          </View>
        )}

        {phase === 'tracking' && <ProgressGauge ref={progressGaugeRef} />}
      </View>

      <View style={styles.counterCard}>
        <Text style={styles.countLabel}>{exerciseConfig.label.toUpperCase()}</Text>
        <Text style={styles.countValue}>{count}</Text>
        <Text style={styles.stageLabel}>
          {stage === 'down' ? exerciseConfig.downLabel : exerciseConfig.upLabel}
        </Text>
        {phase === 'tracking' && !postureOk && exerciseConfig.postureHint != null && (
          <Text style={styles.postureHint}>{exerciseConfig.postureHint}</Text>
        )}
      </View>

      <View style={styles.controls}>
        <Pressable style={styles.button} onPress={phase === 'idle' ? handleStart : handleStop}>
          <Text style={styles.buttonText}>{phase === 'idle' ? '시작' : '정지'}</Text>
        </Pressable>
        <Pressable style={[styles.button, styles.buttonSecondary]} onPress={handleReset}>
          <Text style={styles.buttonText}>초기화</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: '#0B0B0F',
    paddingTop: 12,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0B0B0F',
    padding: 24,
    gap: 16,
  },
  exerciseTabs: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  tab: {
    paddingVertical: 8,
    paddingHorizontal: 18,
    borderRadius: 999,
    backgroundColor: '#1E1E27',
  },
  tabActive: {
    backgroundColor: '#39FF88',
  },
  tabText: {
    color: '#8A8A93',
    fontSize: 14,
    fontWeight: '600',
  },
  tabTextActive: {
    color: '#0B0B0F',
  },
  cameraBox: {
    overflow: 'hidden',
    borderRadius: 20,
    backgroundColor: '#000',
  },
  cameraSwitchButton: {
    position: 'absolute',
    top: 12,
    right: 12,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  cameraSwitchButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
  calibrationOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(11,11,15,0.55)',
    gap: 12,
  },
  calibrationCountdown: {
    color: '#39FF88',
    fontSize: 96,
    fontWeight: '800',
  },
  calibrationHint: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
    paddingHorizontal: 24,
  },
  gaugeTrack: {
    position: 'absolute',
    left: 16,
    top: (PREVIEW_SIZE - GAUGE_HEIGHT) / 2,
    width: GAUGE_WIDTH,
    height: GAUGE_HEIGHT,
    borderRadius: GAUGE_WIDTH / 2,
    overflow: 'hidden',
    flexDirection: 'column',
  },
  gaugeZone: {
    width: '100%',
  },
  gaugeDot: {
    position: 'absolute',
    left: (GAUGE_WIDTH - GAUGE_DOT_SIZE) / 2,
    width: GAUGE_DOT_SIZE,
    height: GAUGE_DOT_SIZE,
    borderRadius: GAUGE_DOT_SIZE / 2,
    backgroundColor: '#FFFFFF',
    borderWidth: 2,
    borderColor: 'rgba(0,0,0,0.2)',
  },
  counterCard: {
    marginTop: 20,
    alignItems: 'center',
  },
  countLabel: {
    color: '#8A8A93',
    fontSize: 14,
    letterSpacing: 2,
  },
  countValue: {
    color: '#39FF88',
    fontSize: 88,
    fontWeight: '800',
  },
  stageLabel: {
    color: '#FFFFFF',
    fontSize: 16,
  },
  postureHint: {
    color: '#FFB020',
    fontSize: 14,
    marginTop: 8,
    textAlign: 'center',
  },
  controls: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 20,
  },
  button: {
    backgroundColor: '#1E1E27',
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 14,
  },
  buttonSecondary: {
    backgroundColor: '#2A1B1F',
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  hint: {
    color: '#8A8A93',
    fontSize: 14,
    marginTop: 12,
    textAlign: 'center',
  },
});
