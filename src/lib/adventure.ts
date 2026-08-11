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

type ChapterExercise = 'pushup' | 'squat' | 'jumpingJack';

// Chapter 1: each of the three real exercises (armCurlTest is a tuning aid,
// not a real workout, so it's excluded here) gets its own independent
// 1-1..1-5 progression, chosen up front via CameraScreen's adventure
// exercise-select screen — clearing pushup's stages doesn't unlock squat's,
// and vice versa. Difficulty climbs within each exercise's own chain —
// later stages get both a higher target count and less time per rep.
const CHAPTER_1_PROGRESSION: Record<ChapterExercise, Array<{ targetCount: number; timeLimitSec: number }>> = {
  pushup: [
    { targetCount: 8, timeLimitSec: 30 },
    { targetCount: 10, timeLimitSec: 30 },
    { targetCount: 12, timeLimitSec: 32 },
    { targetCount: 15, timeLimitSec: 34 },
    { targetCount: 18, timeLimitSec: 36 },
  ],
  squat: [
    { targetCount: 8, timeLimitSec: 30 },
    { targetCount: 12, timeLimitSec: 30 },
    { targetCount: 15, timeLimitSec: 32 },
    { targetCount: 18, timeLimitSec: 34 },
    { targetCount: 22, timeLimitSec: 36 },
  ],
  jumpingJack: [
    { targetCount: 15, timeLimitSec: 25 },
    { targetCount: 20, timeLimitSec: 26 },
    { targetCount: 25, timeLimitSec: 27 },
    { targetCount: 30, timeLimitSec: 28 },
    { targetCount: 35, timeLimitSec: 30 },
  ],
};

export const ADVENTURE_STAGES: StageConfig[] = (Object.keys(CHAPTER_1_PROGRESSION) as ChapterExercise[]).flatMap(
  (exercise) =>
    CHAPTER_1_PROGRESSION[exercise].map((cfg, i) => ({
      id: `${exercise}-1-${i + 1}`,
      chapter: 1,
      stageNumber: i + 1,
      label: `1-${i + 1}`,
      exercise,
      targetCount: cfg.targetCount,
      timeLimitSec: cfg.timeLimitSec,
    }))
);

export type MonsterClip = { frames: number[]; fps: number };

// Chapter 1 uses the same slime for every stage across all three exercise
// chains — only later chapters need distinct monster art per stage. RN's
// bundler needs static require() calls, so the frame paths can't be built
// from a variable at runtime.
/* eslint-disable @typescript-eslint/no-require-imports */
const CHAPTER_1_SLIME: { idle: MonsterClip; attacked: MonsterClip } = {
  idle: {
    frames: [
      require('../../assets/images/adventure/stage-1-1/frame_0.png'),
      require('../../assets/images/adventure/stage-1-1/frame_1.png'),
      require('../../assets/images/adventure/stage-1-1/frame_2.png'),
      require('../../assets/images/adventure/stage-1-1/frame_3.png'),
      require('../../assets/images/adventure/stage-1-1/frame_4.png'),
    ],
    fps: 12,
  },
  attacked: {
    frames: [
      require('../../assets/images/adventure/stage-1-1-attacked/frame_0.png'),
      require('../../assets/images/adventure/stage-1-1-attacked/frame_1.png'),
      require('../../assets/images/adventure/stage-1-1-attacked/frame_2.png'),
      require('../../assets/images/adventure/stage-1-1-attacked/frame_3.png'),
      require('../../assets/images/adventure/stage-1-1-attacked/frame_4.png'),
    ],
    fps: 12,
  },
};
/* eslint-enable @typescript-eslint/no-require-imports */

// Per-stage monster animation frames — `attacked` is optional — plays once
// (in place of `idle`) each time a rep counts against that stage, then
// falls back to idle; a stage with no `attacked` clip just never leaves its
// idle animation. Every chapter-1 stage points at the same CHAPTER_1_SLIME
// object (see comment above), so add distinct entries here once later
// chapters get their own art.
export const STAGE_MONSTER_ART: Partial<Record<string, { idle: MonsterClip; attacked?: MonsterClip }>> =
  Object.fromEntries(ADVENTURE_STAGES.filter((s) => s.chapter === 1).map((s) => [s.id, CHAPTER_1_SLIME]));

/** True if this stage is playable — the first stage in its exercise's chain, or the previous one in that chain has been cleared. */
export function isStageUnlocked(stage: StageConfig, cleared: ReadonlySet<string>): boolean {
  const chain = ADVENTURE_STAGES.filter((s) => s.exercise === stage.exercise);
  const index = chain.findIndex((s) => s.id === stage.id);
  if (index <= 0) return true;
  return cleared.has(chain[index - 1].id);
}

/** The next stage in this stage's exercise chain, or null if it's the last one. */
export function nextStage(stage: StageConfig): StageConfig | null {
  const chain = ADVENTURE_STAGES.filter((s) => s.exercise === stage.exercise);
  const index = chain.findIndex((s) => s.id === stage.id);
  if (index === -1 || index + 1 >= chain.length) return null;
  return chain[index + 1];
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
