import { ADVENTURE_STAGES, isStageUnlocked, nextStage } from '../adventure';

describe('ADVENTURE_STAGES', () => {
  it('has unique, sequential ids within chapter 1', () => {
    const ids = ADVENTURE_STAGES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(['1-1', '1-2', '1-3', '1-4', '1-5']);
  });
});

describe('isStageUnlocked', () => {
  it('the first stage is always unlocked', () => {
    expect(isStageUnlocked(ADVENTURE_STAGES[0], new Set())).toBe(true);
  });

  it('a later stage is locked until the previous one is cleared', () => {
    expect(isStageUnlocked(ADVENTURE_STAGES[1], new Set())).toBe(false);
    expect(isStageUnlocked(ADVENTURE_STAGES[1], new Set(['1-1']))).toBe(true);
  });

  it('clearing an earlier stage does not unlock stages beyond the very next one', () => {
    expect(isStageUnlocked(ADVENTURE_STAGES[2], new Set(['1-1']))).toBe(false);
  });
});

describe('nextStage', () => {
  it('returns the following stage', () => {
    expect(nextStage(ADVENTURE_STAGES[0])?.id).toBe('1-2');
  });

  it('returns null after the last stage', () => {
    expect(nextStage(ADVENTURE_STAGES[ADVENTURE_STAGES.length - 1])).toBeNull();
  });
});
