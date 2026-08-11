import { useEffect, useRef, useState } from 'react';
import { Animated, Image, StyleSheet, View } from 'react-native';
import { STAGE_MONSTER_ART } from '../lib/adventure';

// How long the red hit-flash takes to fade back out. Short and immediate
// (starts at full opacity, no fade-in) so it reads as a sharp "hit" beat
// rather than a slow pulse.
const HIT_FLASH_FADE_MS = 300;

/**
 * Cycles a stage's monster animation frames (see STAGE_MONSTER_ART).
 * Renders nothing if the stage has no art yet. When `hitSignal` is given and
 * changes value (pass the live rep count — count changes exactly when a rep
 * lands), plays the stage's `attacked` clip once before falling back to idle,
 * and flashes the sprite red regardless of whether an `attacked` clip exists
 * — the clip's own motion alone was too subtle to reliably notice a hit.
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
  const flashOpacity = useRef(new Animated.Value(0)).current;

  // Detect a "hit" (hitSignal went up, e.g. the rep count incrementing).
  // Only increases count as a hit — resetting the stage (count dropping
  // back to 0) shouldn't trigger the flash or the attacked animation.
  useEffect(() => {
    const changed =
      hitSignal != null && prevHitSignalRef.current != null && hitSignal > prevHitSignalRef.current;
    prevHitSignalRef.current = hitSignal;
    if (!changed) return;

    flashOpacity.setValue(1);
    Animated.timing(flashOpacity, {
      toValue: 0,
      duration: HIT_FLASH_FADE_MS,
      useNativeDriver: true,
    }).start();

    if (art?.attacked == null) return;
    setShowAttacked(true);
    const attacked = art.attacked;
    const timeout = setTimeout(() => setShowAttacked(false), (1000 / attacked.fps) * attacked.frames.length);
    return () => clearTimeout(timeout);
  }, [hitSignal, art, flashOpacity]);

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
  const source = clip.frames[frameIndex];
  return (
    <View style={{ width: size, height: size }}>
      <Image source={source} style={styles.sprite} resizeMode="contain" />
      {/* Same source re-rendered with a red tint — tintColor recolors only
          the sprite's opaque pixels, so this reads as the monster itself
          flashing red instead of a red box covering it. */}
      <Animated.Image
        source={source}
        style={[styles.sprite, styles.flashOverlay, { opacity: flashOpacity, tintColor: '#FF3B30' }]}
        resizeMode="contain"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  sprite: {
    width: '100%',
    height: '100%',
  },
  flashOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
});
