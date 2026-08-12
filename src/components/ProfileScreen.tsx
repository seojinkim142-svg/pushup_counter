import React from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import type { Session } from '@supabase/supabase-js';
import { signOut } from '../lib/auth';
import { ACCENT, TEXT_MUTED, TEXT_ON_ACCENT, TEXT_PRIMARY } from './theme';

export default function ProfileScreen({ session, onBack }: { session: Session; onBack: () => void }) {
  const name = (session.user.user_metadata?.full_name as string | undefined) ?? '이름 없음';
  const avatarUrl = session.user.user_metadata?.avatar_url as string | undefined;
  const email = session.user.email ?? null;

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
