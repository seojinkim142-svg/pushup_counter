import { ADVENTURE_STAGES, isStageUnlocked, nextStage } from '../adventure';

describe('ADVENTURE_STAGES', () => {
  it('has unique ids, with each exercise labeled 1-1..1-5 then 2-1..2-5', () => {
    const ids = ADVENTURE_STAGES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);

    const labelsByExercise = new Map<string, string[]>();
    for (const s of ADVENTURE_STAGES) {
      labelsByExercise.set(s.exercise, [...(labelsByExercise.get(s.exercise) ?? []), s.label]);
    }
    expect(labelsByExercise.size).toBe(3);
    for (const labels of labelsByExercise.values()) {
      expect(labels).toEqual(['1-1', '1-2', '1-3', '1-4', '1-5', '2-1', '2-2', '2-3', '2-4', '2-5']);
    }
  });
});

describe('isStageUnlocked', () => {
  const pushupStages = ADVENTURE_STAGES.filter((s) => s.exercise === 'pushup');

  it('the first stage of an exercise chain is always unlocked', () => {
    expect(isStageUnlocked(pushupStages[0], new Set())).toBe(true);
  });

  it('a later stage is locked until the previous one in the same chain is cleared', () => {
    expect(isStageUnlocked(pushupStages[1], new Set())).toBe(false);
    expect(isStageUnlocked(pushupStages[1], new Set([pushupStages[0].id]))).toBe(true);
  });

  it('clearing an earlier stage does not unlock stages beyond the very next one', () => {
    expect(isStageUnlocked(pushupStages[2], new Set([pushupStages[0].id]))).toBe(false);
  });

  it('clearing stages in a different exercise chain does not unlock this one', () => {
    const squatFirst = ADVENTURE_STAGES.find((s) => s.exercise === 'squat');
    expect(squatFirst).toBeDefined();
    expect(isStageUnlocked(pushupStages[1], new Set([squatFirst!.id]))).toBe(false);
  });

  it('every chapter\'s first stage (N-1) is unlocked from the start, regardless of earlier chapters', () => {
    const chapter2First = pushupStages.find((s) => s.chapter === 2 && s.stageNumber === 1);
    expect(chapter2First).toBeDefined();
    expect(isStageUnlocked(chapter2First!, new Set())).toBe(true);
  });

  it('chapter 2 stage 2 still requires chapter 2 stage 1 (same chapter) to be cleared', () => {
    const chapter2First = pushupStages.find((s) => s.chapter === 2 && s.stageNumber === 1);
    const chapter2Second = pushupStages.find((s) => s.chapter === 2 && s.stageNumber === 2);
    expect(chapter2First).toBeDefined();
    expect(chapter2Second).toBeDefined();
    expect(isStageUnlocked(chapter2Second!, new Set())).toBe(false);
    expect(isStageUnlocked(chapter2Second!, new Set([chapter2First!.id]))).toBe(true);
  });

  it('clearing chapter 1 stages does not unlock chapter 2 stage 2 by itself', () => {
    const chapter1Last = pushupStages.find((s) => s.chapter === 1 && s.stageNumber === 5);
    const chapter2Second = pushupStages.find((s) => s.chapter === 2 && s.stageNumber === 2);
    expect(chapter1Last).toBeDefined();
    expect(chapter2Second).toBeDefined();
    expect(isStageUnlocked(chapter2Second!, new Set([chapter1Last!.id]))).toBe(false);
  });
});

describe('nextStage', () => {
  const pushupStages = ADVENTURE_STAGES.filter((s) => s.exercise === 'pushup');

  it('returns the following stage in the same exercise chain', () => {
    expect(nextStage(pushupStages[0])?.id).toBe(pushupStages[1].id);
  });

  it('returns null after the last stage in the chain', () => {
    expect(nextStage(pushupStages[pushupStages.length - 1])).toBeNull();
  });
});
