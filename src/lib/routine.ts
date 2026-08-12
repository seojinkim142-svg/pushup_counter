import { supabase } from './supabaseClient';

export type RoutineTrack = 0 | 1 | 2;

// Each day's sets share one rest duration (the table's "REST N SECONDS
// BETWEEN EACH SET" header) — only the per-set target rep count varies,
// one number per track (0/1/2).
type RoutineDayData = { restSec: number; sets: [number, number, number][] };
type RoutineWeekData = { days: RoutineDayData[] };

// Transcribed from the user-provided 6-week routine image. Column headers
// differ per week (e.g. week 1's "<5/6-10/11-20" vs week 3's "16-20/21-25/
// >25") but there's no retest mechanic in the rules, so a track picked once
// at the baseline test (see resolveTrack/startingWeek) is just followed as
// column index 0/1/2 through every week regardless of that week's label
// text — the labels are illustrative, not a re-bracketing point.
const ROUTINE_WEEKS: RoutineWeekData[] = [
  {
    // Week 1
    days: [
      {
        restSec: 60,
        sets: [
          [3, 6, 10],
          [3, 6, 12],
          [2, 4, 7],
          [2, 4, 7],
          [3, 5, 9],
        ],
      },
      {
        restSec: 60,
        sets: [
          [3, 6, 10],
          [3, 6, 12],
          [2, 6, 8],
          [3, 6, 8],
          [4, 7, 12],
        ],
      },
      {
        restSec: 60,
        sets: [
          [4, 8, 11],
          [4, 8, 15],
          [2, 5, 10],
          [2, 4, 7],
          [5, 10, 15],
        ],
      },
    ],
  },
  {
    // Week 2
    days: [
      {
        restSec: 60,
        sets: [
          [4, 9, 14],
          [4, 11, 14],
          [4, 8, 10],
          [4, 8, 10],
          [6, 11, 15],
        ],
      },
      {
        restSec: 90,
        sets: [
          [5, 10, 14],
          [6, 10, 16],
          [4, 9, 12],
          [4, 9, 12],
          [7, 13, 17],
        ],
      },
      {
        restSec: 120,
        sets: [
          [5, 12, 16],
          [7, 13, 17],
          [5, 10, 14],
          [5, 10, 14],
          [8, 15, 20],
        ],
      },
    ],
  },
  {
    // Week 3
    days: [
      {
        restSec: 60,
        sets: [
          [10, 12, 14],
          [12, 17, 18],
          [7, 12, 13],
          [7, 13, 14],
          [9, 17, 20],
        ],
      },
      {
        restSec: 90,
        sets: [
          [10, 14, 20],
          [12, 19, 25],
          [8, 14, 15],
          [8, 14, 15],
          [12, 19, 25],
        ],
      },
      {
        restSec: 120,
        sets: [
          [11, 16, 22],
          [13, 21, 30],
          [9, 15, 20],
          [9, 15, 20],
          [13, 21, 28],
        ],
      },
    ],
  },
  {
    // Week 4
    days: [
      {
        restSec: 60,
        sets: [
          [12, 18, 21],
          [12, 18, 25],
          [11, 12, 21],
          [10, 16, 21],
          [16, 25, 32],
        ],
      },
      {
        restSec: 90,
        sets: [
          [14, 20, 25],
          [10, 25, 25],
          [12, 20, 25],
          [12, 20, 25],
          [18, 28, 36],
        ],
      },
      {
        restSec: 120,
        sets: [
          [16, 23, 29],
          [18, 23, 33],
          [13, 23, 29],
          [13, 23, 29],
          [20, 33, 40],
        ],
      },
    ],
  },
  {
    // Week 5
    days: [
      {
        restSec: 60,
        sets: [
          [17, 23, 36],
          [18, 28, 40],
          [13, 25, 30],
          [15, 22, 24],
          [20, 35, 40],
        ],
      },
      {
        restSec: 45,
        sets: [
          [10, 18, 19],
          [10, 18, 20],
          [13, 20, 22],
          [15, 14, 18],
          [16, 14, 22],
          [10, 14, 16],
          [9, 16, 22],
          [25, 40, 45],
        ],
      },
      {
        restSec: 45,
        sets: [
          [13, 18, 20],
          [13, 18, 20],
          [13, 18, 24],
          [15, 18, 24],
          [12, 17, 20],
          [12, 17, 20],
          [12, 17, 20],
          [30, 45, 50],
        ],
      },
    ],
  },
  {
    // Week 6
    days: [
      {
        restSec: 60,
        sets: [
          [25, 40, 45],
          [30, 50, 55],
          [20, 35, 40],
          [15, 25, 30],
          [40, 50, 55],
        ],
      },
      {
        restSec: 45,
        sets: [
          [14, 20, 22],
          [14, 20, 22],
          [13, 23, 30],
          [14, 20, 24],
          [14, 20, 24],
          [10, 18, 20],
          [10, 18, 22],
          [10, 18, 22],
          [44, 53, 58],
        ],
      },
      {
        restSec: 45,
        sets: [
          [13, 22, 27],
          [13, 22, 27],
          [17, 22, 30],
          [16, 25, 33],
          [16, 25, 33],
          [16, 25, 33],
          [14, 18, 22],
          [14, 18, 22],
          [50, 55, 60],
        ],
      },
    ],
  },
];

export const ROUTINE_WEEK_COUNT = ROUTINE_WEEKS.length;
export const ROUTINE_DAY_COUNT = 3;

/** Baseline test count -> track (0/1/2), using week 1's bracket (<5 / 6-10 / 11-20). */
export function resolveTrack(baselineCount: number): RoutineTrack {
  if (baselineCount >= 20) {
    // Week 3's own bracket (16-20 / 21-25 / >25) applies once the baseline
    // clears the "skip to week 3" threshold (see startingWeek).
    if (baselineCount > 25) return 2;
    if (baselineCount >= 21) return 1;
    return 0;
  }
  if (baselineCount <= 5) return 0;
  if (baselineCount <= 10) return 1;
  return 2;
}

/** Baseline test count -> starting week (1, or 3 if 20+ real push-ups). */
export function startingWeek(baselineCount: number): number {
  return baselineCount >= 20 ? 3 : 1;
}

/** Target rep counts for every set in this week/day, for the given track. */
export function getRoutineDaySets(week: number, day: number, track: RoutineTrack): number[] {
  const weekData = ROUTINE_WEEKS[week - 1];
  const dayData = weekData?.days[day - 1];
  if (dayData == null) return [];
  return dayData.sets.map((s) => s[track]);
}

/** Rest time (seconds) between every set in this week/day. */
export function getRoutineRestSec(week: number, day: number): number {
  return ROUTINE_WEEKS[week - 1]?.days[day - 1]?.restSec ?? 60;
}

export type RoutineProgress = {
  baseline: number;
  track: RoutineTrack;
  week: number;
  day: number;
};

export async function loadRoutineProgress(): Promise<RoutineProgress | null> {
  const { data, error } = await supabase.from('routine_progress').select('baseline,track,week,day').maybeSingle();
  if (error != null) {
    console.warn('loadRoutineProgress failed', error.message);
    return null;
  }
  return data as RoutineProgress | null;
}

export async function saveRoutineProgress(progress: RoutineProgress): Promise<void> {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (userId == null) return;
  const { error } = await supabase
    .from('routine_progress')
    .upsert({ user_id: userId, ...progress, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
  if (error != null) console.warn('saveRoutineProgress failed', error.message);
}

/** Wipes the saved baseline/track/week/day so the baseline test runs again. */
export async function clearRoutineProgress(): Promise<void> {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (userId == null) return;
  const { error } = await supabase.from('routine_progress').delete().eq('user_id', userId);
  if (error != null) console.warn('clearRoutineProgress failed', error.message);
}
