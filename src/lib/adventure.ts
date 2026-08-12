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

// Flat pace: every stage gets exactly 2 seconds per rep (e.g. a 4-rep stage
// gets 8 seconds), regardless of exercise or chapter.
const SECONDS_PER_REP = 2;

// Each of the three real exercises (armCurlTest is a tuning aid, not a real
// workout, so it's excluded here) gets its own independent stage chain,
// chosen up front via CameraScreen's adventure exercise-select screen —
// clearing pushup's stages doesn't unlock squat's, and vice versa. Every
// chapter's first stage (N-1) is unlocked from the start — chapters are
// browsed via 다음장/이전장 rather than earned by clearing the previous
// chapter — but within a chapter, stages 2-5 still require the previous one
// in that same chapter to be cleared (see isStageUnlocked). Target counts
// climb both within a chapter and from one chapter to the next.
const CHAPTER_PROGRESSIONS: Record<ChapterExercise, number[]>[] = [
  {
    // Chapter 1
    pushup: [4, 6, 8, 10, 12],
    squat: [8, 12, 15, 18, 22],
    jumpingJack: [15, 20, 25, 30, 35],
  },
  {
    // Chapter 2
    pushup: [16, 18, 20, 22, 24],
    squat: [25, 28, 32, 36, 40],
    jumpingJack: [40, 45, 50, 55, 60],
  },
  {
    // Chapter 3
    pushup: [28, 30, 32, 34, 36],
    squat: [43, 46, 50, 54, 58],
    jumpingJack: [65, 70, 75, 80, 85],
  },
  {
    // Chapter 4
    pushup: [40, 42, 44, 46, 48],
    squat: [61, 64, 68, 72, 76],
    jumpingJack: [90, 95, 100, 105, 110],
  },
  {
    // Chapter 5
    pushup: [52, 54, 56, 58, 60],
    squat: [79, 82, 86, 90, 94],
    jumpingJack: [115, 120, 125, 130, 135],
  },
];

export const ADVENTURE_STAGES: StageConfig[] = (Object.keys(CHAPTER_PROGRESSIONS[0]) as ChapterExercise[]).flatMap(
  (exercise) =>
    CHAPTER_PROGRESSIONS.flatMap((chapterProgression, chapterIndex) =>
      chapterProgression[exercise].map((targetCount, i) => ({
        id: `${exercise}-${chapterIndex + 1}-${i + 1}`,
        chapter: chapterIndex + 1,
        stageNumber: i + 1,
        label: `${chapterIndex + 1}-${i + 1}`,
        exercise,
        targetCount,
        timeLimitSec: targetCount * SECONDS_PER_REP,
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
