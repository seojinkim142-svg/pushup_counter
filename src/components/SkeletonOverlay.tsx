import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { StyleSheet } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { MIN_KEYPOINT_SCORE, SKELETON_EDGES } from '../lib/pose';
import { ACCENT_ON_DARK } from './theme';

export type ScreenPoint = { x: number; y: number; score: number };

const JOINT_RADIUS = 4;

/**
 * Builds one SVG path string for the whole skeleton (all edges as separate
 * M/L subpaths) instead of one <Line> element per edge. On this device,
 * committing ~24 individual react-native-svg host elements every update was
 * itself the render bottleneck (confirmed by measuring rAF throughput with
 * the skeleton removed: steady 60fps vs. ~10fps with it) — a single <Path>
 * element is one native view no matter how many segments its `d` describes.
 */
function buildSkeletonEdgesPath(points: ScreenPoint[]): string {
  let d = '';
  for (const [a, b] of SKELETON_EDGES) {
    const pa = points[a];
    const pb = points[b];
    if (!pa || !pb) continue;
    if (pa.score < MIN_KEYPOINT_SCORE || pb.score < MIN_KEYPOINT_SCORE) continue;
    d += `M${pa.x},${pa.y}L${pb.x},${pb.y}`;
  }
  return d;
}

/** Same idea as buildSkeletonEdgesPath, but for the joint dots (each a two-arc circle subpath). */
function buildSkeletonJointsPath(points: ScreenPoint[], r: number): string {
  let d = '';
  for (const p of points) {
    if (p.score <= MIN_KEYPOINT_SCORE) continue;
    d += `M${p.x - r},${p.y}a${r},${r} 0 1,0 ${2 * r},0a${r},${r} 0 1,0 ${-2 * r},0`;
  }
  return d;
}

export type SkeletonOverlayHandle = { setTargetPoints: (points: ScreenPoint[]) => void };

/**
 * Isolates the highest-churn state (interpolated skeleton points, up to
 * display refresh rate) in its own leaf component. Parent (CameraScreen)
 * feeds new detections in imperatively via the ref instead of prop/state,
 * so this component's frequent re-renders never touch the tabs, buttons,
 * counter, or gauge — only these two <Path> elements re-render.
 */
const SkeletonOverlay = forwardRef<SkeletonOverlayHandle, { width: number; height: number }>(
  function SkeletonOverlay({ width, height }, ref) {
    const [points, setPoints] = useState<ScreenPoint[]>([]);
    const prevRef = useRef<ScreenPoint[]>([]);
    const prevTimestampRef = useRef(Date.now());
    const targetRef = useRef<ScreenPoint[]>([]);
    const targetTimestampRef = useRef(Date.now());
    const settledRef = useRef(true);

    useImperativeHandle(
      ref,
      () => ({
        setTargetPoints(newPoints: ScreenPoint[]) {
          prevRef.current = targetRef.current;
          prevTimestampRef.current = targetTimestampRef.current;
          targetRef.current = newPoints;
          targetTimestampRef.current = Date.now();
          settledRef.current = false;
        },
      }),
      []
    );

    // Renders at display refresh rate by interpolating between the last two
    // detection results over the interval actually observed between them,
    // instead of holding each result's position until the next one arrives.
    useEffect(() => {
      let frameId: number;

      const tick = () => {
        frameId = requestAnimationFrame(tick);
        if (settledRef.current) return;

        const prev = prevRef.current;
        const target = targetRef.current;
        if (prev.length !== target.length) {
          // Person just appeared/disappeared — nothing to interpolate from.
          setPoints(target);
          settledRef.current = true;
          return;
        }

        const duration = Math.max(1, targetTimestampRef.current - prevTimestampRef.current);
        const t = Math.min(1, (Date.now() - targetTimestampRef.current) / duration);
        setPoints(
          target.map((p, i) => {
            const from = prev[i];
            return { x: from.x + (p.x - from.x) * t, y: from.y + (p.y - from.y) * t, score: p.score };
          })
        );
        if (t >= 1) settledRef.current = true;
      };

      frameId = requestAnimationFrame(tick);
      return () => cancelAnimationFrame(frameId);
    }, []);

    return (
      <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
        <Path d={buildSkeletonEdgesPath(points)} stroke={ACCENT_ON_DARK} strokeWidth={2.5} fill="none" />
        <Path d={buildSkeletonJointsPath(points, JOINT_RADIUS)} fill={ACCENT_ON_DARK} />
      </Svg>
    );
  }
);

export default SkeletonOverlay;
