import { useEffect, useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { ACCENT_ON_DARK } from './theme';

/**
 * Live SS:CS (seconds:centiseconds) countdown, updated via rAF instead of
 * React state ticking once a second — the existing shrinking bar reads at a
 * glance from across a room, but doesn't let you perceive exactly how much
 * time is left the way a precise running clock does, which matters more in
 * adventure mode where a stage can come down to the wire. Isolated in its
 * own leaf component (same trick as ProgressGauge/SkeletonOverlay) so this
 * ~60fps text update never re-renders the rest of the screen.
 */
export default function CountdownClock({
  active,
  startRef,
  limitSec,
}: {
  active: boolean;
  startRef: React.RefObject<number | null>;
  limitSec: number;
}) {
  const [label, setLabel] = useState('00:00');

  useEffect(() => {
    if (!active) return;
    let frameId: number;

    const tick = () => {
      frameId = requestAnimationFrame(tick);
      const start = startRef.current;
      if (start == null) return;
      const remainingMs = Math.max(0, limitSec * 1000 - (Date.now() - start));
      const seconds = Math.floor(remainingMs / 1000);
      const centiseconds = Math.floor((remainingMs % 1000) / 10);
      setLabel(`${String(seconds).padStart(2, '0')}:${String(centiseconds).padStart(2, '0')}`);
    };

    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [active, startRef, limitSec]);

  return <Text style={styles.countdownClockText}>{label}</Text>;
}

const styles = StyleSheet.create({
  countdownClockText: {
    color: ACCENT_ON_DARK,
    fontSize: 64,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
});
