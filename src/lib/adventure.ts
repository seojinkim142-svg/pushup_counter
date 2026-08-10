import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ExerciseId } from './pose';

export type StageConfig = {
  id: string;
  chapter: number;
  stageNumber: number;
  label: string;
  exercise: ExerciseId;
  targetCount: number;
  timeLimitSec: number;
};

// Chapter 1: a short introductory ramp across all three real exercises
// (armCurlTest is a tuning aid, not a real workout, so it's excluded here).
// Difficulty climbs gradually — later stages get both a higher target count
// and less time per rep — ending on a pushup "boss" stage.
export const ADVENTURE_STAGES: StageConfig[] = [
  { id: '1-1', chapter: 1, stageNumber: 1, label: '1-1', exercise: 'squat', targetCount: 8, timeLimitSec: 30 },
  { id: '1-2', chapter: 1, stageNumber: 2, label: '1-2', exercise: 'pushup', targetCount: 8, timeLimitSec: 30 },
  {
    id: '1-3',
    chapter: 1,
    stageNumber: 3,
    label: '1-3',
    exercise: 'jumpingJack',
    targetCount: 15,
    timeLimitSec: 25,
  },
  { id: '1-4', chapter: 1, stageNumber: 4, label: '1-4', exercise: 'squat', targetCount: 15, timeLimitSec: 40 },
  { id: '1-5', chapter: 1, stageNumber: 5, label: '1-5', exercise: 'pushup', targetCount: 15, timeLimitSec: 40 },
];

export type MonsterClip = { frames: number[]; fps: number };

// Per-stage monster animation frames, exported from Piskel and cropped to
// individual PNGs (see scratchpad/extract_piskel.py — one-off, run by hand
// when new art comes in). RN's bundler needs static require() calls, so this
// can't be built from a file list at runtime; add an entry here each time a
// stage gets art. `attacked` is optional — plays once (in place of `idle`)
// each time a rep counts against that stage, then falls back to idle; a
// stage with no `attacked` clip just never leaves its idle animation.
export const STAGE_MONSTER_ART: Partial<Record<string, { idle: MonsterClip; attacked?: MonsterClip }>> = {
  '1-1': {
    idle: {
      frames: [
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../../assets/images/adventure/stage-1-1/frame_0.png'),
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../../assets/images/adventure/stage-1-1/frame_1.png'),
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../../assets/images/adventure/stage-1-1/frame_2.png'),
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../../assets/images/adventure/stage-1-1/frame_3.png'),
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../../assets/images/adventure/stage-1-1/frame_4.png'),
      ],
      fps: 12,
    },
    attacked: {
      frames: [
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../../assets/images/adventure/stage-1-1-attacked/frame_0.png'),
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../../assets/images/adventure/stage-1-1-attacked/frame_1.png'),
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../../assets/images/adventure/stage-1-1-attacked/frame_2.png'),
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../../assets/images/adventure/stage-1-1-attacked/frame_3.png'),
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../../assets/images/adventure/stage-1-1-attacked/frame_4.png'),
      ],
      fps: 12,
    },
  },
};

/** True if this stage is playable — the first stage, or the previous one has been cleared. */
export function isStageUnlocked(stage: StageConfig, cleared: ReadonlySet<string>): boolean {
  const index = ADVENTURE_STAGES.findIndex((s) => s.id === stage.id);
  if (index <= 0) return true;
  return cleared.has(ADVENTURE_STAGES[index - 1].id);
}

/** The next stage after this one, or null if it's the last one. */
export function nextStage(stage: StageConfig): StageConfig | null {
  const index = ADVENTURE_STAGES.findIndex((s) => s.id === stage.id);
  if (index === -1 || index + 1 >= ADVENTURE_STAGES.length) return null;
  return ADVENTURE_STAGES[index + 1];
}

const CLEARED_STAGES_KEY = '@push_up_counter/adventure_cleared_stages';

export async function loadClearedStages(): Promise<Set<string>> {
  try {
    const raw = await AsyncStorage.getItem(CLEARED_STAGES_KEY);
    if (raw == null) return new Set();
    const ids: unknown = JSON.parse(raw);
    return Array.isArray(ids) ? new Set(ids.filter((id): id is string => typeof id === 'string')) : new Set();
  } catch (e) {
    console.warn('loadClearedStages failed', e);
    return new Set();
  }
}

export async function saveClearedStage(id: string, currentlyCleared: ReadonlySet<string>): Promise<void> {
  const next = new Set(currentlyCleared);
  next.add(id);
  try {
    await AsyncStorage.setItem(CLEARED_STAGES_KEY, JSON.stringify(Array.from(next)));
  } catch (e) {
    console.warn('saveClearedStage failed', e);
  }
}
