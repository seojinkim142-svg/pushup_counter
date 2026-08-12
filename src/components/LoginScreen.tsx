import React, { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { signInWithGoogle } from '../lib/auth';
import { ACCENT, TEXT_MUTED, TEXT_ON_ACCENT, TEXT_PRIMARY } from './theme';

export default function LoginScreen() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handlePress = async () => {
    setLoading(true);
    setError(null);
    try {
      await signInWithGoogle();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.center}>
      <Text style={styles.title}>푸시업 카운터</Text>
      <Text style={styles.subtitle}>계정으로 로그인하면 기록이 기기와 상관없이 저장돼요.</Text>
      <Pressable style={[styles.button, loading && styles.buttonDisabled]} onPress={handlePress} disabled={loading}>
        {loading ? <ActivityIndicator color={TEXT_ON_ACCENT} /> : <Text style={styles.buttonText}>Google로 로그인</Text>}
      </Pressable>
      {error != null && <Text style={styles.error}>{error}</Text>}
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
  title: {
    color: TEXT_PRIMARY,
    fontSize: 24,
    fontWeight: '800',
  },
  subtitle: {
    color: TEXT_MUTED,
    fontSize: 14,
    textAlign: 'center',
  },
  button: {
    backgroundColor: ACCENT,
    borderRadius: 999,
    paddingVertical: 14,
    paddingHorizontal: 28,
    minWidth: 200,
    alignItems: 'center',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: TEXT_ON_ACCENT,
    fontSize: 16,
    fontWeight: '700',
  },
  error: {
    color: '#DC2626',
    fontSize: 13,
    textAlign: 'center',
  },
});
