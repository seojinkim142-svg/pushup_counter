import React, { useEffect, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import type { Session } from '@supabase/supabase-js';
import { signOut } from '../lib/auth';
import { ADVENTURE_STAGES, loadClearedStages } from '../lib/adventure';
import { loadRoutineProgress, type RoutineProgress } from '../lib/routine';
import { ACCENT, TEXT_MUTED, TEXT_ON_ACCENT, TEXT_PRIMARY } from './theme';

export default function ProfileScreen({ session, onBack }: { session: Session; onBack: () => void }) {
  const name = (session.user.user_metadata?.full_name as string | undefined) ?? '이름 없음';
  const avatarUrl = session.user.user_metadata?.avatar_url as string | undefined;
  const email = session.user.email ?? null;

  const [clearedCount, setClearedCount] = useState<number | null>(null);
  const [routineProgress, setRoutineProgress] = useState<RoutineProgress | null | undefined>(undefined);

  useEffect(() => {
    loadClearedStages().then((cleared) => setClearedCount(cleared.size));
    loadRoutineProgress().then(setRoutineProgress);
  }, []);

  return (
    <View style={styles.center}>
      <Pressable style={styles.backButton} onPress={onBack}>
        <Text style={styles.backButtonText}>‹ 모드 선택</Text>
      </Pressable>
      {avatarUrl != null ? (
        <Image source={{ uri: avatarUrl }} style={styles.avatar} />
      ) : (
        <View style={[styles.avatar, styles.avatarPlaceholder]}>
          <Text style={styles.avatarPlaceholderText}>{name.slice(0, 1)}</Text>
        </View>
      )}
      <Text style={styles.name}>{name}</Text>
      {email != null && <Text style={styles.email}>{email}</Text>}

      <View style={styles.statsRow}>
        <View style={styles.statBox}>
          <Text style={styles.statValue}>
            {clearedCount == null ? '·' : `${clearedCount} / ${ADVENTURE_STAGES.length}`}
          </Text>
          <Text style={styles.statLabel}>모험모드 클리어</Text>
        </View>
        <View style={styles.statBox}>
          <Text style={styles.statValue}>
            {routineProgress === undefined
              ? '·'
              : routineProgress == null
                ? '미시작'
                : `${routineProgress.week}주 ${routineProgress.day}일차`}
          </Text>
          <Text style={styles.statLabel}>루틴모드 진행</Text>
        </View>
      </View>

      <Pressable style={styles.button} onPress={signOut}>
        <Text style={styles.buttonText}>로그아웃</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F0F9FF',
    padding: 24,
    gap: 16,
  },
  backButton: {
    position: 'absolute',
    top: 36,
    left: 24,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: '#E0F2FE',
  },
  backButtonText: {
    color: TEXT_MUTED,
    fontSize: 14,
    fontWeight: '600',
  },
  avatar: {
    width: 96,
    height: 96,
    borderRadius: 48,
  },
  avatarPlaceholder: {
    backgroundColor: ACCENT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarPlaceholderText: {
    color: TEXT_ON_ACCENT,
    fontSize: 36,
    fontWeight: '800',
  },
  name: {
    color: TEXT_PRIMARY,
    fontSize: 20,
    fontWeight: '800',
  },
  email: {
    color: TEXT_MUTED,
    fontSize: 14,
    marginTop: -12,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
  },
  statBox: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#DBEAFE',
    paddingVertical: 16,
    paddingHorizontal: 20,
    alignItems: 'center',
    minWidth: 130,
  },
  statValue: {
    color: ACCENT,
    fontSize: 18,
    fontWeight: '800',
  },
  statLabel: {
    color: TEXT_MUTED,
    fontSize: 12,
    marginTop: 4,
  },
  button: {
    backgroundColor: ACCENT,
    borderRadius: 999,
    paddingVertical: 14,
    paddingHorizontal: 28,
    minWidth: 160,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonText: {
    color: TEXT_ON_ACCENT,
    fontSize: 16,
    fontWeight: '700',
  },
});
