import {
  AngleRepCounter,
  EXERCISES,
  JUMPING_JACK_SPREAD_RATIO,
  MIN_KEYPOINT_SCORE,
  SideAngleRepCounter,
  VerticalRepCounter,
  angleDegrees,
  angleToProgress,
  ankleSpreadRatio,
  averageVisibleY,
  isPersonPresent,
  relativeVisibleY,
  type AngleExerciseConfig,
  type Point,
} from '../pose';

const FRAME_DT_MS = 33;

function point(x: number, y: number, score = 1): Point {
  return { x, y, score };
}

describe('isPersonPresent', () => {
  it('requires at least MIN_VISIBLE_KEYPOINTS confident points', () => {
    const lowConfidence = Array.from({ length: 33 }, () => point(0, 0, 0.1));
    expect(isPersonPresent(lowConfidence)).toBe(false);

    const confident = Array.from({ length: 33 }, (_, i) =>
      point(0, 0, i < 20 ? 0.9 : 0.1)
    );
    expect(isPersonPresent(confident)).toBe(true);
  });

  it('rejects points right at the confidence boundary', () => {
    const atBoundary = Array.from({ length: 33 }, () =>
      point(0, 0, MIN_KEYPOINT_SCORE)
    );
    expect(isPersonPresent(atBoundary)).toBe(false);
  });
});

describe('averageVisibleY', () => {
  it('averages only points above the confidence threshold', () => {
    const points = [point(0, 0.2, 0.9), point(0, 0.8, 0.1), point(0, 0.4, 0.9)];
    expect(averageVisibleY(points, [0, 1, 2])).toBeCloseTo(0.3);
  });

  it('returns null when no indices are confident enough', () => {
    const points = [point(0, 0.2, 0.1)];
    expect(averageVisibleY(points, [0])).toBeNull();
  });
});

describe('relativeVisibleY', () => {
  it('returns the raw average when no reference landmarks are given', () => {
    const points = [point(0, 0.4, 0.9)];
    expect(relativeVisibleY(points, [0])).toBeCloseTo(0.4);
  });

  it('returns landmarks.y - referenceLandmarks.y when a reference is given', () => {
    const points = [point(0, 0.6, 0.9), point(0, 0.2, 0.9)];
    expect(relativeVisibleY(points, [0], [1])).toBeCloseTo(0.4);
  });

  it('stays constant under a whole-body Y shift, unlike the raw position', () => {
    // Both landmark and reference move down by the same amount (e.g. person
    // stepped closer to a low camera) — the raw position changes, but the
    // relative offset between the two points should not.
    const before = [point(0, 0.5, 0.9), point(0, 0.3, 0.9)];
    const after = [point(0, 0.7, 0.9), point(0, 0.5, 0.9)]; // both +0.2
    const relBefore = relativeVisibleY(before, [0], [1]);
    const relAfter = relativeVisibleY(after, [0], [1]);
    expect(relBefore).toBeCloseTo(relAfter!);
  });

  it('returns null if the reference landmarks are not confidently visible', () => {
    const points = [point(0, 0.6, 0.9), point(0, 0.2, 0.1)];
    expect(relativeVisibleY(points, [0], [1])).toBeNull();
  });
});

/** Builds a points array with shoulders at x=±shoulderHalfWidth and ankles at x=±ankleHalfWidth (indices 11/12/27/28). */
function stanceWidthPoints(shoulderHalfWidth: number, ankleHalfWidth: number, score = 1): Point[] {
  const points: Point[] = new Array(29).fill(point(0, 0, 0));
  points[11] = point(-shoulderHalfWidth, 0, score); // leftShoulder
  points[12] = point(shoulderHalfWidth, 0, score); // rightShoulder
  points[27] = point(-ankleHalfWidth, 1, score); // leftAnkle
  points[28] = point(ankleHalfWidth, 1, score); // rightAnkle
  return points;
}

describe('ankleSpreadRatio', () => {
  it('computes ankle distance normalized by shoulder width', () => {
    // shoulder width 0.2, ankle distance 0.5 -> ratio 2.5
    expect(ankleSpreadRatio(stanceWidthPoints(0.1, 0.25))).toBeCloseTo(2.5);
  });

  it('returns null when any required landmark is not confidently visible', () => {
    const points = stanceWidthPoints(0.1, 0.25);
    points[28] = point(0.25, 1, 0.1); // rightAnkle below confidence threshold
    expect(ankleSpreadRatio(points)).toBeNull();
  });
});

describe('angleDegrees / angleToProgress', () => {
  it('measures a straight line as 180 degrees', () => {
    expect(angleDegrees(0, -1, 0, 0, 0, 1)).toBeCloseTo(180);
  });

  it('measures a right angle as 90 degrees', () => {
    expect(angleDegrees(1, 0, 0, 0, 0, 1)).toBeCloseTo(90);
  });

  it('maps angle to a clamped 0-1 progress gauge', () => {
    const config = { upThreshold: 160, downThreshold: 100 } as const;
    expect(angleToProgress(160, config as any)).toBeCloseTo(0);
    expect(angleToProgress(100, config as any)).toBeCloseTo(1);
    expect(angleToProgress(130, config as any)).toBeCloseTo(0.5);
    // Overshoot past either end stays clamped inside [0, 1].
    expect(angleToProgress(180, config as any)).toBe(0);
    expect(angleToProgress(50, config as any)).toBe(1);
  });
});

describe('EXERCISES.pushup.isValidPosture', () => {
  const config = EXERCISES.pushup;

  it('requires wrists to be well below the shoulders', () => {
    const shoulderY = 0.3;
    const points: Point[] = new Array(25).fill(point(0, 0, 0));
    points[11] = point(0, shoulderY, 0.9); // leftShoulder
    points[12] = point(0, shoulderY, 0.9); // rightShoulder
    points[15] = point(0, shoulderY + 0.2, 0.9); // leftWrist well below
    points[16] = point(0, shoulderY + 0.2, 0.9); // rightWrist well below
    // Hips not visible (score 0) — falls back to the wrist-only check.
    expect(config.isValidPosture!(points)).toBe(true);
  });

  it('rejects a standing posture where wrists are near/above shoulder height', () => {
    const points: Point[] = new Array(25).fill(point(0, 0, 0));
    points[11] = point(0, 0.3, 0.9);
    points[12] = point(0, 0.3, 0.9);
    points[15] = point(0, 0.25, 0.9); // wrist above shoulder (curling, not planked)
    points[16] = point(0, 0.25, 0.9);
    expect(config.isValidPosture!(points)).toBe(false);
  });

  it('rejects an upright torso even when a wrist dips below shoulder height (e.g. warming up)', () => {
    const points: Point[] = new Array(25).fill(point(0, 0, 0));
    points[11] = point(-0.1, 0.2, 0.9); // leftShoulder (shoulder width 0.2)
    points[12] = point(0.1, 0.2, 0.9); // rightShoulder
    points[15] = point(0, 0.3, 0.9); // wrists below shoulders, satisfies that check alone
    points[16] = point(0, 0.3, 0.9);
    points[23] = point(-0.1, 0.9, 0.9); // leftHip — standing, far below shoulders
    points[24] = point(0.1, 0.9, 0.9); // rightHip
    // Vertical shoulder-hip span (0.7) vs shoulder width (0.2) -> ratio 3.5,
    // well above PUSHUP_TORSO_UPRIGHT_RATIO -> looks like standing, not prone.
    expect(config.isValidPosture!(points)).toBe(false);
  });

  it('accepts a prone torso (shoulder-hip span small relative to shoulder width)', () => {
    const points: Point[] = new Array(25).fill(point(0, 0, 0));
    points[11] = point(-0.1, 0.2, 0.9); // leftShoulder (shoulder width 0.2)
    points[12] = point(0.1, 0.2, 0.9);
    points[15] = point(0, 0.3, 0.9); // wrists below shoulders
    points[16] = point(0, 0.3, 0.9);
    points[23] = point(-0.1, 0.3, 0.9); // leftHip — close to shoulder height (prone)
    points[24] = point(0.1, 0.3, 0.9);
    expect(config.isValidPosture!(points)).toBe(true);
  });
});

describe('EXERCISES.squat.isValidPosture', () => {
  const config = EXERCISES.squat;

  it('accepts when at least one full leg is confidently visible', () => {
    const points: Point[] = new Array(29).fill(point(0, 0, 0));
    points[23] = point(0, 0, 0.9); // leftHip
    points[25] = point(0, 0, 0.9); // leftKnee
    points[27] = point(0, 0, 0.9); // leftAnkle
    expect(config.isValidPosture!(points)).toBe(true);
  });

  it('rejects when neither leg is fully visible', () => {
    const points: Point[] = new Array(29).fill(point(0, 0, 0));
    points[23] = point(0, 0, 0.9); // hip visible
    // knee/ankle missing on both sides
    expect(config.isValidPosture!(points)).toBe(false);
  });
});

describe('EXERCISES.jumpingJack.isValidPosture', () => {
  const config = EXERCISES.jumpingJack;

  it('accepts a standing, camera-facing posture (shoulders above hips)', () => {
    const points: Point[] = new Array(25).fill(point(0, 0, 0));
    points[11] = point(0, 0.3, 0.9); // leftShoulder
    points[12] = point(0, 0.3, 0.9); // rightShoulder
    points[23] = point(0, 0.6, 0.9); // leftHip
    points[24] = point(0, 0.6, 0.9); // rightHip
    expect(config.isValidPosture!(points)).toBe(true);
  });

  it('rejects when shoulders are not above hips (e.g. bent over or lying down)', () => {
    const points: Point[] = new Array(25).fill(point(0, 0, 0));
    points[11] = point(0, 0.6, 0.9); // leftShoulder
    points[12] = point(0, 0.6, 0.9); // rightShoulder
    points[23] = point(0, 0.3, 0.9); // leftHip (above shoulders)
    points[24] = point(0, 0.3, 0.9); // rightHip
    expect(config.isValidPosture!(points)).toBe(false);
  });
});

/** Feeds the same normalized-Y value for several frames so the One-Euro filter settles near it. */
function holdY(counter: VerticalRepCounter, y: number, startT: number, frames = 8) {
  let t = startT;
  let last = null as ReturnType<VerticalRepCounter['update']>;
  for (let i = 0; i < frames; i++) {
    last = counter.update(y, t);
    t += FRAME_DT_MS;
  }
  return { last, t };
}

describe('VerticalRepCounter', () => {
  it('returns null until enough vertical range has been observed', () => {
    const counter = new VerticalRepCounter();
    const { last } = holdY(counter, 0.5, 0);
    expect(last).toBeNull();
  });

  it('counts one rep on a full up -> down -> up cycle', () => {
    const counter = new VerticalRepCounter();
    let t = 0;

    ({ t } = holdY(counter, 0.2, t)); // up position establishes the top of the range
    ({ t } = holdY(counter, 0.8, t)); // down position establishes the bottom
    expect(counter.count).toBe(1);
    expect(counter.stage).toBe('down');

    holdY(counter, 0.2, t); // back up
    expect(counter.stage).toBe('up');
    expect(counter.count).toBe(1); // still just the one rep
  });

  it('does not count a shallow dip that never reaches the down zone', () => {
    const counter = new VerticalRepCounter();
    let t = 0;
    ({ t } = holdY(counter, 0.2, t));
    ({ t } = holdY(counter, 0.8, t)); // full rep to establish calibration range
    expect(counter.count).toBe(1);
    ({ t } = holdY(counter, 0.2, t)); // back to up

    ({ t } = holdY(counter, 0.5, t)); // shallow dip, well short of the down zone
    holdY(counter, 0.2, t);
    expect(counter.count).toBe(1); // unchanged
  });

  it('reset() clears count, stage, and calibration', () => {
    const counter = new VerticalRepCounter();
    let t = 0;
    ({ t } = holdY(counter, 0.2, t));
    holdY(counter, 0.8, t);
    expect(counter.count).toBe(1);

    counter.reset();
    expect(counter.count).toBe(0);
    expect(counter.stage).toBe('up');
    expect(holdY(counter, 0.5, 0).last).toBeNull(); // calibration range forgotten
  });

  it('recalibrate() forgets calibration and stage but keeps the count', () => {
    const counter = new VerticalRepCounter();
    let t = 0;
    ({ t } = holdY(counter, 0.2, t));
    ({ t } = holdY(counter, 0.8, t));
    expect(counter.count).toBe(1);
    expect(counter.stage).toBe('down');

    counter.recalibrate();
    expect(counter.count).toBe(1); // unlike reset(), the tally survives
    expect(counter.stage).toBe('up');
    expect(holdY(counter, 0.5, t).last).toBeNull(); // calibration range forgotten

    // A stale wide range (e.g. from standing warm-up) shouldn't linger: a
    // real full rep on the new, correctly-scaled range must still count.
    ({ t } = holdY(counter, 0.2, t));
    holdY(counter, 0.8, t);
    expect(counter.count).toBe(2);
  });

  it('seedReference() anchors the range at a deliberately-captured value instead of an organic one', () => {
    const counter = new VerticalRepCounter();
    let t = 0;
    // Establish a count first, to confirm seedReference() preserves it.
    ({ t } = holdY(counter, 0.2, t));
    ({ t } = holdY(counter, 0.8, t));
    expect(counter.count).toBe(1);

    // Seed at a deliberately-captured "top" reference (e.g. from a
    // multi-second hold before tracking starts) — must NOT immediately
    // register as calibrated off just this single point.
    counter.seedReference(0.3);
    expect(counter.count).toBe(1); // preserved, unlike reset()
    expect(counter.stage).toBe('up');
    // Holding right at the seeded value shouldn't complete calibration —
    // range is 0 until real motion happens.
    expect(holdY(counter, 0.3, t).last).toBeNull();

    // A real rep starting from the seeded reference counts normally.
    ({ t } = holdY(counter, 0.3, t));
    holdY(counter, 0.9, t);
    expect(counter.count).toBe(2);
  });

  it('seedReference() counts correctly even when real motion moves the raw signal downward, not up', () => {
    // The direction a seeded signal moves during a real rep isn't knowable
    // in advance (depends on camera angle / body proportions) — this is the
    // "arm bend showed green instead of red" bug: with a naive min/max
    // seed, motion in the "wrong" direction from the reference inverted
    // which end read as red vs. green. Deviation-from-reference must get
    // this right regardless of which way the raw value actually moves.
    const counter = new VerticalRepCounter();
    counter.seedReference(0.5);
    let t = 0;
    // Real rep motion decreases y below the reference instead of increasing it.
    // Extra frames (>MIN_CALIBRATION_SAMPLES=10) so calibration finishes and
    // the filter fully settles within each phase.
    ({ t } = holdY(counter, 0.1, t, 16));
    const atReference = holdY(counter, 0.5, t, 16);
    expect(atReference.last?.progress).toBeCloseTo(0, 1); // back at reference reads as "rest", not "full depth"
    t = atReference.t;

    ({ t } = holdY(counter, 0.1, t, 16));
    holdY(counter, 0.5, t, 16);
    expect(counter.count).toBe(2); // both down/up cycles counted normally
  });

  it('counts the rep if the auxiliary condition was true at any point during the up phase, even if false right at the crossing', () => {
    const counter = new VerticalRepCounter();
    let t = 0;
    ({ t } = holdY(counter, 0.2, t)); // establish calibration with a normal rep
    ({ t } = holdY(counter, 0.8, t));
    expect(counter.count).toBe(1);

    // Back up: aux condition (e.g. "legs spread") is true mid-air but has
    // already gone false again by the time the wrists cross back down —
    // real reps rarely line up the two signals on the exact same frame.
    for (let i = 0; i < 4; i++) {
      counter.update(0.2, t, true);
      t += FRAME_DT_MS;
    }
    for (let i = 0; i < 4; i++) {
      counter.update(0.2, t, false);
      t += FRAME_DT_MS;
    }
    for (let i = 0; i < 8; i++) {
      counter.update(0.8, t, false); // aux false on every frame of the down-crossing itself
      t += FRAME_DT_MS;
    }
    expect(counter.count).toBe(2);
  });

  it('does not count the rep if the auxiliary condition was never true during the up phase', () => {
    const counter = new VerticalRepCounter();
    let t = 0;
    ({ t } = holdY(counter, 0.2, t)); // establish calibration with a normal rep
    ({ t } = holdY(counter, 0.8, t));
    expect(counter.count).toBe(1);

    for (let i = 0; i < 8; i++) {
      counter.update(0.2, t, false); // e.g. arms went up but legs never spread
      t += FRAME_DT_MS;
    }
    for (let i = 0; i < 8; i++) {
      counter.update(0.8, t, false);
      t += FRAME_DT_MS;
    }
    expect(counter.count).toBe(1); // unchanged — second rep rejected
  });

  it('does not open calibration on a small in-place shift (camera shake / posture wobble)', () => {
    const counter = new VerticalRepCounter();
    // A 5% wobble is below MIN_CALIBRATION_RANGE (8%), so it must stay null
    // rather than start treating that tiny range as a real rep's travel.
    const { last } = holdY(counter, 0.5, 0, 4);
    const second = holdY(counter, 0.55, 132, 4);
    expect(last).toBeNull();
    expect(second.last).toBeNull();
  });

  it('honors a custom minCalibrationRange for small-amplitude signals', () => {
    // Default threshold (8%) would never open on a signal this small...
    const defaultCounter = new VerticalRepCounter();
    let t = 0;
    ({ t } = holdY(defaultCounter, 0.10, t));
    expect(holdY(defaultCounter, 0.13, t).last).toBeNull(); // 3% range, under the 8% default

    // ...but a counter configured with a smaller floor should calibrate and count normally.
    const smallRangeCounter = new VerticalRepCounter(1.2, 0.4, 1.0, 0.02);
    t = 0;
    ({ t } = holdY(smallRangeCounter, 0.1, t));
    holdY(smallRangeCounter, 0.13, t);
    expect(smallRangeCounter.count).toBe(1);
  });

  it('does not double-count a rapid bounce that completes a second cycle inside the debounce window', () => {
    // A high cutoff makes the filter track the raw signal almost immediately,
    // so a full up/down/up cycle can be driven frame-by-frame instead of
    // needing many frames to settle — lets the test control exact timing.
    const counter = new VerticalRepCounter(100, 0, 100);
    let t = 0;
    // Pad past the minimum-sample calibration floor (10) before the timed
    // sequence below, so that part only has to cross MIN_CALIBRATION_RANGE,
    // not also wait out the sample-count floor.
    for (let i = 0; i < 10; i++) {
      counter.update(0.2, t); // establishes the top of the range
      t += FRAME_DT_MS;
    }
    const firstDown = counter.update(0.9, t); // crosses into the down zone
    t += FRAME_DT_MS;
    expect(firstDown?.justCounted).toBe(true);
    expect(counter.count).toBe(1);

    counter.update(0.2, t); // back to the up zone
    t += FRAME_DT_MS;
    // Second down-crossing lands well under 400ms after the first count.
    const secondDown = counter.update(0.9, t);
    expect(secondDown?.stage).toBe('down'); // hysteresis still flips the stage...
    expect(secondDown?.justCounted).toBe(false); // ...but the debounce blocks the count
    expect(counter.count).toBe(1);
  });
});

type LegTriple = { hip: Point; knee: Point; ankle: Point };

/** Builds hip/knee/ankle points whose knee angle equals `angleDeg`, with the knee fixed at the origin. */
function legAtAngle(angleDeg: number, score = 1): LegTriple {
  const rad = (angleDeg * Math.PI) / 180;
  return {
    knee: point(0, 0, score),
    hip: point(1, 0, score),
    ankle: point(Math.cos(rad), Math.sin(rad), score),
  };
}

function holdAngle(
  counter: SideAngleRepCounter,
  angleDeg: number,
  startT: number,
  frames = 8,
  score = 1
) {
  let t = startT;
  const leg = legAtAngle(angleDeg, score);
  let last = null as ReturnType<SideAngleRepCounter['update']>;
  for (let i = 0; i < frames; i++) {
    last = counter.update(leg, leg, t);
    t += FRAME_DT_MS;
  }
  return { last, t };
}

function holdLeg(counter: SideAngleRepCounter, leg: LegTriple, startT: number, frames = 8) {
  let t = startT;
  let last = null as ReturnType<SideAngleRepCounter['update']>;
  for (let i = 0; i < frames; i++) {
    last = counter.update(leg, leg, t);
    t += FRAME_DT_MS;
  }
  return { last, t };
}

describe('SideAngleRepCounter', () => {
  it('returns null when neither leg is confidently visible', () => {
    const counter = new SideAngleRepCounter();
    const { last } = holdAngle(counter, 170, 0, 4, 0.2);
    expect(last).toBeNull();
  });

  it('counts one rep on a full stand -> deep squat -> stand cycle', () => {
    const counter = new SideAngleRepCounter();
    let t = 0;
    ({ t } = holdAngle(counter, 170, t)); // standing, straight leg
    ({ t } = holdAngle(counter, 70, t)); // deep squat, well past the depth threshold
    ({ t } = holdAngle(counter, 170, t)); // back to standing
    expect(counter.count).toBe(1);
    expect(counter.stage).toBe('up');
  });

  it('does not report gauge progress in the green zone (>=0.8) until the depth-ratio check actually passes', () => {
    const counter = new SideAngleRepCounter();
    let t = 0;
    ({ t } = holdAngle(counter, 170, t)); // standing
    // Knee angle alone reads deep-ish (past the fixed 100° requirement)
    // but the hip hasn't dropped, so hasDepth is false via the ratio gate.
    const fakeDeepLeg: LegTriple = {
      knee: point(0, 0),
      hip: point(0, -3),
      ankle: point(3, 0.01),
    };
    const { last } = holdLeg(counter, fakeDeepLeg, t, 8);
    expect(last?.progress).toBeLessThan(0.8);
  });

  it('still reports full gauge progress at real depth even when the calibrated max angle never straightens much past 100°', () => {
    // Regression test: upThreshold (maxAngleSeen - 0.15*range) used to be
    // unclamped, so someone whose "standing" never reads much above the
    // fixed 100° depth angle could drive it to/below 100 — making
    // progress's (upThreshold - 100) denominator zero or negative and
    // sticking the gauge at 0 for the whole rep despite real depth.
    const counter = new SideAngleRepCounter();
    let t = 0;
    ({ t } = holdAngle(counter, 104, t, 15)); // "standing" barely above the depth angle
    ({ t } = holdAngle(counter, 70, t, 15)); // deep squat
    const last = holdAngle(counter, 85, t, 1).last; // still descending, real depth
    expect(last?.progress).toBeGreaterThan(0.5);
  });

  it('counts the instant full depth is reached, not after standing back up', () => {
    const counter = new SideAngleRepCounter();
    let t = 0;
    ({ t } = holdAngle(counter, 170, t)); // standing, straight leg
    // Reach and hold at depth: the count should land during this call,
    // before any frame reports the person back near standing.
    const { t: t2 } = holdAngle(counter, 70, t);
    expect(counter.count).toBe(1);
    t = t2;
    holdAngle(counter, 170, t); // stand back up — should not double-count
    expect(counter.count).toBe(1);
  });

  it('counts a rep that reaches full depth even if it never stands back up', () => {
    const counter = new SideAngleRepCounter();
    let t = 0;
    ({ t } = holdAngle(counter, 170, t));
    holdAngle(counter, 70, t); // reaches full depth and stays there
    expect(counter.count).toBe(1);
  });

  it('counts a genuine full squat where the hip drops to knee height', () => {
    const counter = new SideAngleRepCounter();
    let t = 0;
    // Standing tall: hip well above the knee, shin roughly vertical.
    const standing: LegTriple = { knee: point(0, 0), hip: point(0.05, -3), ankle: point(0, 3) };
    // Full depth: hip has dropped to knee height (thighs parallel), while
    // the knee angle also reads a real bend — both signals agree here.
    const squatting: LegTriple = { knee: point(0, 0), hip: point(3, 0), ankle: point(0, 3) };
    ({ t } = holdLeg(counter, standing, t));
    ({ t } = holdLeg(counter, squatting, t));
    holdLeg(counter, standing, t);
    expect(counter.count).toBe(1);
  });

  it('does not count a bent knee-angle reading if the hip never actually drops (depth ratio guard)', () => {
    const counter = new SideAngleRepCounter();
    let t = 0;
    const standing = legAtAngle(170);
    // Constructed so the knee angle alone reads ~90° (would pass the old
    // angle-only depth check) but the hip is still well above the knee —
    // e.g. a sideways leg motion, not an actual squat.
    const fakeDeepLeg: LegTriple = {
      knee: point(0, 0),
      hip: point(0, -3), // hip well above the knee
      ankle: point(3, 0.01), // angled so hip-knee-ankle still reads ~90°
    };
    ({ t } = holdLeg(counter, standing, t));
    ({ t } = holdLeg(counter, fakeDeepLeg, t));
    holdLeg(counter, standing, t);
    expect(counter.count).toBe(0);
  });

  it('does not count a half squat that never reaches full depth', () => {
    const counter = new SideAngleRepCounter();
    let t = 0;
    // Establish a real calibration range first with one full rep.
    ({ t } = holdAngle(counter, 170, t));
    ({ t } = holdAngle(counter, 70, t));
    ({ t } = holdAngle(counter, 170, t));
    expect(counter.count).toBe(1);

    // Shallow squat: crosses the "down" threshold but not the depth threshold.
    ({ t } = holdAngle(counter, 110, t));
    holdAngle(counter, 170, t);
    expect(counter.count).toBe(1); // unchanged
  });

  it('never counts repeated shallow squats, even once they are the only depth observed', () => {
    // Regression test: the depth requirement used to be derived from the
    // self-calibrated min/max range (15% short of the deepest angle ever
    // seen), so once a person had only ever done shallow squats, that
    // shallow depth itself became "full depth" and started counting.
    const counter = new SideAngleRepCounter();
    let t = 0;
    for (let i = 0; i < 5; i++) {
      ({ t } = holdAngle(counter, 170, t)); // stand
      ({ t } = holdAngle(counter, 130, t)); // shallow squat, never near parallel
    }
    expect(counter.count).toBe(0);
  });

  it('reset() clears count, stage, and calibration', () => {
    const counter = new SideAngleRepCounter();
    let t = 0;
    ({ t } = holdAngle(counter, 170, t));
    ({ t } = holdAngle(counter, 70, t));
    holdAngle(counter, 170, t);
    expect(counter.count).toBe(1);

    counter.reset();
    expect(counter.count).toBe(0);
    expect(counter.stage).toBe('up');
  });

  it('keeps tracking the selected leg through small visibility fluctuations', () => {
    const counter = new SideAngleRepCounter();
    // Two legs at very different angles so that which one gets tracked is
    // unambiguous from the resulting angle reading.
    const withScore = (leg: LegTriple, score: number): LegTriple => ({
      ...leg,
      hip: point(leg.hip.x, leg.hip.y, score),
    });
    const leftLeg = legAtAngle(170); // standing-straight leg
    const rightLeg = legAtAngle(90); // bent leg

    // Left is clearly better at first, so it's selected.
    counter.update(withScore(leftLeg, 1), withScore(rightLeg, 0.5), 0);
    // Right nudges slightly ahead next frame, but not past the switch
    // margin — the tracked leg should stay "left".
    const second = counter.update(
      withScore(leftLeg, 0.85),
      withScore(rightLeg, 0.9),
      FRAME_DT_MS
    );
    expect(second).not.toBeNull();
    expect(second!.angle).toBeCloseTo(170, 0); // still reading the left (straight) leg
  });

  it('does not double-count a rapid bounce that completes a second cycle inside the debounce window', () => {
    const counter = new SideAngleRepCounter(100, 0, 100);
    const standing = legAtAngle(170);
    const deepSquat = legAtAngle(70);

    counter.update(standing, standing, 0);
    const firstDown = counter.update(deepSquat, deepSquat, FRAME_DT_MS);
    expect(firstDown?.stage).toBe('down');
    expect(firstDown?.justCounted).toBe(true); // counts as soon as depth is reached
    expect(counter.count).toBe(1);
    const firstUp = counter.update(standing, standing, 2 * FRAME_DT_MS);
    expect(firstUp?.justCounted).toBe(false); // already counted on the way down
    expect(counter.count).toBe(1);

    // Bounce straight back down and up again well inside the 400ms window.
    counter.update(deepSquat, deepSquat, 3 * FRAME_DT_MS);
    const secondUp = counter.update(standing, standing, 4 * FRAME_DT_MS);
    expect(secondUp?.justCounted).toBe(false);
    expect(counter.count).toBe(1);
  });
});

type AngleTriple = { proximal: Point; vertex: Point; distal: Point };

/** Builds proximal/vertex/distal points whose angle at the vertex equals `angleDeg`, vertex fixed at the origin. */
function jointAtAngle(angleDeg: number, score = 1): AngleTriple {
  const rad = (angleDeg * Math.PI) / 180;
  return {
    vertex: point(0, 0, score),
    proximal: point(1, 0, score),
    distal: point(Math.cos(rad), Math.sin(rad), score),
  };
}

function holdJointAngle(
  counter: AngleRepCounter,
  angleDeg: number,
  config: AngleExerciseConfig,
  startT: number,
  frames = 8,
  score = 1
) {
  let t = startT;
  const joint = jointAtAngle(angleDeg, score);
  let last = null as ReturnType<AngleRepCounter['update']>;
  for (let i = 0; i < frames; i++) {
    last = counter.update(joint, joint, t, config);
    t += FRAME_DT_MS;
  }
  return { last, t };
}

describe('AngleRepCounter', () => {
  const config: AngleExerciseConfig = {
    id: 'pushup',
    label: 'test',
    downLabel: 'down',
    upLabel: 'up',
    signal: 'angle',
    left: [0, 1, 2],
    right: [3, 4, 5],
    downThreshold: 100,
    upThreshold: 160,
  };

  it('returns null when neither side is confidently visible', () => {
    const counter = new AngleRepCounter();
    const { last } = holdJointAngle(counter, 170, config, 0, 4, 0.2);
    expect(last).toBeNull();
  });

  it('counts reps from just one visible limb, with the other completely absent', () => {
    // The "other side" is effectively not detected (score ~0) — e.g. a
    // one-arm curl where only one arm is ever in frame.
    const counter = new AngleRepCounter();
    const absent = jointAtAngle(170, 0);
    let t = 0;
    for (let i = 0; i < 8; i++) {
      counter.update(jointAtAngle(170), absent, t, config); // straight/up
      t += FRAME_DT_MS;
    }
    for (let i = 0; i < 8; i++) {
      counter.update(jointAtAngle(80), absent, t, config); // bent past downThreshold
      t += FRAME_DT_MS;
    }
    expect(counter.count).toBe(1);
    expect(counter.stage).toBe('down');
  });

  it('does not let a stationary second limb dilute a moving one (no averaging)', () => {
    // Right arm stays straight (resting) the whole time while left curls —
    // if the two were averaged instead of picking one side, the resting
    // arm's ~170 would keep pulling the signal above downThreshold.
    const counter = new AngleRepCounter();
    const restingRight = jointAtAngle(170);
    let t = 0;
    for (let i = 0; i < 8; i++) {
      counter.update(jointAtAngle(170), restingRight, t, config);
      t += FRAME_DT_MS;
    }
    for (let i = 0; i < 8; i++) {
      counter.update(jointAtAngle(80), restingRight, t, config); // left curls down
      t += FRAME_DT_MS;
    }
    expect(counter.count).toBe(1);
  });

  it('counts one rep on a full up -> down -> up cycle', () => {
    const counter = new AngleRepCounter();
    let t = 0;
    ({ t } = holdJointAngle(counter, 170, config, t)); // straight/up
    ({ t } = holdJointAngle(counter, 80, config, t)); // bent past downThreshold
    expect(counter.count).toBe(1);
    expect(counter.stage).toBe('down');

    holdJointAngle(counter, 170, config, t); // back up
    expect(counter.count).toBe(1);
  });

  it('does not count a shallow dip that never crosses downThreshold', () => {
    const counter = new AngleRepCounter();
    holdJointAngle(counter, 130, config, 0); // between thresholds the whole time
    expect(counter.count).toBe(0);
    expect(counter.stage).toBe('up');
  });

  it('keeps tracking the selected side through small visibility fluctuations', () => {
    const counter = new AngleRepCounter();
    const straightLeft = jointAtAngle(170);
    const bentRight = jointAtAngle(90);

    // Left is clearly better at first, so it's selected.
    counter.update(
      { ...straightLeft, vertex: point(0, 0, 1) },
      { ...bentRight, vertex: point(0, 0, 0.5) },
      0,
      config
    );
    // Right nudges slightly ahead next frame, but not past the switch
    // margin — the tracked side should stay "left".
    const second = counter.update(
      { ...straightLeft, vertex: point(0, 0, 0.85) },
      { ...bentRight, vertex: point(0, 0, 0.9) },
      FRAME_DT_MS,
      config
    );
    expect(second).not.toBeNull();
    expect(second!.angle).toBeCloseTo(170, 0); // still reading the straight (left) side
  });

  it('does not double-count a rapid bounce inside the debounce window', () => {
    const counter = new AngleRepCounter(100, 0, 100); // near-raw filter for precise timing
    const up = jointAtAngle(170);
    const down = jointAtAngle(80);

    counter.update(up, up, 0, config);
    // Counting happens on the down-crossing (up -> down), same as VerticalRepCounter.
    const firstDown = counter.update(down, down, FRAME_DT_MS, config);
    expect(firstDown?.stage).toBe('down');
    expect(firstDown?.justCounted).toBe(true);
    expect(counter.count).toBe(1);

    counter.update(up, up, 2 * FRAME_DT_MS, config); // back up, re-arms the down-crossing
    // Second down-crossing lands well under 400ms after the first count.
    const secondDown = counter.update(down, down, 3 * FRAME_DT_MS, config);
    expect(secondDown?.stage).toBe('down');
    expect(secondDown?.justCounted).toBe(false); // debounce blocks the count
    expect(counter.count).toBe(1);
  });

  it('reset() clears count, stage, side selection, and filter state', () => {
    const counter = new AngleRepCounter();
    let t = 0;
    ({ t } = holdJointAngle(counter, 170, config, t));
    holdJointAngle(counter, 80, config, t);
    expect(counter.count).toBe(1);

    counter.reset();
    expect(counter.count).toBe(0);
    expect(counter.stage).toBe('up');
  });
});
