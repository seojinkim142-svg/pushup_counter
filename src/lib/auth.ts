import { GoogleSignin } from '@react-native-google-signin/google-signin';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabaseClient';

// Web client ID — same one already registered as the Google provider's
// Client ID in the Supabase dashboard. GoogleSignin needs it to request an
// idToken whose audience Supabase will accept; it does NOT need the
// Android client's ID (that one only ties the SHA-1/package name to this
// app so Google allows the native sign-in sheet at all).
const WEB_CLIENT_ID = '658006812029-007acjscq5nv81rl4mth49n69uvi36u8.apps.googleusercontent.com';

GoogleSignin.configure({ webClientId: WEB_CLIENT_ID });

export async function signInWithGoogle(): Promise<void> {
  await GoogleSignin.hasPlayServices();
  const result = await GoogleSignin.signIn();
  const idToken = result.data?.idToken;
  if (idToken == null) {
    throw new Error('Google sign-in returned no idToken');
  }

  const { error } = await supabase.auth.signInWithIdToken({ provider: 'google', token: idToken });
  if (error != null) throw new Error(error.message);
}

export async function signOut(): Promise<void> {
  // Also sign out of the native Google session — otherwise the next sign-in
  // silently reuses the last account instead of showing the picker.
  await GoogleSignin.signOut();
  await supabase.auth.signOut();
}

/** Fires immediately with the current session, then again on every change (sign-in/out/refresh). */
export function subscribeToAuthState(onChange: (session: Session | null) => void): () => void {
  // A network failure here (e.g. device briefly offline) must still resolve
  // to "no session" rather than leaving AuthGate's loading state stuck
  // forever — the login screen it falls back to has no offline mode either,
  // but at least it's not an infinite spinner with no way forward.
  supabase.auth
    .getSession()
    .then(({ data }) => onChange(data.session))
    .catch((e) => {
      console.warn('getSession failed', e);
      onChange(null);
    });
  const {
    data: { subscription },
  } = supabase.auth.onAuthStateChange((_event, session) => onChange(session));
  return () => subscription.unsubscribe();
}
