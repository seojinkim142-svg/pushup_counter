import {
  getRoutineDaySets,
  getRoutineRestSec,
  resolveTrack,
  startingWeek,
  ROUTINE_WEEK_COUNT,
  ROUTINE_DAY_COUNT,
} from '../routine';

describe('resolveTrack', () => {
  it('maps a low baseline (<=5) to track 0', () => {
    expect(resolveTrack(0)).toBe(0);
    expect(resolveTrack(5)).toBe(0);
  });

  it('maps a mid baseline (6-10) to track 1', () => {
    expect(resolveTrack(6)).toBe(1);
    expect(resolveTrack(10)).toBe(1);
  });

  it('maps a high baseline (11-19) to track 2', () => {
    expect(resolveTrack(11)).toBe(2);
    expect(resolveTrack(19)).toBe(2);
  });

  it('maps a 20+ baseline using week 3\'s own bracket instead', () => {
    expect(resolveTrack(20)).toBe(0);
    expect(resolveTrack(25)).toBe(1);
    expect(resolveTrack(26)).toBe(2);
  });
});

describe('startingWeek', () => {
  it('starts at week 1 under 20 reps', () => {
    expect(startingWeek(19)).toBe(1);
  });

  it('starts at week 3 at 20+ reps', () => {
    expect(startingWeek(20)).toBe(3);
    expect(startingWeek(40)).toBe(3);
  });
});

describe('getRoutineDaySets / getRoutineRestSec', () => {
  it('has 6 weeks of 3 days each', () => {
    expect(ROUTINE_WEEK_COUNT).toBe(6);
    expect(ROUTINE_DAY_COUNT).toBe(3);
  });

  it('returns the right number of sets and picks the requested track column', () => {
    const track0 = getRoutineDaySets(1, 1, 0);
    const track2 = getRoutineDaySets(1, 1, 2);
    expect(track0).toEqual([3, 3, 2, 2, 3]);
    expect(track2).toEqual([10, 12, 7, 7, 9]);
  });

  it('later weeks can have more sets than earlier weeks', () => {
    expect(getRoutineDaySets(1, 1, 0).length).toBe(5);
    expect(getRoutineDaySets(5, 2, 0).length).toBe(8);
    expect(getRoutineDaySets(6, 2, 0).length).toBe(9);
  });

  it('targets climb within a week and from week to week for the same track', () => {
    const week1Day1 = getRoutineDaySets(1, 1, 1);
    const week6Day1 = getRoutineDaySets(6, 1, 1);
    expect(Math.max(...week6Day1)).toBeGreaterThan(Math.max(...week1Day1));
  });

  it('returns each day\'s rest seconds', () => {
    expect(getRoutineRestSec(1, 1)).toBe(60);
    expect(getRoutineRestSec(2, 3)).toBe(120);
    expect(getRoutineRestSec(5, 2)).toBe(45);
  });

  it('returns an empty list for an out-of-range week/day', () => {
    expect(getRoutineDaySets(7, 1, 0)).toEqual([]);
    expect(getRoutineDaySets(1, 4, 0)).toEqual([]);
  });
});
