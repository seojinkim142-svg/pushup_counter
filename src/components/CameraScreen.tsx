import React, { useCallback, useEffect, useRef, useState } from 'react';
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
import Svg, { Circle, Line } from 'react-native-svg';
import {
  AngleRepCounter,
  EXERCISES,
  MIN_KEYPOINT_SCORE,
  SKELETON_EDGES,
  SideAngleRepCounter,
  VISIBLE_LANDMARK_INDICES,
  VerticalRepCounter,
  averageJointAngle,
  averageVisibleY,
  isPersonPresent,
  type ExerciseId,
  type Point,
} from '../lib/pose';

// "lite" trades some accuracy for a much lighter model — the "heavy" variant
// couldn't keep up with the live camera feed and made the preview stutter.
const POSE_MODEL = 'pose_landmarker_lite.task';
const VISIBLE_LANDMARK_SET = new Set(VISIBLE_LANDMARK_INDICES);
const { width: SCREEN_WIDTH } = Dimensions.get('window');
const PREVIEW_SIZE = SCREEN_WIDTH;

const GAUGE_WIDTH = 34;
const GAUGE_HEIGHT = 220;
const GAUGE_DOT_SIZE = 30;

type Stage = 'up' | 'down';
type ScreenPoint = { x: number; y: number; score: number };

const EXERCISE_ORDER: ExerciseId[] = ['pushup', 'squat'];

export default function CameraScreen() {
  const { hasPermission, requestPermission } = useCameraPermission();

  const [cameraPosition, setCameraPosition] = useState<CameraPosition>('front');
  const [exercise, setExercise] = useState<ExerciseId>('pushup');
  const [count, setCount] = useState(0);
  const [stage, setStage] = useState<Stage>('up');
  const [isTracking, setIsTracking] = useState(true);
  const [screenPoints, setScreenPoints] = useState<ScreenPoint[]>([]);
  const [postureOk, setPostureOk] = useState(true);
  const [progress, setProgress] = useState<number | null>(null);
  const exerciseConfig = EXERCISES[exercise];

  // Read from refs inside the stable onResults callback so switching
  // exercise/pause doesn't force react-native-mediapipe to recreate the
  // native pose detector.
  const exerciseRef = useRef<ExerciseId>('pushup');
  const trackingRef = useRef(true);
  const stageRef = useRef<Stage>('up');
  const countRef = useRef(0);
  const displacementCounterRef = useRef(new VerticalRepCounter());
  const sideAngleCounterRef = useRef(new SideAngleRepCounter());
  const angleCounterRef = useRef(new AngleRepCounter());

  useEffect(() => {
    exerciseRef.current = exercise;
  }, [exercise]);
  useEffect(() => {
    trackingRef.current = isTracking;
  }, [isTracking]);

  const onResults = useCallback(
    (result: PoseDetectionResultBundle, vc: ViewCoordinator) => {
      if (!trackingRef.current) return;

      const landmarks = result.results[0]?.landmarks[0] ?? [];
      if (landmarks.length === 0) {
        setScreenPoints([]);
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
      const screenPts: Point[] = personPresent
        ? landmarks.map((lm, i) => {
            if (!VISIBLE_LANDMARK_SET.has(i)) return { x: 0, y: 0, score: 0 };
            const p = vc.convertPoint(frameDims, lm);
            return { x: p.x, y: p.y, score: pts[i].score };
          })
        : [];

      if (personPresent) {
        const config = EXERCISES[exerciseRef.current];
        const validPosture = config.isValidPosture ? config.isValidPosture(screenPts) : true;
        setPostureOk(validPosture);

        if (validPosture) {
          if (config.signal === 'angle') {
            const angle = averageJointAngle(pts, config);
            if (angle != null) {
              // Routed through AngleRepCounter (One-Euro filtered, debounced)
              // rather than compared to the threshold directly, so this
              // signal gets the same jitter/false-positive protections as
              // the other two below.
              const update = angleCounterRef.current.update(angle, Date.now(), config);
              setProgress(update.progress);
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
            // Vertical-displacement signal: use rotation-corrected
            // screen-space Y (screenPts), not the raw sensor-space
            // landmarks — same reasoning as the posture check above.
            const y = averageVisibleY(screenPts, config.landmarks);
            if (y != null) {
              const confirmDown = config.depthConfirm ? config.depthConfirm(pts, screenPts) : true;
              const update = displacementCounterRef.current.update(y, Date.now(), confirmDown);
              if (update != null) {
                setProgress(update.progress);
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
              setProgress(update.progress);
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
        setProgress(null);
      }

      setScreenPoints(screenPts);
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
      // GPU delegate contends with CameraX's own GL-based preview pipeline
      // on this device (glDrawArrays errors, "maxImages already acquired"
      // backlog) — CPU delegate avoids that contention.
      delegate: Delegate.CPU,
      minPoseDetectionConfidence: 0.5,
      minPosePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
      // Cap the analyzer rate so image buffers get released before the next
      // frame is acquired, instead of racing the raw camera fps.
      fpsMode: 15,
    }
  );

  const handleReset = () => {
    countRef.current = 0;
    stageRef.current = 'up';
    displacementCounterRef.current.reset();
    sideAngleCounterRef.current.reset();
    angleCounterRef.current.reset();
    setCount(0);
    setStage('up');
    setProgress(null);
  };

  const handleSelectExercise = (id: ExerciseId) => {
    if (id === exercise) return;
    setExercise(id);
    setPostureOk(true);
    handleReset();
  };

  const handleFlipCamera = () => {
    setCameraPosition((p) => (p === 'front' ? 'back' : 'front'));
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
        <Svg width={PREVIEW_SIZE} height={PREVIEW_SIZE} style={StyleSheet.absoluteFill}>
          {SKELETON_EDGES.map(([a, b], i) => {
            const pa = screenPoints[a];
            const pb = screenPoints[b];
            if (!pa || !pb) return null;
            if (pa.score < MIN_KEYPOINT_SCORE || pb.score < MIN_KEYPOINT_SCORE) return null;
            return (
              <Line
                key={`edge-${i}`}
                x1={pa.x}
                y1={pa.y}
                x2={pb.x}
                y2={pb.y}
                stroke="#39FF88"
                strokeWidth={2.5}
              />
            );
          })}
          {screenPoints.map((p, i) =>
            p.score > MIN_KEYPOINT_SCORE ? (
              <Circle key={`pt-${i}`} cx={p.x} cy={p.y} r={4} fill="#39FF88" />
            ) : null
          )}
        </Svg>
        <Pressable style={styles.cameraSwitchButton} onPress={handleFlipCamera}>
          <Text style={styles.cameraSwitchButtonText}>카메라 전환</Text>
        </Pressable>

        {progress != null && (
          <View style={styles.gaugeTrack}>
            <View style={[styles.gaugeZone, { flex: 0.2, backgroundColor: '#FF4D4D' }]} />
            <View style={[styles.gaugeZone, { flex: 0.6, backgroundColor: '#3B82F6' }]} />
            <View style={[styles.gaugeZone, { flex: 0.2, backgroundColor: '#39FF88' }]} />
            <View
              style={[
                styles.gaugeDot,
                { top: progress * (GAUGE_HEIGHT - GAUGE_DOT_SIZE) },
              ]}
            />
          </View>
        )}
      </View>

      <View style={styles.counterCard}>
        <Text style={styles.countLabel}>{exerciseConfig.label.toUpperCase()}</Text>
        <Text style={styles.countValue}>{count}</Text>
        <Text style={styles.stageLabel}>
          {stage === 'down' ? exerciseConfig.downLabel : exerciseConfig.upLabel}
        </Text>
        {!postureOk && exerciseConfig.postureHint != null && (
          <Text style={styles.postureHint}>{exerciseConfig.postureHint}</Text>
        )}
      </View>

      <View style={styles.controls}>
        <Pressable style={styles.button} onPress={() => setIsTracking((v) => !v)}>
          <Text style={styles.buttonText}>{isTracking ? '일시정지' : '계속하기'}</Text>
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
