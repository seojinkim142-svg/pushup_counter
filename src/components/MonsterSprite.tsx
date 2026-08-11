import { useEffect, useRef, useState } from 'react';
import { Image } from 'react-native';
import { STAGE_MONSTER_ART } from '../lib/adventure';

/**
 * Cycles a stage's monster animation frames (see STAGE_MONSTER_ART).
 * Renders nothing if the stage has no art yet. When `hitSignal` is given and
 * changes value (pass the live rep count — count changes exactly when a rep
 * lands), plays the stage's `attacked` clip once before falling back to idle.
 */
export default function MonsterSprite({
  stageId,
  size,
  hitSignal,
}: {
  stageId: string;
  size: number;
  hitSignal?: number;
}) {
  const art = STAGE_MONSTER_ART[stageId];
  const [frameIndex, setFrameIndex] = useState(0);
  const [showAttacked, setShowAttacked] = useState(false);
  const prevHitSignalRef = useRef(hitSignal);

  // Detect a "hit" (hitSignal went up, e.g. the rep count incrementing) and
  // switch to the attacked clip for the duration of one playthrough. Only
  // increases count as a hit — resetting the stage (count dropping back to
  // 0) shouldn't flash the attacked animation.
  useEffect(() => {
    const changed =
      hitSignal != null && prevHitSignalRef.current != null && hitSignal > prevHitSignalRef.current;
    prevHitSignalRef.current = hitSignal;
    if (!changed || art?.attacked == null) return;
    setShowAttacked(true);
    const attacked = art.attacked;
    const timeout = setTimeout(() => setShowAttacked(false), (1000 / attacked.fps) * attacked.frames.length);
    return () => clearTimeout(timeout);
  }, [hitSignal, art]);

  const clip = showAttacked ? art?.attacked : art?.idle;

  useEffect(() => {
    if (clip == null) return;
    setFrameIndex(0);
    const interval = setInterval(() => {
      setFrameIndex((i) => (i + 1) % clip.frames.length);
    }, 1000 / clip.fps);
    return () => clearInterval(interval);
  }, [clip]);

  if (clip == null) return null;
  return <Image source={clip.frames[frameIndex]} style={{ width: size, height: size }} resizeMode="contain" />;
}
