import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Dimensions, StyleSheet, View } from 'react-native';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const PREVIEW_SIZE = SCREEN_WIDTH;

const GAUGE_WIDTH = 34;
const GAUGE_HEIGHT = 220;
const GAUGE_DOT_SIZE = 30;

export type ProgressGaugeHandle = { setTargetProgress: (progress: number | null) => void };

/**
 * Same isolation/interpolation trick as SkeletonOverlay, applied to the
 * depth gauge dot: detection results arrive at ~10fps, so snapping the dot
 * straight to each new progress value makes it visibly hop between
 * positions — most noticeably right around a counted rep, where progress,
 * stage, and count all change in the same detection frame. Tweening between
 * the last two values over the interval actually observed between them
 * smooths that out, and doing it in its own leaf component (fed via ref,
 * not CameraScreen state) keeps those up-to-60fps re-renders from touching
 * the tabs/counter/buttons the way the skeleton overlay's did before.
 */
// eslint-disable-next-line @typescript-eslint/ban-types
const ProgressGauge = forwardRef<ProgressGaugeHandle, {}>(function ProgressGauge(_props, ref) {
  const [progress, setProgress] = useState<number | null>(null);
  const prevRef = useRef<number | null>(null);
  const prevTimestampRef = useRef(Date.now());
  const targetRef = useRef<number | null>(null);
  const targetTimestampRef = useRef(Date.now());
  const settledRef = useRef(true);

  useImperativeHandle(
    ref,
    () => ({
      setTargetProgress(newProgress: number | null) {
        prevRef.current = targetRef.current;
        prevTimestampRef.current = targetTimestampRef.current;
        targetRef.current = newProgress;
        targetTimestampRef.current = Date.now();
        settledRef.current = false;
      },
    }),
    []
  );

  useEffect(() => {
    let frameId: number;

    const tick = () => {
      frameId = requestAnimationFrame(tick);
      if (settledRef.current) return;

      const prev = prevRef.current;
      const target = targetRef.current;
      if (prev == null || target == null) {
        // Gauge appearing/disappearing (person present/absent) — nothing to
        // interpolate from, so snap.
        setProgress(target);
        settledRef.current = true;
        return;
      }

      const duration = Math.max(1, targetTimestampRef.current - prevTimestampRef.current);
      const t = Math.min(1, (Date.now() - targetTimestampRef.current) / duration);
      setProgress(prev + (target - prev) * t);
      if (t >= 1) settledRef.current = true;
    };

    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, []);

  if (progress == null) return null;

  return (
    <View style={styles.gaugeTrack}>
      <View style={[styles.gaugeZone, { flex: 0.2, backgroundColor: '#FF4D4D' }]} />
      <View style={[styles.gaugeZone, { flex: 0.6, backgroundColor: '#3B82F6' }]} />
      <View style={[styles.gaugeZone, { flex: 0.2, backgroundColor: '#39FF88' }]} />
      <View style={[styles.gaugeDot, { top: progress * (GAUGE_HEIGHT - GAUGE_DOT_SIZE) }]} />
    </View>
  );
});

export default ProgressGauge;

const styles = StyleSheet.create({
  gaugeTrack: {
    position: 'absolute',
    left: 16,
    top: (PREVIEW_SIZE - GAUGE_HEIGHT) / 2,
    width: GAUGE_WIDTH,
    height: GAUGE_HEIGHT,
    borderRadius: GAUGE_WIDTH / 2,
    overflow: 'hidden',
    flexDirection: 'column',
  },
  gaugeZone: {
    width: '100%',
  },
  gaugeDot: {
    position: 'absolute',
    left: (GAUGE_WIDTH - GAUGE_DOT_SIZE) / 2,
    width: GAUGE_DOT_SIZE,
    height: GAUGE_DOT_SIZE,
    borderRadius: GAUGE_DOT_SIZE / 2,
    backgroundColor: '#FFFFFF',
    borderWidth: 2,
    borderColor: 'rgba(0,0,0,0.2)',
  },
});
