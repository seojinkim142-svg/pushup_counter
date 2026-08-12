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
type StageDifficulty = { targetCount: number; timeLimitSec: number };

// Each of the three real exercises (armCurlTest is a tuning aid, not a real
// workout, so it's excluded here) gets its own independent stage chain,
// chosen up front via CameraScreen's adventure exercise-select screen —
// clearing pushup's stages doesn't unlock squat's, and vice versa. Every
// chapter's first stage (N-1) is unlocked from the start — chapters are
// browsed via 다음장/이전장 rather than earned by clearing the previous
// chapter — but within a chapter, stages 2-5 still require the previous one
// in that same chapter to be cleared (see isStageUnlocked). Difficulty
// climbs both within a chapter and from one chapter to the next — later
// stages get both a higher target count and less time per rep.
const CHAPTER_PROGRESSIONS: Record<ChapterExercise, StageDifficulty[]>[] = [
  {
    // Chapter 1
    pushup: [
      { targetCount: 4, timeLimitSec: 30 },
      { targetCount: 6, timeLimitSec: 30 },
      { targetCount: 8, timeLimitSec: 32 },
      { targetCount: 10, timeLimitSec: 34 },
      { targetCount: 12, timeLimitSec: 36 },
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
  },
  {
    // Chapter 2
    pushup: [
      { targetCount: 16, timeLimitSec: 36 },
      { targetCount: 18, timeLimitSec: 36 },
      { targetCount: 20, timeLimitSec: 38 },
      { targetCount: 22, timeLimitSec: 38 },
      { targetCount: 24, timeLimitSec: 40 },
    ],
    squat: [
      { targetCount: 25, timeLimitSec: 36 },
      { targetCount: 28, timeLimitSec: 36 },
      { targetCount: 32, timeLimitSec: 38 },
      { targetCount: 36, timeLimitSec: 38 },
      { targetCount: 40, timeLimitSec: 40 },
    ],
    jumpingJack: [
      { targetCount: 40, timeLimitSec: 30 },
      { targetCount: 45, timeLimitSec: 31 },
      { targetCount: 50, timeLimitSec: 32 },
      { targetCount: 55, timeLimitSec: 33 },
      { targetCount: 60, timeLimitSec: 35 },
    ],
  },
  {
    // Chapter 3
    pushup: [
      { targetCount: 28, timeLimitSec: 40 },
      { targetCount: 30, timeLimitSec: 40 },
      { targetCount: 32, timeLimitSec: 42 },
      { targetCount: 34, timeLimitSec: 42 },
      { targetCount: 36, timeLimitSec: 44 },
    ],
    squat: [
      { targetCount: 43, timeLimitSec: 40 },
      { targetCount: 46, timeLimitSec: 40 },
      { targetCount: 50, timeLimitSec: 42 },
      { targetCount: 54, timeLimitSec: 42 },
      { targetCount: 58, timeLimitSec: 44 },
    ],
    jumpingJack: [
      { targetCount: 65, timeLimitSec: 35 },
      { targetCount: 70, timeLimitSec: 36 },
      { targetCount: 75, timeLimitSec: 37 },
      { targetCount: 80, timeLimitSec: 38 },
      { targetCount: 85, timeLimitSec: 40 },
    ],
  },
  {
    // Chapter 4
    pushup: [
      { targetCount: 40, timeLimitSec: 44 },
      { targetCount: 42, timeLimitSec: 44 },
      { targetCount: 44, timeLimitSec: 46 },
      { targetCount: 46, timeLimitSec: 46 },
      { targetCount: 48, timeLimitSec: 48 },
    ],
    squat: [
      { targetCount: 61, timeLimitSec: 44 },
      { targetCount: 64, timeLimitSec: 44 },
      { targetCount: 68, timeLimitSec: 46 },
      { targetCount: 72, timeLimitSec: 46 },
      { targetCount: 76, timeLimitSec: 48 },
    ],
    jumpingJack: [
      { targetCount: 90, timeLimitSec: 40 },
      { targetCount: 95, timeLimitSec: 41 },
      { targetCount: 100, timeLimitSec: 42 },
      { targetCount: 105, timeLimitSec: 43 },
      { targetCount: 110, timeLimitSec: 45 },
    ],
  },
  {
    // Chapter 5
    pushup: [
      { targetCount: 52, timeLimitSec: 48 },
      { targetCount: 54, timeLimitSec: 48 },
      { targetCount: 56, timeLimitSec: 50 },
      { targetCount: 58, timeLimitSec: 50 },
      { targetCount: 60, timeLimitSec: 52 },
    ],
    squat: [
      { targetCount: 79, timeLimitSec: 48 },
      { targetCount: 82, timeLimitSec: 48 },
      { targetCount: 86, timeLimitSec: 50 },
      { targetCount: 90, timeLimitSec: 50 },
      { targetCount: 94, timeLimitSec: 52 },
    ],
    jumpingJack: [
      { targetCount: 115, timeLimitSec: 45 },
      { targetCount: 120, timeLimitSec: 46 },
      { targetCount: 125, timeLimitSec: 47 },
      { targetCount: 130, timeLimitSec: 48 },
      { targetCount: 135, timeLimitSec: 50 },
    ],
  },
];

export const ADVENTURE_STAGES: StageConfig[] = (Object.keys(CHAPTER_PROGRESSIONS[0]) as ChapterExercise[]).flatMap(
  (exercise) =>
    CHAPTER_PROGRESSIONS.flatMap((chapterProgression, chapterIndex) =>
      chapterProgression[exercise].map((cfg, i) => ({
        id: `${exercise}-${chapterIndex + 1}-${i + 1}`,
        chapter: chapterIndex + 1,
        stageNumber: i + 1,
        label: `${chapterIndex + 1}-${i + 1}`,
        exercise,
        targetCount: cfg.targetCount,
        timeLimitSec: cfg.timeLimitSec,
      }))
    )
);

export type MonsterClip = { frames: number[]; fps: number };

// Every stage in a chapter shares the same monster art across all three
// exercise chains — only the exact per-stage difficulty differs, not the
// monster. RN's bundler needs static require() calls, so the frame paths
// can't be built from a variable at runtime.
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
// Chapters 2-5 reuse chapter 1's slime frames hue-shifted to a different
// color (see scratchpad/recolor.js, run by hand) — same shading/highlights,
// just a different hue, so each chapter's monster still reads as "a slime"
// while being visually distinct at a glance. RN's bundler needs static
// require() calls (no template-literal paths), so each chapter needs its
// own explicit block below rather than a shared helper function.
const CHAPTER_2_SLIME: { idle: MonsterClip; attacked: MonsterClip } = {
  idle: {
    frames: [
      require('../../assets/images/adventure/chapter-2-slime/frame_0.png'),
      require('../../assets/images/adventure/chapter-2-slime/frame_1.png'),
      require('../../assets/images/adventure/chapter-2-slime/frame_2.png'),
      require('../../assets/images/adventure/chapter-2-slime/frame_3.png'),
      require('../../assets/images/adventure/chapter-2-slime/frame_4.png'),
    ],
    fps: 12,
  },
  attacked: {
    frames: [
      require('../../assets/images/adventure/chapter-2-slime-attacked/frame_0.png'),
      require('../../assets/images/adventure/chapter-2-slime-attacked/frame_1.png'),
      require('../../assets/images/adventure/chapter-2-slime-attacked/frame_2.png'),
      require('../../assets/images/adventure/chapter-2-slime-attacked/frame_3.png'),
      require('../../assets/images/adventure/chapter-2-slime-attacked/frame_4.png'),
    ],
    fps: 12,
  },
};
const CHAPTER_3_SLIME: { idle: MonsterClip; attacked: MonsterClip } = {
  idle: {
    frames: [
      require('../../assets/images/adventure/chapter-3-slime/frame_0.png'),
      require('../../assets/images/adventure/chapter-3-slime/frame_1.png'),
      require('../../assets/images/adventure/chapter-3-slime/frame_2.png'),
      require('../../assets/images/adventure/chapter-3-slime/frame_3.png'),
      require('../../assets/images/adventure/chapter-3-slime/frame_4.png'),
    ],
    fps: 12,
  },
  attacked: {
    frames: [
      require('../../assets/images/adventure/chapter-3-slime-attacked/frame_0.png'),
      require('../../assets/images/adventure/chapter-3-slime-attacked/frame_1.png'),
      require('../../assets/images/adventure/chapter-3-slime-attacked/frame_2.png'),
      require('../../assets/images/adventure/chapter-3-slime-attacked/frame_3.png'),
      require('../../assets/images/adventure/chapter-3-slime-attacked/frame_4.png'),
    ],
    fps: 12,
  },
};
const CHAPTER_4_SLIME: { idle: MonsterClip; attacked: MonsterClip } = {
  idle: {
    frames: [
      require('../../assets/images/adventure/chapter-4-slime/frame_0.png'),
      require('../../assets/images/adventure/chapter-4-slime/frame_1.png'),
      require('../../assets/images/adventure/chapter-4-slime/frame_2.png'),
      require('../../assets/images/adventure/chapter-4-slime/frame_3.png'),
      require('../../assets/images/adventure/chapter-4-slime/frame_4.png'),
    ],
    fps: 12,
  },
  attacked: {
    frames: [
      require('../../assets/images/adventure/chapter-4-slime-attacked/frame_0.png'),
      require('../../assets/images/adventure/chapter-4-slime-attacked/frame_1.png'),
      require('../../assets/images/adventure/chapter-4-slime-attacked/frame_2.png'),
      require('../../assets/images/adventure/chapter-4-slime-attacked/frame_3.png'),
      require('../../assets/images/adventure/chapter-4-slime-attacked/frame_4.png'),
    ],
    fps: 12,
  },
};
const CHAPTER_5_SLIME: { idle: MonsterClip; attacked: MonsterClip } = {
  idle: {
    frames: [
      require('../../assets/images/adventure/chapter-5-slime/frame_0.png'),
      require('../../assets/images/adventure/chapter-5-slime/frame_1.png'),
      require('../../assets/images/adventure/chapter-5-slime/frame_2.png'),
      require('../../assets/images/adventure/chapter-5-slime/frame_3.png'),
      require('../../assets/images/adventure/chapter-5-slime/frame_4.png'),
    ],
    fps: 12,
  },
  attacked: {
    frames: [
      require('../../assets/images/adventure/chapter-5-slime-attacked/frame_0.png'),
      require('../../assets/images/adventure/chapter-5-slime-attacked/frame_1.png'),
      require('../../assets/images/adventure/chapter-5-slime-attacked/frame_2.png'),
      require('../../assets/images/adventure/chapter-5-slime-attacked/frame_3.png'),
      require('../../assets/images/adventure/chapter-5-slime-attacked/frame_4.png'),
    ],
    fps: 12,
  },
};
/* eslint-enable @typescript-eslint/no-require-imports */

const CHAPTER_MONSTER_ART: Record<number, { idle: MonsterClip; attacked?: MonsterClip }> = {
  1: CHAPTER_1_SLIME, // blue
  2: CHAPTER_2_SLIME, // yellow
  3: CHAPTER_3_SLIME, // green
  4: CHAPTER_4_SLIME, // red
  5: CHAPTER_5_SLIME, // navy
};

// Per-stage monster animation frames — `attacked` is optional — plays once
// (in place of `idle`) each time a rep counts against that stage, then
// falls back to idle; a stage with no `attacked` clip just never leaves its
// idle animation. Every stage points at its chapter's shared art (see
// CHAPTER_MONSTER_ART above).
export const STAGE_MONSTER_ART: Partial<Record<string, { idle: MonsterClip; attacked?: MonsterClip }>> =
  Object.fromEntries(ADVENTURE_STAGES.map((s) => [s.id, CHAPTER_MONSTER_ART[s.chapter]]));

/**
 * True if this stage is playable — every chapter's first stage (N-1) is
 * always open, so a chapter is reachable via 다음장/이전장 without first
 * clearing every earlier chapter; stages after that still require the
 * previous one in the same chapter (same exercise, same chapter) to be
 * cleared.
 */
export function isStageUnlocked(stage: StageConfig, cleared: ReadonlySet<string>): boolean {
  if (stage.stageNumber === 1) return true;
  const chain = ADVENTURE_STAGES.filter((s) => s.exercise === stage.exercise && s.chapter === stage.chapter);
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
