import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabaseClient';

// Supabase's OAuth flow: ask for the provider's auth URL, open it in an
// in-app browser, then parse the access/refresh tokens Supabase appends to
// the redirect URL's fragment once Google hands control back to the app.
const REDIRECT_TO = Linking.createURL('auth-callback');

export async function signInWithGoogle(): Promise<void> {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: REDIRECT_TO, skipBrowserRedirect: true },
  });
  if (error != null || data.url == null) {
    throw new Error(error?.message ?? 'no auth url returned');
  }

  const result = await WebBrowser.openAuthSessionAsync(data.url, REDIRECT_TO);
  if (result.type !== 'success' || result.url == null) {
    throw new Error('google sign-in was cancelled');
  }

  // Tokens come back in the URL fragment (#access_token=...&refresh_token=...),
  // not query params — parse it by hand since URL doesn't treat '#' as a
  // delimiter for standard query parsing.
  const fragment = result.url.split('#')[1] ?? '';
  const params = new URLSearchParams(fragment);
  const access_token = params.get('access_token');
  const refresh_token = params.get('refresh_token');
  if (access_token == null || refresh_token == null) {
    throw new Error('redirect url missing tokens');
  }

  const { error: sessionError } = await supabase.auth.setSession({ access_token, refresh_token });
  if (sessionError != null) throw new Error(sessionError.message);
}

export async function signOut(): Promise<void> {
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
