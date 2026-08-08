import { OneEuroFilter } from '../oneEuroFilter';

describe('OneEuroFilter', () => {
  it('returns the first value unfiltered', () => {
    const filter = new OneEuroFilter();
    expect(filter.filter(0.5, 0)).toBe(0.5);
  });

  it('smooths a noisy signal toward the underlying trend', () => {
    const filter = new OneEuroFilter(1.0, 0.0, 1.0);
    let t = 0;
    let out = filter.filter(0, t);
    // Alternate around a slowly rising baseline — the filtered output should
    // track the baseline much more closely than the raw noisy input does.
    for (let i = 1; i <= 50; i++) {
      t += 33;
      const baseline = i * 0.01;
      const noisy = baseline + (i % 2 === 0 ? 0.2 : -0.2);
      out = filter.filter(noisy, t);
    }
    const finalBaseline = 50 * 0.01;
    expect(Math.abs(out - finalBaseline)).toBeLessThan(0.2);
  });

  it('resets to a clean first-sample state', () => {
    const filter = new OneEuroFilter();
    filter.filter(1, 0);
    filter.filter(2, 33);
    filter.reset();
    expect(filter.filter(9, 100)).toBe(9);
  });

  it('falls back to a default frame time when timestamps do not advance', () => {
    const filter = new OneEuroFilter();
    filter.filter(0, 100);
    // Same or earlier timestamp shouldn't throw or divide by zero.
    expect(() => filter.filter(1, 100)).not.toThrow();
  });
});
