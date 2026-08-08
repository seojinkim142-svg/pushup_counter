import {
  AngleRepCounter,
  EXERCISES,
  MIN_KEYPOINT_SCORE,
  SideAngleRepCounter,
  VerticalRepCounter,
  angleDegrees,
  angleToProgress,
  averageVisibleY,
  isPersonPresent,
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
    const wristBelow = [
      point(0, shoulderY, 0.9), // leftShoulder (11)
      point(0, shoulderY, 0.9), // rightShoulder (12)
    ];
    const points: Point[] = new Array(17).fill(point(0, 0, 0));
    points[11] = point(0, shoulderY, 0.9);
    points[12] = point(0, shoulderY, 0.9);
    points[15] = point(0, shoulderY + 0.2, 0.9); // leftWrist well below
    points[16] = point(0, shoulderY + 0.2, 0.9); // rightWrist well below
    expect(config.isValidPosture!(points)).toBe(true);
    void wristBelow;
  });

  it('rejects a standing posture where wrists are near/above shoulder height', () => {
    const points: Point[] = new Array(17).fill(point(0, 0, 0));
    points[11] = point(0, 0.3, 0.9);
    points[12] = point(0, 0.3, 0.9);
    points[15] = point(0, 0.25, 0.9); // wrist above shoulder (curling, not planked)
    points[16] = point(0, 0.25, 0.9);
    expect(config.isValidPosture!(points)).toBe(false);
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

  it('does not open calibration on a small in-place shift (camera shake / posture wobble)', () => {
    const counter = new VerticalRepCounter();
    // A 5% wobble is below MIN_CALIBRATION_RANGE (8%), so it must stay null
    // rather than start treating that tiny range as a real rep's travel.
    const { last } = holdY(counter, 0.5, 0, 4);
    const second = holdY(counter, 0.55, 132, 4);
    expect(last).toBeNull();
    expect(second.last).toBeNull();
  });

  it('does not double-count a rapid bounce that completes a second cycle inside the debounce window', () => {
    // A high cutoff makes the filter track the raw signal almost immediately,
    // so a full up/down/up cycle can be driven frame-by-frame instead of
    // needing many frames to settle — lets the test control exact timing.
    const counter = new VerticalRepCounter(100, 0, 100);
    counter.update(0.2, 0); // establishes the top of the range
    const firstDown = counter.update(0.9, FRAME_DT_MS); // crosses into the down zone
    expect(firstDown?.justCounted).toBe(true);
    expect(counter.count).toBe(1);

    counter.update(0.2, 2 * FRAME_DT_MS); // back to the up zone
    // Second down-crossing lands well under 400ms after the first count.
    const secondDown = counter.update(0.9, 3 * FRAME_DT_MS);
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
    const firstUp = counter.update(standing, standing, 2 * FRAME_DT_MS);
    expect(firstUp?.justCounted).toBe(true);
    expect(counter.count).toBe(1);

    // Bounce straight back down and up again well inside the 400ms window.
    counter.update(deepSquat, deepSquat, 3 * FRAME_DT_MS);
    const secondUp = counter.update(standing, standing, 4 * FRAME_DT_MS);
    expect(secondUp?.justCounted).toBe(false);
    expect(counter.count).toBe(1);
  });
});

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

  it('counts one rep on a full up -> down -> up cycle', () => {
    const counter = new AngleRepCounter();
    let t = 0;
    for (let i = 0; i < 8; i++) {
      counter.update(170, t, config); // straight/up
      t += FRAME_DT_MS;
    }
    for (let i = 0; i < 8; i++) {
      counter.update(80, t, config); // bent past downThreshold
      t += FRAME_DT_MS;
    }
    expect(counter.count).toBe(1);
    expect(counter.stage).toBe('down');

    for (let i = 0; i < 8; i++) {
      counter.update(170, t, config); // back up
      t += FRAME_DT_MS;
    }
    expect(counter.stage).toBe('up');
    expect(counter.count).toBe(1);
  });

  it('does not count a shallow dip that never crosses downThreshold', () => {
    const counter = new AngleRepCounter();
    let t = 0;
    for (let i = 0; i < 8; i++) {
      counter.update(130, t, config); // between thresholds the whole time
      t += FRAME_DT_MS;
    }
    expect(counter.count).toBe(0);
    expect(counter.stage).toBe('up');
  });

  it('does not double-count a rapid bounce inside the debounce window', () => {
    const counter = new AngleRepCounter(100, 0, 100); // near-raw filter for precise timing
    counter.update(170, 0, config);
    // Counting happens on the down-crossing (up -> down), same as VerticalRepCounter.
    const firstDown = counter.update(80, FRAME_DT_MS, config);
    expect(firstDown.stage).toBe('down');
    expect(firstDown.justCounted).toBe(true);
    expect(counter.count).toBe(1);

    counter.update(170, 2 * FRAME_DT_MS, config); // back up, re-arms the down-crossing
    // Second down-crossing lands well under 400ms after the first count.
    const secondDown = counter.update(80, 3 * FRAME_DT_MS, config);
    expect(secondDown.stage).toBe('down');
    expect(secondDown.justCounted).toBe(false); // debounce blocks the count
    expect(counter.count).toBe(1);
  });

  it('reset() clears count, stage, and filter state', () => {
    const counter = new AngleRepCounter();
    let t = 0;
    for (let i = 0; i < 8; i++) {
      counter.update(170, t, config);
      t += FRAME_DT_MS;
    }
    for (let i = 0; i < 8; i++) {
      counter.update(80, t, config);
      t += FRAME_DT_MS;
    }
    expect(counter.count).toBe(1);

    counter.reset();
    expect(counter.count).toBe(0);
    expect(counter.stage).toBe('up');
  });
});
