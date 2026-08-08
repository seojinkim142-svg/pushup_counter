function smoothingFactor(te: number, cutoff: number): number {
  const r = 2 * Math.PI * cutoff * te;
  return r / (r + 1);
}

function exponentialSmoothing(a: number, value: number, prev: number): number {
  return a * value + (1 - a) * prev;
}

/**
 * One-Euro filter (Casiez, Roussel & Vogel 2012) — smooths a noisy signal
 * (e.g. a landmark coordinate that jitters frame to frame) while keeping
 * latency low: it filters heavily when the signal is nearly still and
 * lightly when it's moving fast, instead of picking one fixed cutoff that's
 * either laggy or jittery.
 */
export class OneEuroFilter {
  private minCutoff: number;
  private beta: number;
  private dCutoff: number;
  private xPrev: number | null = null;
  private dxPrev = 0;
  private lastTimestamp: number | null = null;

  constructor(minCutoff = 1.0, beta = 0.0, dCutoff = 1.0) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
  }

  reset(): void {
    this.xPrev = null;
    this.dxPrev = 0;
    this.lastTimestamp = null;
  }

  /** @param timestampMs a monotonically increasing clock, e.g. Date.now() */
  filter(value: number, timestampMs: number): number {
    if (this.xPrev == null || this.lastTimestamp == null) {
      this.xPrev = value;
      this.lastTimestamp = timestampMs;
      return value;
    }

    let te = (timestampMs - this.lastTimestamp) / 1000;
    if (te <= 0) te = 1 / 30;
    this.lastTimestamp = timestampMs;

    const dx = (value - this.xPrev) / te;
    const dxSmoothed = exponentialSmoothing(smoothingFactor(te, this.dCutoff), dx, this.dxPrev);
    this.dxPrev = dxSmoothed;

    const cutoff = this.minCutoff + this.beta * Math.abs(dxSmoothed);
    const xSmoothed = exponentialSmoothing(smoothingFactor(te, cutoff), value, this.xPrev);
    this.xPrev = xSmoothed;

    return xSmoothed;
  }
}
