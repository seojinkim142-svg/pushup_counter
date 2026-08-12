import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import type { Session } from '@supabase/supabase-js';
import { subscribeToAuthState } from '../lib/auth';
import LoginScreen from './LoginScreen';
import { ACCENT } from './theme';

export default function AuthGate({ children }: { children: (session: Session) => React.ReactNode }) {
  // undefined: haven't heard from Supabase yet. null: heard, no session.
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => subscribeToAuthState(setSession), []);

  if (session === undefined) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={ACCENT} size="large" />
      </View>
    );
  }
  if (session == null) {
    return <LoginScreen />;
  }
  return <>{children(session)}</>;
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F0F9FF',
  },
});
