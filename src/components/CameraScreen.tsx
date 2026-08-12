import React, { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler, Dimensions, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
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
import {
  AngleRepCounter,
  EXERCISES,
  SideAngleRepCounter,
  VISIBLE_LANDMARK_INDICES,
  VerticalRepCounter,
  isPersonPresent,
  relativeVisibleY,
  type ExerciseId,
  type Point,
} from '../lib/pose';
import {
  ADVENTURE_STAGES,
  isStageUnlocked,
  loadClearedStages,
  nextStage,
  saveClearedStage,
  type StageConfig,
} from '../lib/adventure';
import {
  ROUTINE_DAY_COUNT,
  ROUTINE_WEEK_COUNT,
  clearRoutineProgress,
  getRoutineDaySets,
  getRoutineRestSec,
  loadRoutineProgress,
  resolveTrack,
  saveRoutineProgress,
  startingWeek,
  type RoutineProgress,
} from '../lib/routine';
import {
  cancelMatchmaking,
  ensureAnonymousSession,
  finishMatch,
  getMatch,
  startMatchmaking,
  subscribeToIncomingMatch,
  subscribeToMatch,
  updateMyCount,
} from '../lib/versus';
import SkeletonOverlay, { type SkeletonOverlayHandle } from './SkeletonOverlay';
import ProgressGauge, { type ProgressGaugeHandle } from './ProgressGauge';
import CountdownClock from './CountdownClock';
import MonsterSprite from './MonsterSprite';
import { ACCENT, ACCENT_ON_DARK, TEXT_MUTED, TEXT_ON_ACCENT, TEXT_PRIMARY } from './theme';

// "full" trades some speed for noticeably better landmark accuracy than
// "lite" — worth it now that GPU delegate + the render fixes give enough
// fps headroom to absorb the extra inference cost. If fps becomes a problem
// again, drop back to "lite" before trying "heavy" (much more expensive
// still, untested on this device).
const POSE_MODEL = 'pose_landmarker_full.task';
const VISIBLE_LANDMARK_SET = new Set(VISIBLE_LANDMARK_INDICES);
const { width: SCREEN_WIDTH } = Dimensions.get('window');
const PREVIEW_SIZE = SCREEN_WIDTH;

type Stage = 'up' | 'down';

// 'idle': not tracking. 'calibrating': counting down while the user gets
// into the starting position — no posture/counting logic runs yet, only the
// verticalDisplacement signal's current value is sampled so it can anchor
// the range once the countdown ends (see CameraScreen's seedReference call).
// 'tracking': normal operation. 'resting': routine mode only — between sets,
// waiting out that day's rest timer before the next set's calibration hold.
type Phase = 'idle' | 'calibrating' | 'tracking' | 'resting';

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

// 'practice': no time limit, no red-zone penalty (today's behavior).
// 'record': 60s time limit; resting in the red zone (gauge top 20%) for too
// long disqualifies the attempt. 'adventure': stage-based mode — clear each
// stage's target rep count before its own time limit runs out; shares
// record mode's red-zone/posture disqualification ruleset. 'routine': fixed
// 6-week push-up program — a one-time untimed baseline test picks a
// difficulty track, then each day is a sequence of sets (target count, then
// a rest timer) with no overall time limit or disqualification. 'versus':
// random-matchmaking PvP (see src/lib/versus.ts) — both players' clocks are
// synced off the match row's server started_at, no red-zone/posture
// disqualification (a live opponent race shouldn't eliminate someone for
// resting a beat), just a shared countdown and live counts.
type Mode = 'practice' | 'record' | 'adventure' | 'routine' | 'versus';

const MODE_LABELS: Record<Mode, string> = {
  practice: '연습모드',
  record: '기록모드',
  adventure: '모험모드',
  routine: '루틴모드',
  versus: '대결모드',
};

// 'cleared': adventure-only — reached the stage's target count in time.
// 'routineDayComplete': routine-only — every set for the day is done.
type SessionEndReason = 'time' | 'disqualified' | 'cleared' | 'routineDayComplete';
type SessionResult = { reason: SessionEndReason; count: number; elapsedSec: number };

const RECORD_MODE_SECONDS = 60; // fallback before a duration is chosen
const RECORD_TIME_OPTIONS = [30, 60, 90, 120];

function formatRecordDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (minutes === 0) return `${secs}초`;
  if (secs === 0) return `${minutes}분`;
  return `${minutes}분 ${secs}초`;
}
// Matches the gauge's visual red zone (top 20% — see gaugeZone flex values
// in ProgressGauge below), not DOWN_NORM_THRESHOLD/UP_NORM_THRESHOLD (which
// drive counting hysteresis and are a different, unrelated pair of cutoffs).
const RED_ZONE_PROGRESS_THRESHOLD = 0.2;
const RED_ZONE_DISQUALIFY_MS = 2000;
// record and adventure both run on a countdown clock with the same
// red-zone/posture disqualification ruleset — practice is the only mode
// without either.
function isTimedMode(mode: Mode | null): boolean {
  return mode === 'record' || mode === 'adventure';
}

// armCurlTest is a temporary tuning aid (see its comment in pose.ts), not a
// real workout mode — remove this tab once pushup/squat tuning is done.
const EXERCISE_ORDER: ExerciseId[] = ['pushup', 'squat', 'jumpingJack', 'armCurlTest'];

/** Exercises with a small-amplitude verticalDisplacement signal need a smaller calibration-range floor than the default. */
function createDisplacementCounter(id: ExerciseId): VerticalRepCounter {
  const config = EXERCISES[id];
  const minCalibrationRange = config.signal === 'verticalDisplacement' ? config.minCalibrationRange : undefined;
  return new VerticalRepCounter(undefined, undefined, undefined, minCalibrationRange);
}

export default function CameraScreen() {
  const { hasPermission, requestPermission } = useCameraPermission();

  const [mode, setMode] = useState<Mode | null>(null);
  const [cameraPosition, setCameraPosition] = useState<CameraPosition>('front');
  const [exercise, setExercise] = useState<ExerciseId>('pushup');
  const [count, setCount] = useState(0);
  const [stage, setStage] = useState<Stage>('up');
  const [phase, setPhase] = useState<Phase>('idle');
  const [calibrationSecondsLeft, setCalibrationSecondsLeft] = useState(CALIBRATION_SECONDS);
  const [timeLeftSec, setTimeLeftSec] = useState(RECORD_MODE_SECONDS);
  const [timeLimitSec, setTimeLimitSec] = useState(RECORD_MODE_SECONDS);
  const [sessionResult, setSessionResult] = useState<SessionResult | null>(null);
  const [postureOk, setPostureOk] = useState(true);
  // Adventure mode only: which stage is selected (null = showing the stage
  // list) and which stage ids have been cleared, persisted across app
  // restarts via AsyncStorage.
  const [selectedStage, setSelectedStage] = useState<StageConfig | null>(null);
  const [clearedStages, setClearedStages] = useState<ReadonlySet<string>>(new Set());
  // Adventure mode only: which exercise's stage chain is being browsed
  // (null = showing the exercise-select screen). Each exercise has its own
  // independent 1-1..1-5 progression — see adventure.ts.
  const [adventureExercise, setAdventureExercise] = useState<ExerciseId | null>(null);
  // Record mode only: the chosen countdown duration (null = showing the
  // duration-select screen).
  const [recordSeconds, setRecordSeconds] = useState<number | null>(null);
  // Routine mode only: null until the one-time baseline test is done (see
  // handleFinishBaselineTest) — persisted via AsyncStorage so it survives
  // app restarts. routineSetIndex is which set (0-based) within the current
  // day is active; not persisted — an interrupted day just restarts at set 1.
  const [routineProgress, setRoutineProgress] = useState<RoutineProgress | null>(null);
  const [routineSetIndex, setRoutineSetIndex] = useState(0);
  const [restSecondsLeft, setRestSecondsLeft] = useState(0);
  // Versus mode only: null while on the matching-intro/searching screen, set
  // once try_match() (ours or the opponent's) pairs us with someone — see
  // src/lib/versus.ts. versusSearching distinguishes "haven't pressed 매칭
  // 시작 yet" from "waiting for an opponent" on that same screen.
  const [versusMatchId, setVersusMatchId] = useState<string | null>(null);
  const [versusSearching, setVersusSearching] = useState(false);
  const [versusOpponentCount, setVersusOpponentCount] = useState(0);
  const exerciseConfig = EXERCISES[exercise];

  // Stage-list screen only: which chapter page is showing — only one
  // chapter's stages render at a time, cycled through via "다음장".
  const [chapterPageIndex, setChapterPageIndex] = useState(0);

  useEffect(() => {
    loadClearedStages().then(setClearedStages);
  }, []);

  useEffect(() => {
    loadRoutineProgress().then((p) => {
      if (p != null) setRoutineProgress(p);
    });
  }, []);

  // Reset the chapter page whenever a different exercise's stage list is
  // opened — otherwise a stale index could land past that exercise's own
  // chapter count, or just resume mid-way instead of at chapter 1.
  useEffect(() => {
    setChapterPageIndex(0);
  }, [adventureExercise]);

  // Read from refs inside the stable onResults callback so switching
  // exercise/pause doesn't force react-native-mediapipe to recreate the
  // native pose detector.
  const modeRef = useRef<Mode | null>(null);
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
  // record/adventure: when the current continuous red-zone stretch started,
  // or null while out of the red zone. Timestamp the tracking phase began,
  // used to compute the elapsed time shown on the result screen.
  const redZoneEnteredAtRef = useRef<number | null>(null);
  const sessionStartRef = useRef<number | null>(null);
  // The current session's time limit, in seconds — RECORD_MODE_SECONDS for
  // record mode, or the selected stage's own limit for adventure. Read by
  // endSession to cap the reported elapsed time.
  const sessionTimeLimitRef = useRef(RECORD_MODE_SECONDS);
  // Adventure mode only: the rep count that clears the current stage, or
  // null outside adventure mode (no target to reach, just free counting).
  const targetCountRef = useRef<number | null>(null);
  const selectedStageRef = useRef<StageConfig | null>(null);
  const clearedStagesRef = useRef<ReadonlySet<string>>(new Set());
  const recordSecondsRef = useRef<number | null>(null);
  const routineProgressRef = useRef<RoutineProgress | null>(null);
  const routineSetIndexRef = useRef(0);
  const versusMatchIdRef = useRef<string | null>(null);
  const versusUserIdRef = useRef<string | null>(null);
  const versusMatchStartedAtRef = useRef<string | null>(null);
  const versusMatchDurationRef = useRef(60);
  const versusUnsubscribeMatchRef = useRef<(() => void) | null>(null);
  const versusUnsubscribeIncomingRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    selectedStageRef.current = selectedStage;
  }, [selectedStage]);
  useEffect(() => {
    clearedStagesRef.current = clearedStages;
  }, [clearedStages]);
  useEffect(() => {
    recordSecondsRef.current = recordSeconds;
  }, [recordSeconds]);
  useEffect(() => {
    routineProgressRef.current = routineProgress;
  }, [routineProgress]);
  useEffect(() => {
    routineSetIndexRef.current = routineSetIndex;
  }, [routineSetIndex]);
  useEffect(() => {
    versusMatchIdRef.current = versusMatchId;
  }, [versusMatchId]);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);
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
      if (modeRef.current === 'record') {
        const limit = recordSecondsRef.current ?? RECORD_MODE_SECONDS;
        sessionTimeLimitRef.current = limit;
        targetCountRef.current = null;
        sessionStartRef.current = Date.now();
        redZoneEnteredAtRef.current = null;
        setTimeLeftSec(limit);
        setTimeLimitSec(limit);
      } else if (modeRef.current === 'adventure' && selectedStageRef.current != null) {
        const limit = selectedStageRef.current.timeLimitSec;
        sessionTimeLimitRef.current = limit;
        targetCountRef.current = selectedStageRef.current.targetCount;
        sessionStartRef.current = Date.now();
        redZoneEnteredAtRef.current = null;
        setTimeLeftSec(limit);
        setTimeLimitSec(limit);
      } else if (modeRef.current === 'routine' && routineProgressRef.current != null) {
        // Untimed — routine's only pacing is the per-set target + the rest
        // timer between sets (see the 'resting' phase effect below), no
        // overall clock. A null routineProgressRef here means this
        // calibration is for the one-time baseline test instead (see
        // handleFinishBaselineTest) — targetCountRef stays null so it never
        // auto-completes, same as practice mode.
        const { week, day, track } = routineProgressRef.current;
        const sets = getRoutineDaySets(week, day, track);
        targetCountRef.current = sets[routineSetIndexRef.current] ?? null;
      } else if (modeRef.current === 'versus' && versusMatchIdRef.current != null) {
        // No fixed target — race the clock and the opponent's live count
        // instead. sessionStartRef is the match's server started_at (not
        // this device's calibration-end time) so both players' countdowns
        // agree regardless of any difference in how long each side's
        // calibration hold took.
        const startedAtMs =
          versusMatchStartedAtRef.current != null ? new Date(versusMatchStartedAtRef.current).getTime() : Date.now();
        const durationSec = versusMatchDurationRef.current;
        const remaining = Math.max(0, Math.round(durationSec - (Date.now() - startedAtMs) / 1000));
        sessionTimeLimitRef.current = durationSec;
        targetCountRef.current = null;
        sessionStartRef.current = startedAtMs;
        redZoneEnteredAtRef.current = null;
        setTimeLeftSec(remaining);
        setTimeLimitSec(durationSec);
      }
      setPhase('tracking');
      return;
    }
    const timer = setTimeout(() => setCalibrationSecondsLeft((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [phase, calibrationSecondsLeft]);

  // Ends the current timed attempt (time ran out, disqualified, or — in
  // adventure mode — the stage's target count was reached) and shows the
  // result screen. Only reads refs/stable setters, so it's safe to call
  // from onResults despite that callback's empty dep array.
  const endSession = useCallback((reason: SessionEndReason) => {
    const elapsedSec =
      sessionStartRef.current != null
        ? Math.min(sessionTimeLimitRef.current, Math.round((Date.now() - sessionStartRef.current) / 1000))
        : 0;
    setSessionResult({ reason, count: countRef.current, elapsedSec });
    setPhase('idle');
    if (reason === 'cleared' && selectedStageRef.current != null) {
      const stageId = selectedStageRef.current.id;
      saveClearedStage(stageId, clearedStagesRef.current).then(() => {
        setClearedStages((prev) => new Set(prev).add(stageId));
      });
    }
  }, []);

  // record/adventure/versus's countdown — only runs while actually tracking.
  useEffect(() => {
    if ((!isTimedMode(mode) && mode !== 'versus') || phase !== 'tracking') return;
    if (timeLeftSec <= 0) {
      if (mode === 'versus' && versusMatchIdRef.current != null) {
        // Marks the match 'finished' server-side so the opponent's
        // subscription picks it up even if their own local clock (started
        // from the same server timestamp, but ticking independently) hasn't
        // quite reached zero yet.
        finishMatch(versusMatchIdRef.current);
        versusUnsubscribeMatchRef.current?.();
        versusUnsubscribeMatchRef.current = null;
      }
      endSession('time');
      return;
    }
    const timer = setTimeout(() => setTimeLeftSec((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [mode, phase, timeLeftSec, endSession]);

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

      // Feeds the gauge and, in record/adventure mode, tracks continuous
      // red-zone time — disqualifying the attempt if it's spent too long
      // there.
      const applyProgress = (p: number) => {
        progressGaugeRef.current?.setTargetProgress(p);
        if (!isTimedMode(modeRef.current)) return;
        if (p < RED_ZONE_PROGRESS_THRESHOLD) {
          if (redZoneEnteredAtRef.current == null) {
            redZoneEnteredAtRef.current = Date.now();
          } else if (Date.now() - redZoneEnteredAtRef.current >= RED_ZONE_DISQUALIFY_MS) {
            endSession('disqualified');
          }
        } else {
          redZoneEnteredAtRef.current = null;
        }
      };

      // Marks (or extends) the current invalid-posture/no-person stretch,
      // disqualifying in record/adventure mode once it's run long enough. Standing up
      // to rest doesn't necessarily land in the gauge's red zone — the
      // seeded reference is wherever the person happened to be at the end
      // of the calibration hold (the exercise's *starting* position), not
      // "fully upright," so standing can land anywhere in the deviation
      // range, including the middle "in progress" zone. isValidPosture
      // already recognizes "not actually in the exercise position" (e.g.
      // its torso-orientation check for push-ups) independent of that
      // seeded reference, so a sustained failure there is the reliable
      // signal that they've stood up to rest, not the gauge position.
      const markInvalidPosture = () => {
        if (invalidPostureSinceRef.current == null) {
          invalidPostureSinceRef.current = Date.now();
        } else if (
          isTimedMode(modeRef.current) &&
          Date.now() - invalidPostureSinceRef.current >= RED_ZONE_DISQUALIFY_MS
        ) {
          endSession('disqualified');
        }
      };

      // Runs after every counted rep. Adventure/routine: reaching the
      // current target ends the attempt immediately rather than waiting for
      // time to run out — adventure clears the stage outright (endSession);
      // routine instead starts that day's rest timer before moving on to
      // the next set (see the 'resting' phase effect below); a null
      // routineProgressRef means this is the untimed baseline test instead,
      // which has no target to reach (targetCountRef stays null, so this is
      // a no-op). Versus has no target at all — it just pushes the new
      // count to the match row so the opponent's live view updates.
      const checkTargetReached = () => {
        if (modeRef.current === 'versus' && versusMatchIdRef.current != null) {
          updateMyCount(versusMatchIdRef.current, countRef.current);
          return;
        }
        if (targetCountRef.current == null || countRef.current < targetCountRef.current) return;
        if (modeRef.current === 'adventure') {
          endSession('cleared');
        } else if (modeRef.current === 'routine' && routineProgressRef.current != null) {
          setRestSecondsLeft(getRoutineRestSec(routineProgressRef.current.week, routineProgressRef.current.day));
          setPhase('resting');
        }
      };

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
        } else {
          markInvalidPosture();
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
              applyProgress(update.progress);
              if (update.stage !== stageRef.current) {
                stageRef.current = update.stage;
                setStage(update.stage);
              }
              if (update.justCounted) {
                countRef.current = angleCounterRef.current.count;
                setCount(countRef.current);
                checkTargetReached();
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
                applyProgress(update.progress);
                if (update.stage !== stageRef.current) {
                  stageRef.current = update.stage;
                  setStage(update.stage);
                }
                if (update.justCounted) {
                  countRef.current = displacementCounterRef.current.count;
                  setCount(countRef.current);
                  checkTargetReached();
                }
              }
            }
          } else {
            // Side-angle signal: the knee angle itself is rotation-invariant,
            // but SideAngleRepCounter also compares hip/knee Y to judge how
            // far the hip has dropped (depth-ratio check), which needs
            // actual up/down-on-screen Y — so this must use the
            // rotation-corrected screenPts, not raw sensor-space pts (same
            // reasoning as the verticalDisplacement branch above).
            const left = {
              hip: screenPts[config.left[0]],
              knee: screenPts[config.left[1]],
              ankle: screenPts[config.left[2]],
            };
            const right = {
              hip: screenPts[config.right[0]],
              knee: screenPts[config.right[1]],
              ankle: screenPts[config.right[2]],
            };
            const update = sideAngleCounterRef.current.update(left, right, Date.now());
            if (update != null) {
              applyProgress(update.progress);
              if (update.stage !== stageRef.current) {
                stageRef.current = update.stage;
                setStage(update.stage);
              }
              if (update.justCounted) {
                countRef.current = sideAngleCounterRef.current.count;
                setCount(countRef.current);
                checkTargetReached();
              }
            }
          }
        }
      } else {
        setPostureOk(true);
        progressGaugeRef.current?.setTargetProgress(null);
        // Not "in the red zone" (no progress reading to judge), but no
        // person at all is at least as much "not in position" — walking out
        // of frame is the clearest possible rest/cheat in record mode, so it
        // goes through the same markInvalidPosture path as a sustained
        // invalid posture (also drives the recalibration trigger on return).
        redZoneEnteredAtRef.current = null;
        markInvalidPosture();
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
    redZoneEnteredAtRef.current = null;
    sessionStartRef.current = null;
    sessionTimeLimitRef.current = RECORD_MODE_SECONDS;
    // Always cleared, not just outside adventure mode — otherwise a leftover
    // target from a previous stage attempt could trigger checkTargetReached
    // after switching to practice/record.
    targetCountRef.current = null;
    setCount(0);
    setStage('up');
    progressGaugeRef.current?.setTargetProgress(null);
    setPhase('idle');
    setTimeLeftSec(RECORD_MODE_SECONDS);
    setTimeLimitSec(RECORD_MODE_SECONDS);
    setSessionResult(null);
  };

  // Adventure mode: enter a stage's intro/idle screen (still requires
  // pressing 시작 to begin the calibration hold, same as every other mode).
  const handleSelectStage = (targetStage: StageConfig) => {
    setSelectedStage(targetStage);
    setExercise(targetStage.exercise);
    setPostureOk(true);
    displacementCounterRef.current = createDisplacementCounter(targetStage.exercise);
    handleReset();
  };

  const handleSelectExercise = (id: ExerciseId) => {
    if (id === exercise) return;
    // Switching exercise rebuilds the counters via handleReset(), which also
    // drops the phase back to 'idle' — mid-run (calibrating or tracking)
    // that would silently abandon a timed attempt with no result screen and
    // no failure recorded. Require stopping first.
    if (phase !== 'idle') return;
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
    // Retrying (다시하기) after a finished attempt previously left the old
    // count/counters in place — the display wouldn't visibly reset to 0
    // until the first new rep landed, and that rep would land on top of the
    // stale internal count. A fresh attempt always starts from a clean slate.
    handleReset();
    setCalibrationSecondsLeft(CALIBRATION_SECONDS);
    calibrationYRef.current = null;
    setPhase('calibrating');
  };

  const handleStop = () => {
    setPhase('idle');
  };

  // Routine mode's one-time baseline test: an untimed free count (like
  // practice mode — targetCountRef stays null the whole time, see the
  // calibration-end effect above), ended by the user instead of a target.
  // The result picks a difficulty track and starting week (see routine.ts)
  // and is persisted so it's never asked again.
  const handleFinishBaselineTest = () => {
    const baseline = countRef.current;
    const progress: RoutineProgress = {
      baseline,
      track: resolveTrack(baseline),
      week: startingWeek(baseline),
      day: 1,
    };
    handleReset();
    setRoutineProgress(progress);
    saveRoutineProgress(progress);
  };

  // Routine mode: (re)starts from set 1 — mid-day progress (routineSetIndex)
  // isn't persisted, so an interrupted day just restarts rather than
  // resuming. Also used to kick off the baseline test itself (routineProgress
  // is still null then, so routineSetIndex is simply unused until it's set).
  const handleStartRoutineDay = () => {
    if (exercise !== 'pushup') {
      setExercise('pushup');
      displacementCounterRef.current = createDisplacementCounter('pushup');
    }
    setRoutineSetIndex(0);
    handleStart();
  };

  // Routine mode: called after the rest timer between sets/days finishes,
  // or "요일 메뉴로" (back to the day screen without advancing). Advances to
  // the next day (wrapping into next week after day 3, capped at the last
  // week) and persists it.
  const handleFinishRoutineDay = () => {
    setRoutineProgress((prev) => {
      if (prev == null) return prev;
      const advanceWeek = prev.day >= ROUTINE_DAY_COUNT;
      const next: RoutineProgress = {
        ...prev,
        day: advanceWeek ? 1 : prev.day + 1,
        week: advanceWeek ? Math.min(ROUTINE_WEEK_COUNT, prev.week + 1) : prev.week,
      };
      saveRoutineProgress(next);
      return next;
    });
    handleReset();
  };

  const handleChangeRoutineWeek = (delta: number) => {
    setRoutineProgress((prev) => {
      if (prev == null) return prev;
      const next: RoutineProgress = { ...prev, week: Math.min(ROUTINE_WEEK_COUNT, Math.max(1, prev.week + delta)) };
      saveRoutineProgress(next);
      return next;
    });
  };

  const handleSelectRoutineDay = (day: number) => {
    setRoutineProgress((prev) => {
      if (prev == null) return prev;
      const next: RoutineProgress = { ...prev, day };
      saveRoutineProgress(next);
      return next;
    });
  };

  // Wipes the saved baseline/track/week/day so the day-select screen falls
  // back to the baseline-intro screen (routineProgress == null) — the only
  // way to redo the one-time baseline test.
  const handleResetRoutineBaseline = () => {
    setRoutineProgress(null);
    clearRoutineProgress();
  };

  // Versus mode: called once a match id is known, whether from our own
  // startMatchmaking() call (opponent was already waiting) or from
  // subscribeToIncomingMatch (we were the one waiting). Fetches the match
  // row once for its started_at/duration/initial opponent count, subscribes
  // to further live updates, then enters the shared calibrating→tracking
  // flow exactly like every other mode's 시작 button.
  const beginVersusMatch = async (matchId: string) => {
    versusUnsubscribeIncomingRef.current?.();
    versusUnsubscribeIncomingRef.current = null;

    const match = await getMatch(matchId);
    if (match == null) {
      setVersusSearching(false);
      return;
    }
    const myId = versusUserIdRef.current;
    versusMatchStartedAtRef.current = match.started_at;
    versusMatchDurationRef.current = match.duration_sec;
    setVersusOpponentCount(match.player1_id === myId ? match.player2_count : match.player1_count);

    versusUnsubscribeMatchRef.current?.();
    versusUnsubscribeMatchRef.current = subscribeToMatch(matchId, (updated) => {
      const opponentCount = updated.player1_id === myId ? updated.player2_count : updated.player1_count;
      setVersusOpponentCount(opponentCount);
      if (updated.status === 'finished' && phaseRef.current === 'tracking') {
        // The opponent's clock (started from the same server timestamp,
        // but ticking independently on their device) hit zero first —
        // wrap up our side too instead of waiting for our own to catch up.
        versusUnsubscribeMatchRef.current?.();
        versusUnsubscribeMatchRef.current = null;
        endSession('time');
      }
    });

    setVersusSearching(false);
    setVersusMatchId(matchId);
    handleStart();
  };

  const handleStartVersusMatchmaking = async () => {
    setVersusSearching(true);
    try {
      const userId = await ensureAnonymousSession();
      versusUserIdRef.current = userId;
      const matchId = await startMatchmaking();
      if (matchId != null) {
        await beginVersusMatch(matchId);
      } else {
        versusUnsubscribeIncomingRef.current?.();
        versusUnsubscribeIncomingRef.current = subscribeToIncomingMatch(userId, (foundMatchId) => {
          beginVersusMatch(foundMatchId);
        });
      }
    } catch (e) {
      console.warn('versus matchmaking failed', e);
      setVersusSearching(false);
    }
  };

  const handleCancelVersusMatchmaking = () => {
    versusUnsubscribeIncomingRef.current?.();
    versusUnsubscribeIncomingRef.current = null;
    setVersusSearching(false);
    cancelMatchmaking();
  };

  // Leaves the current match (forfeit, or just "다시 매칭" after a finished
  // one) — unsubscribes and drops back to the matching-intro screen
  // (versusMatchId == null). Used by both the result screen's "다시 매칭"
  // button and the back-navigation forfeit path below.
  const handleLeaveVersusMatch = () => {
    versusUnsubscribeMatchRef.current?.();
    versusUnsubscribeMatchRef.current = null;
    setVersusMatchId(null);
    setVersusOpponentCount(0);
    handleReset();
  };

  // Drives the rest countdown between sets: ticks restSecondsLeft down once
  // a second, then either starts the next set's calibration hold (same
  // handleStart() flow as pressing 시작) or, if that was the day's last set,
  // shows the day-complete result screen.
  useEffect(() => {
    if (phase !== 'resting') return;
    if (restSecondsLeft <= 0) {
      const progress = routineProgressRef.current;
      const sets = progress != null ? getRoutineDaySets(progress.week, progress.day, progress.track) : [];
      const nextIndex = routineSetIndexRef.current + 1;
      if (progress != null && nextIndex < sets.length) {
        setRoutineSetIndex(nextIndex);
        handleStart();
      } else {
        endSession('routineDayComplete');
      }
      return;
    }
    const timer = setTimeout(() => setRestSecondsLeft((s) => s - 1), 1000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, restSecondsLeft, endSession]);

  // Android hardware/gesture back button otherwise exits the app straight
  // from any screen — map it to the same "go back one level" the in-app
  // back button (topBar, below) does: camera/tracking → stage select →
  // exercise select → mode select → root (mode select), where returning
  // false lets the system default (exit app) happen.
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (mode == null) return false;
      handleStop();
      if (mode === 'adventure' && selectedStage != null) {
        setSelectedStage(null);
      } else if (mode === 'adventure' && adventureExercise != null) {
        setAdventureExercise(null);
      } else if (mode === 'record' && recordSeconds != null) {
        setRecordSeconds(null);
      } else if (mode === 'routine' && phase === 'idle') {
        // On the baseline-intro or day-select screen (not mid-workout) —
        // back exits routine mode entirely.
        setMode(null);
      } else if (mode === 'routine') {
        // Mid-workout — handleStop() above already drops phase back to
        // 'idle', which re-renders into the baseline-intro/day-select
        // screen on its own; nothing else to do here.
      } else if (mode === 'versus' && versusMatchId != null) {
        // Mid-match or on its result screen — forfeit/leave, back to the
        // matching-intro screen (still inside versus mode).
        handleLeaveVersusMatch();
      } else if (mode === 'versus') {
        // On the matching-intro/searching screen itself — back exits versus
        // mode entirely.
        handleCancelVersusMatchmaking();
        setMode(null);
      } else {
        setMode(null);
      }
      return true;
    });
    return () => subscription.remove();
  }, [mode, phase, selectedStage, adventureExercise, recordSeconds, versusMatchId]);

  if (mode == null) {
    return (
      <View style={styles.center}>
        <Text style={styles.modeSelectTitle}>모드 선택</Text>
        <Pressable style={styles.modeButton} onPress={() => setMode('practice')}>
          <Text style={styles.modeButtonTitle}>연습모드</Text>
          <Text style={styles.modeButtonDesc}>시간 제한 없이 자유롭게 연습해요</Text>
        </Pressable>
        <Pressable style={styles.modeButton} onPress={() => setMode('record')}>
          <Text style={styles.modeButtonTitle}>기록모드</Text>
          <Text style={styles.modeButtonDesc}>
            정해진 시간 안에 최대한 많이 · 레드존에 2초 이상 있으면 탈락
          </Text>
        </Pressable>
        <Pressable style={styles.modeButton} onPress={() => setMode('adventure')}>
          <Text style={styles.modeButtonTitle}>모험모드</Text>
          <Text style={styles.modeButtonDesc}>스테이지를 하나씩 깨며 성장해요</Text>
        </Pressable>
        <Pressable
          style={styles.modeButton}
          onPress={() => {
            setMode('routine');
            if (exercise !== 'pushup') {
              setExercise('pushup');
              displacementCounterRef.current = createDisplacementCounter('pushup');
            }
          }}
        >
          <Text style={styles.modeButtonTitle}>루틴모드</Text>
          <Text style={styles.modeButtonDesc}>6주 푸시업 프로그램 · 세트와 휴식으로 진행해요</Text>
        </Pressable>
        <Pressable
          style={styles.modeButton}
          onPress={() => {
            setMode('versus');
            if (exercise !== 'pushup') {
              setExercise('pushup');
              displacementCounterRef.current = createDisplacementCounter('pushup');
            }
          }}
        >
          <Text style={styles.modeButtonTitle}>대결모드</Text>
          <Text style={styles.modeButtonDesc}>임의의 상대와 실시간으로 개수를 겨뤄요 (푸시업)</Text>
        </Pressable>
      </View>
    );
  }

  if (mode === 'record' && recordSeconds == null) {
    return (
      <View style={styles.center}>
        <Text style={styles.modeSelectTitle}>기록모드</Text>
        {RECORD_TIME_OPTIONS.map((seconds) => (
          <Pressable key={seconds} style={styles.modeButton} onPress={() => setRecordSeconds(seconds)}>
            <Text style={styles.modeButtonTitle}>{formatRecordDuration(seconds)}</Text>
          </Pressable>
        ))}
        <Pressable style={styles.button} onPress={() => setMode(null)}>
          <Text style={styles.buttonText}>모드 선택으로</Text>
        </Pressable>
      </View>
    );
  }

  if (mode === 'adventure' && adventureExercise == null) {
    return (
      <View style={styles.center}>
        <Text style={styles.modeSelectTitle}>모험모드</Text>
        {/* armCurlTest is a tuning aid, not a real workout — no adventure chain for it. */}
        {(['pushup', 'squat', 'jumpingJack'] as ExerciseId[]).map((id) => (
          <Pressable key={id} style={styles.modeButton} onPress={() => setAdventureExercise(id)}>
            <Text style={styles.modeButtonTitle}>{EXERCISES[id].label}</Text>
          </Pressable>
        ))}
        <Pressable style={styles.button} onPress={() => setMode(null)}>
          <Text style={styles.buttonText}>모드 선택으로</Text>
        </Pressable>
      </View>
    );
  }

  if (mode === 'adventure' && selectedStage == null && adventureExercise != null) {
    const stages = ADVENTURE_STAGES.filter((s) => s.exercise === adventureExercise);
    const chapters = Array.from(new Set(stages.map((s) => s.chapter))).sort((a, b) => a - b);
    const currentChapter = chapters[chapterPageIndex % chapters.length];
    const chapterStages = stages.filter((s) => s.chapter === currentChapter);
    return (
      <View style={[styles.center, { padding: 0 }]}>
        <View style={styles.stageListTopBar}>
          <Pressable style={styles.backButton} onPress={() => setAdventureExercise(null)}>
            <Text style={styles.backButtonText}>‹ 운동 선택</Text>
          </Pressable>
          <View style={styles.stageListTitleOverlay} pointerEvents="none">
            <Text style={styles.stageListTopBarTitle}>
              {EXERCISES[adventureExercise].label} · {currentChapter}장
            </Text>
          </View>
        </View>
        <ScrollView
          key={currentChapter}
          style={styles.stageListScroll}
          contentContainerStyle={styles.stageListContent}
        >
          {chapterStages.map((s) => {
            const unlocked = isStageUnlocked(s, clearedStages);
            const isCleared = clearedStages.has(s.id);
            return (
              <Pressable
                key={s.id}
                style={[styles.modeButton, styles.stageButtonRow, !unlocked && styles.modeButtonLocked]}
                disabled={!unlocked}
                onPress={() => handleSelectStage(s)}
              >
                <MonsterSprite stageId={s.id} size={48} />
                <View style={styles.stageButtonText}>
                  <Text style={styles.modeButtonTitle}>
                    {s.label} {isCleared ? '✓' : !unlocked ? '🔒' : ''}
                  </Text>
                  <Text style={styles.modeButtonDesc}>
                    {EXERCISES[s.exercise].label} {s.targetCount}회 · {s.timeLimitSec}초 안에
                  </Text>
                </View>
              </Pressable>
            );
          })}
          {chapters.length > 1 && (
            <View style={styles.chapterNavRow}>
              <Pressable
                style={styles.chapterNavButton}
                onPress={() => setChapterPageIndex((i) => (i - 1 + chapters.length) % chapters.length)}
              >
                <Text style={styles.chapterNavButtonText}>이전</Text>
              </Pressable>
              <Pressable
                style={styles.chapterNavButton}
                onPress={() => setChapterPageIndex((i) => (i + 1) % chapters.length)}
              >
                <Text style={styles.chapterNavButtonText}>다음</Text>
              </Pressable>
            </View>
          )}
        </ScrollView>
      </View>
    );
  }

  // Routine mode, no baseline yet, and not currently mid-test (phase !==
  // 'idle' means the untimed baseline test is running — fall through to the
  // shared tracking screen below instead of this intro).
  if (mode === 'routine' && routineProgress == null && phase === 'idle') {
    return (
      <View style={[styles.center, { padding: 0 }]}>
        <View style={styles.stageListTopBar}>
          <Pressable style={styles.backButton} onPress={() => setMode(null)}>
            <Text style={styles.backButtonText}>‹ 모드 선택</Text>
          </Pressable>
          <View style={styles.stageListTitleOverlay} pointerEvents="none">
            <Text style={styles.stageListTopBarTitle}>루틴모드</Text>
          </View>
        </View>
        <View style={styles.stageListContent}>
          <Text style={styles.modeButtonDesc}>
            먼저 정자세로 푸시업을 최대한 많이 해보세요. 개수에 따라 시작 주차와 난이도가
            정해져요. 시간 제한은 없고, 다 하시면 "측정 종료"를 눌러주세요.
          </Text>
          <Pressable style={styles.button} onPress={handleStartRoutineDay}>
            <Text style={styles.buttonText}>측정 시작</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  // Routine mode, baseline already measured, and not currently mid-workout.
  if (mode === 'routine' && routineProgress != null && phase === 'idle') {
    const daySets = getRoutineDaySets(routineProgress.week, routineProgress.day, routineProgress.track);
    return (
      <View style={[styles.center, { padding: 0 }]}>
        <View style={styles.stageListTopBar}>
          <Pressable style={styles.backButton} onPress={() => setMode(null)}>
            <Text style={styles.backButtonText}>‹ 모드 선택</Text>
          </Pressable>
          <View style={styles.stageListTitleOverlay} pointerEvents="none">
            <Text style={styles.stageListTopBarTitle}>
              {routineProgress.week}주차 {routineProgress.day}일차
            </Text>
          </View>
        </View>
        <ScrollView style={styles.stageListScroll} contentContainerStyle={styles.stageListContent}>
          <View style={styles.exerciseTabs}>
            {[1, 2, 3].map((d) => (
              <Pressable
                key={d}
                style={[styles.tab, routineProgress.day === d && styles.tabActive]}
                onPress={() => handleSelectRoutineDay(d)}
              >
                <Text style={[styles.tabText, routineProgress.day === d && styles.tabTextActive]}>{d}일차</Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.modeButton}>
            {daySets.map((target, i) => (
              <Text key={i} style={styles.modeButtonDesc}>
                SET {i + 1}: {target}회
              </Text>
            ))}
          </View>
          <Pressable style={styles.button} onPress={handleStartRoutineDay}>
            <Text style={styles.buttonText}>시작</Text>
          </Pressable>
          <View style={styles.chapterNavRow}>
            <Pressable style={styles.chapterNavButton} onPress={() => handleChangeRoutineWeek(-1)}>
              <Text style={styles.chapterNavButtonText}>이전주</Text>
            </Pressable>
            <Pressable style={styles.chapterNavButton} onPress={() => handleChangeRoutineWeek(1)}>
              <Text style={styles.chapterNavButtonText}>다음주</Text>
            </Pressable>
          </View>
          <Pressable style={styles.backButton} onPress={handleResetRoutineBaseline}>
            <Text style={styles.backButtonText}>베이스라인 다시 측정</Text>
          </Pressable>
        </ScrollView>
      </View>
    );
  }

  // Versus mode, not currently matched (still on the matching-intro screen,
  // whether waiting or not — see versusSearching). Once matched,
  // beginVersusMatch() sets versusMatchId and calls handleStart(), which
  // falls through to the shared tracking screen below instead of this one.
  if (mode === 'versus' && versusMatchId == null) {
    return (
      <View style={[styles.center, { padding: 0 }]}>
        <View style={styles.stageListTopBar}>
          <Pressable
            style={styles.backButton}
            onPress={() => {
              handleCancelVersusMatchmaking();
              setMode(null);
            }}
          >
            <Text style={styles.backButtonText}>‹ 모드 선택</Text>
          </Pressable>
          <View style={styles.stageListTitleOverlay} pointerEvents="none">
            <Text style={styles.stageListTopBarTitle}>대결모드</Text>
          </View>
        </View>
        <View style={styles.stageListContent}>
          {versusSearching ? (
            <>
              <Text style={styles.modeButtonDesc}>상대를 찾는 중...</Text>
              <Pressable style={[styles.button, styles.buttonSecondary]} onPress={handleCancelVersusMatchmaking}>
                <Text style={styles.buttonText}>취소</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text style={styles.modeButtonDesc}>
                임의의 상대와 매칭되면 둘 다 같은 시간에 시작해서 1분 동안 실시간으로 개수를
                겨뤄요.
              </Text>
              <Pressable style={styles.button} onPress={handleStartVersusMatchmaking}>
                <Text style={styles.buttonText}>매칭 시작</Text>
              </Pressable>
            </>
          )}
        </View>
      </View>
    );
  }

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

  // Precompute the result overlay's text/buttons — reason alone is
  // ambiguous in adventure mode ('time'/'disqualified' both mean "failed
  // this attempt", 'cleared' means success with a "next stage" option).
  let resultTitle = '';
  let resultShowsNext = false;
  if (sessionResult != null) {
    if (mode === 'adventure') {
      if (sessionResult.reason === 'cleared') {
        resultTitle = '스테이지 클리어!';
        resultShowsNext = selectedStage != null && nextStage(selectedStage) != null;
      } else if (sessionResult.reason === 'disqualified') {
        resultTitle = '자세 이탈로 실패...';
      } else {
        resultTitle = '시간 종료... 실패';
      }
    } else if (mode === 'routine') {
      resultTitle = '오늘 루틴 완료!';
    } else if (mode === 'versus') {
      if (sessionResult.count > versusOpponentCount) resultTitle = '승리! 🎉';
      else if (sessionResult.count < versusOpponentCount) resultTitle = '패배...';
      else resultTitle = '무승부';
    } else {
      resultTitle = sessionResult.reason === 'time' ? '시간 종료!' : '레드존 초과로 탈락!';
    }
  }

  // Boss HUD (adventure only): each rep "hits" the stage's monster — its HP
  // is the reps still needed to clear, draining to 0 as count climbs toward
  // the target.
  const bossHp = selectedStage != null ? Math.max(0, selectedStage.targetCount - count) : 0;
  const bossHpPercent = selectedStage != null && selectedStage.targetCount > 0 ? (bossHp / selectedStage.targetCount) * 100 : 100;

  // Routine mode: this day's full set list (for the current track) and the
  // current set's target, used for the "SET n/총n" readout and the counter
  // card's " / N" suffix below.
  const routineDaySets =
    mode === 'routine' && routineProgress != null
      ? getRoutineDaySets(routineProgress.week, routineProgress.day, routineProgress.track)
      : [];
  const routineTarget = routineDaySets[routineSetIndex] ?? null;

  return (
    <View style={styles.container}>
      <View style={styles.topBar}>
        <Pressable
          style={styles.backButton}
          onPress={() => {
            handleStop();
            if (mode === 'adventure' && selectedStage != null) {
              setSelectedStage(null);
            } else if (mode === 'adventure' && adventureExercise != null) {
              setAdventureExercise(null);
            } else if (mode === 'record' && recordSeconds != null) {
              setRecordSeconds(null);
            } else if (mode === 'routine') {
              // handleStop() above already drops back to the
              // baseline-intro/day-select screen — nothing else to do.
            } else if (mode === 'versus') {
              // This button only exists on the tracking screen, i.e. always
              // mid-match/result here — forfeit/leave back to matching-intro.
              handleLeaveVersusMatch();
            } else {
              setMode(null);
            }
          }}
        >
          <Text style={styles.backButtonText}>
            ‹{' '}
            {mode === 'adventure'
              ? (selectedStage?.label ?? '모험모드')
              : mode === 'routine'
                ? routineProgress != null
                  ? `${routineProgress.week}주차 ${routineProgress.day}일차`
                  : '베이스라인 측정'
                : mode === 'versus'
                  ? '대결모드'
                  : mode != null
                    ? MODE_LABELS[mode]
                    : '모드'}
          </Text>
        </Pressable>
        {/* Routine/versus are push-up only (fixed by the program, or needed
            so two randomly-matched strangers are racing on the same
            exercise), so there's no exercise to switch — the tab bar would
            just be misleading. */}
        {mode !== 'routine' && mode !== 'versus' && (
          <View style={styles.exerciseTabs}>
            {/* armCurlTest is a tuning aid, not a real workout — hide it in
                adventure mode's tab bar (record/practice can still reach it). */}
            {(mode === 'adventure' ? EXERCISE_ORDER.filter((id) => id !== 'armCurlTest') : EXERCISE_ORDER).map(
              (id) => (
                <Pressable
                  key={id}
                  style={[styles.tab, exercise === id && styles.tabActive, phase !== 'idle' && styles.tabDisabled]}
                  disabled={phase !== 'idle'}
                  onPress={() => handleSelectExercise(id)}
                >
                  <Text style={[styles.tabText, exercise === id && styles.tabTextActive]}>
                    {EXERCISES[id].label}
                  </Text>
                </Pressable>
              )
            )}
          </View>
        )}
      </View>
      {mode === 'adventure' && selectedStage != null && (
        // The stage still sets its own target count/time limit — only the
        // exercise used to reach it is now free to switch (see tabs above).
        <Text style={styles.stageInfoText}>
          {selectedStage.targetCount}회 · {selectedStage.timeLimitSec}초 안에
        </Text>
      )}
      {mode === 'routine' && routineProgress != null && (
        <Text style={styles.stageInfoText}>
          SET {routineSetIndex + 1}/{routineDaySets.length}
          {routineTarget != null ? ` · 목표 ${routineTarget}회` : ''}
        </Text>
      )}

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

        {mode === 'adventure' && selectedStage != null && (
          <View style={styles.bossCard} pointerEvents="none">
            <MonsterSprite stageId={selectedStage.id} size={180} hitSignal={count} />
            <Text style={styles.bossName}>
              {EXERCISES[exercise].label} {selectedStage.label}
            </Text>
            <View style={styles.bossHpTrack}>
              <View style={[styles.bossHpFill, { width: `${bossHpPercent}%` }]} />
              <Text style={styles.bossHpText}>{bossHp} HP</Text>
            </View>
          </View>
        )}

        {(isTimedMode(mode) || mode === 'versus') && phase === 'tracking' && (
          // A shrinking bar reads at a glance from across a room — the
          // "30초" text badge this replaced turned out to be unreadable
          // from normal workout distance.
          <View style={styles.recordTimerBarTrack}>
            <View style={[styles.recordTimerBarFill, { width: `${(timeLeftSec / timeLimitSec) * 100}%` }]} />
          </View>
        )}

        {mode === 'versus' && (phase === 'tracking' || phase === 'calibrating') && (
          <View style={styles.versusHud} pointerEvents="none">
            <View style={styles.versusHudRow}>
              <View style={styles.versusHudSide}>
                <Text style={styles.versusHudName}>나</Text>
                <Text style={styles.versusHudCount}>{count}</Text>
              </View>
              <Text style={styles.versusHudTimer}>{phase === 'tracking' ? `${timeLeftSec}s` : 'VS'}</Text>
              <View style={styles.versusHudSide}>
                <Text style={styles.versusHudName}>상대</Text>
                <Text style={[styles.versusHudCount, styles.versusHudCountOpponent]}>{versusOpponentCount}</Text>
              </View>
            </View>
            <View style={styles.versusBarTrack}>
              <View style={[styles.versusBarFillMine, { flex: count > 0 || versusOpponentCount > 0 ? count : 1 }]} />
              <View
                style={[
                  styles.versusBarFillOpponent,
                  { flex: count > 0 || versusOpponentCount > 0 ? versusOpponentCount : 1 },
                ]}
              />
            </View>
          </View>
        )}

        {mode === 'adventure' && phase === 'tracking' && (
          <View style={styles.countdownClockCenter} pointerEvents="none">
            <View style={styles.countdownClockPill}>
              <CountdownClock active={phase === 'tracking'} startRef={sessionStartRef} limitSec={timeLimitSec} />
            </View>
          </View>
        )}

        {phase === 'calibrating' && (
          <View style={styles.calibrationOverlay}>
            <Text style={styles.calibrationCountdown}>{calibrationSecondsLeft}</Text>
            <Text style={styles.calibrationHint}>시작 자세를 잡고 잠시 멈춰있어 주세요</Text>
          </View>
        )}

        {phase === 'resting' && (
          <View style={styles.calibrationOverlay}>
            <Text style={styles.calibrationCountdown}>{restSecondsLeft}</Text>
            <Text style={styles.calibrationHint}>휴식 중 · 다음 세트를 준비하세요</Text>
            <Pressable style={styles.button} onPress={() => setRestSecondsLeft(0)}>
              <Text style={styles.buttonText}>건너뛰기</Text>
            </Pressable>
          </View>
        )}

        {phase === 'tracking' && <ProgressGauge ref={progressGaugeRef} />}

        {sessionResult != null && (
          <View style={styles.calibrationOverlay}>
            {mode === 'adventure' && sessionResult.reason === 'cleared' && selectedStage != null && (
              <MonsterSprite stageId={selectedStage.id} size={96} />
            )}
            <Text style={styles.resultTitle}>{resultTitle}</Text>
            {mode !== 'routine' && (
              <>
                <Text style={styles.resultStats}>
                  {sessionResult.count}
                  {mode === 'adventure' && selectedStage != null ? ` / ${selectedStage.targetCount}` : ''}회
                </Text>
                {mode === 'versus' && (
                  <Text style={styles.calibrationHint}>상대: {versusOpponentCount}회</Text>
                )}
                <Text style={styles.calibrationHint}>{sessionResult.elapsedSec}초 동안 기록</Text>
              </>
            )}
            {mode === 'routine' && routineProgress != null && (
              <Text style={styles.calibrationHint}>
                {routineProgress.week}주차 {routineProgress.day}일차 · 총 {routineDaySets.length}세트 완료
              </Text>
            )}
            {mode === 'adventure' ? (
              <View style={styles.controls}>
                {sessionResult.reason === 'cleared' ? (
                  <>
                    {resultShowsNext && selectedStage != null && (
                      <Pressable
                        style={styles.button}
                        onPress={() => {
                          const next = nextStage(selectedStage);
                          if (next != null) handleSelectStage(next);
                        }}
                      >
                        <Text style={styles.buttonText}>다음 스테이지</Text>
                      </Pressable>
                    )}
                    <Pressable
                      style={[styles.button, resultShowsNext && styles.buttonSecondary]}
                      onPress={handleStart}
                    >
                      <Text style={styles.buttonText}>다시하기</Text>
                    </Pressable>
                  </>
                ) : (
                  <>
                    <Pressable style={styles.button} onPress={handleStart}>
                      <Text style={styles.buttonText}>다시하기</Text>
                    </Pressable>
                    <Pressable
                      style={[styles.button, styles.buttonSecondary]}
                      onPress={() => setSelectedStage(null)}
                    >
                      <Text style={styles.buttonText}>스테이지 선택</Text>
                    </Pressable>
                  </>
                )}
              </View>
            ) : mode === 'routine' ? (
              <View style={styles.controls}>
                <Pressable style={styles.button} onPress={handleFinishRoutineDay}>
                  <Text style={styles.buttonText}>다음 요일로</Text>
                </Pressable>
                <Pressable style={[styles.button, styles.buttonSecondary]} onPress={handleReset}>
                  <Text style={styles.buttonText}>요일 메뉴로</Text>
                </Pressable>
              </View>
            ) : mode === 'versus' ? (
              <View style={styles.controls}>
                <Pressable style={styles.button} onPress={handleLeaveVersusMatch}>
                  <Text style={styles.buttonText}>다시 매칭</Text>
                </Pressable>
                <Pressable
                  style={[styles.button, styles.buttonSecondary]}
                  onPress={() => {
                    handleLeaveVersusMatch();
                    setMode(null);
                  }}
                >
                  <Text style={styles.buttonText}>모드 선택</Text>
                </Pressable>
              </View>
            ) : (
              <View style={styles.controls}>
                <Pressable style={styles.button} onPress={handleStart}>
                  <Text style={styles.buttonText}>다시하기</Text>
                </Pressable>
                <Pressable
                  style={[styles.button, styles.buttonSecondary]}
                  onPress={() => {
                    handleReset();
                    setMode(null);
                  }}
                >
                  <Text style={styles.buttonText}>모드 선택</Text>
                </Pressable>
              </View>
            )}
          </View>
        )}
      </View>

      <View style={styles.counterCard}>
        <Text style={styles.countLabel}>{exerciseConfig.label.toUpperCase()}</Text>
        <Text style={styles.countValue}>
          {count}
          {mode === 'adventure' && selectedStage != null && (
            <Text style={styles.countTarget}> / {selectedStage.targetCount}</Text>
          )}
          {mode === 'routine' && routineTarget != null && (
            <Text style={styles.countTarget}> / {routineTarget}</Text>
          )}
        </Text>
        <Text style={styles.stageLabel}>
          {stage === 'down' ? exerciseConfig.downLabel : exerciseConfig.upLabel}
        </Text>
        {phase === 'tracking' && !postureOk && exerciseConfig.postureHint != null && (
          <Text style={styles.postureHint}>{exerciseConfig.postureHint}</Text>
        )}
      </View>

      <View style={styles.controls}>
        {mode === 'routine' && routineProgress == null && phase === 'tracking' ? (
          <Pressable style={styles.button} onPress={handleFinishBaselineTest}>
            <Text style={styles.buttonText}>측정 종료</Text>
          </Pressable>
        ) : (
          <Pressable style={styles.button} onPress={phase === 'idle' ? handleStart : handleStop}>
            <Text style={styles.buttonText}>{phase === 'idle' ? '시작' : '정지'}</Text>
          </Pressable>
        )}
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
    backgroundColor: '#F0F9FF',
    paddingTop: 12,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F0F9FF',
    padding: 24,
    gap: 16,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
  },
  backButton: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: '#E0F2FE',
  },
  backButtonText: {
    color: TEXT_MUTED,
    fontSize: 14,
    fontWeight: '600',
  },
  exerciseTabs: {
    flexDirection: 'row',
    gap: 8,
  },
  modeSelectTitle: {
    color: TEXT_PRIMARY,
    fontSize: 22,
    fontWeight: '800',
    marginBottom: 8,
  },
  modeButton: {
    width: '100%',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    paddingVertical: 18,
    paddingHorizontal: 20,
    gap: 6,
    borderWidth: 1,
    borderColor: '#DBEAFE',
  },
  modeButtonTitle: {
    color: ACCENT,
    fontSize: 18,
    fontWeight: '800',
  },
  modeButtonDesc: {
    color: TEXT_MUTED,
    fontSize: 13,
  },
  modeButtonLocked: {
    opacity: 0.4,
  },
  stageButtonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  stageButtonText: {
    flex: 1,
    gap: 6,
  },
  stageListTopBar: {
    width: '100%',
    position: 'relative',
    alignItems: 'flex-start',
    paddingTop: 36,
    paddingBottom: 32,
    paddingHorizontal: 24,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#DBEAFE',
  },
  stageListTitleOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stageListTopBarTitle: {
    color: TEXT_PRIMARY,
    fontSize: 22,
    fontWeight: '800',
  },
  chapterNavRow: {
    flexDirection: 'row',
    gap: 12,
  },
  chapterNavButton: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 999,
    backgroundColor: ACCENT,
  },
  chapterNavButtonText: {
    color: TEXT_ON_ACCENT,
    fontSize: 14,
    fontWeight: '700',
  },
  stageListScroll: {
    flex: 1,
    width: '100%',
  },
  stageListContent: {
    alignItems: 'center',
    gap: 16,
    paddingVertical: 24,
    paddingHorizontal: 24,
  },
  stageInfoText: {
    color: TEXT_MUTED,
    fontSize: 13,
    fontWeight: '600',
    marginTop: -6,
    marginBottom: 8,
  },
  recordTimerBarTrack: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 10, // shorter than cameraSwitchButton's top offset (12) so they don't overlap
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  recordTimerBarFill: {
    height: '100%',
    backgroundColor: ACCENT_ON_DARK,
  },
  countdownClockCenter: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countdownClockPill: {
    paddingVertical: 16,
    paddingHorizontal: 32,
    borderRadius: 24,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  bossCard: {
    position: 'absolute',
    top: 12,
    alignSelf: 'center',
    width: '86%',
    alignItems: 'center',
    gap: 4,
  },
  bossName: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '800',
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  bossHpTrack: {
    width: '100%',
    height: 28,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.25)',
    overflow: 'hidden',
    justifyContent: 'center',
  },
  bossHpFill: {
    position: 'absolute',
    top: 0,
    left: 0,
    bottom: 0,
    backgroundColor: '#FF4D4D',
    borderRadius: 999,
  },
  bossHpText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
    textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  versusHud: {
    position: 'absolute',
    top: 12,
    alignSelf: 'center',
    width: '92%',
    gap: 8,
  },
  versusHudRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  versusHudSide: {
    alignItems: 'center',
    gap: 2,
  },
  versusHudName: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 12,
    fontWeight: '700',
  },
  versusHudCount: {
    color: '#39FF88',
    fontSize: 32,
    fontWeight: '800',
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  versusHudCountOpponent: {
    color: '#FF4D4D',
  },
  versusHudTimer: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  versusBarTrack: {
    flexDirection: 'row',
    width: '100%',
    height: 14,
    borderRadius: 999,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.25)',
  },
  versusBarFillMine: {
    backgroundColor: '#39FF88',
  },
  versusBarFillOpponent: {
    backgroundColor: '#FF4D4D',
  },
  resultTitle: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '800',
  },
  resultStats: {
    color: ACCENT_ON_DARK,
    fontSize: 64,
    fontWeight: '800',
  },
  tab: {
    paddingVertical: 8,
    paddingHorizontal: 18,
    borderRadius: 999,
    backgroundColor: '#E0F2FE',
  },
  tabActive: {
    backgroundColor: ACCENT,
  },
  tabDisabled: {
    opacity: 0.4,
  },
  tabText: {
    color: TEXT_MUTED,
    fontSize: 14,
    fontWeight: '600',
  },
  tabTextActive: {
    color: TEXT_ON_ACCENT,
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
    color: ACCENT_ON_DARK,
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
  counterCard: {
    marginTop: 20,
    alignItems: 'center',
  },
  countLabel: {
    color: TEXT_MUTED,
    fontSize: 14,
    letterSpacing: 2,
  },
  countValue: {
    color: ACCENT,
    fontSize: 88,
    fontWeight: '800',
  },
  countTarget: {
    color: TEXT_MUTED,
    fontSize: 32,
    fontWeight: '700',
  },
  stageLabel: {
    color: TEXT_PRIMARY,
    fontSize: 16,
  },
  postureHint: {
    color: '#D97706',
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
    backgroundColor: ACCENT,
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 14,
  },
  buttonSecondary: {
    backgroundColor: '#64748B',
  },
  buttonText: {
    color: TEXT_ON_ACCENT,
    fontSize: 16,
    fontWeight: '600',
  },
  hint: {
    color: TEXT_MUTED,
    fontSize: 14,
    marginTop: 12,
    textAlign: 'center',
  },
});
