import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

// The anon key is meant to be public/client-embedded per Supabase's design
// (access is enforced by the RLS policies in supabase/migrations, not by
// keeping this secret) — safe to commit.
const SUPABASE_URL = 'https://zgtytqapypwnhhxbjjur.supabase.co';
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpndHl0cWFweXB3bmhoeGJqanVyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY0OTc3MDcsImV4cCI6MjEwMjA3MzcwN30.xeigkYqNkbn6SSgrhXiq_OqwBKLyG3KRSOBs7iQgP7U';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: AsyncStorage,
    persistSession: true,
    autoRefreshToken: true,
    // RN has no browser URL to parse an auth redirect out of.
    detectSessionInUrl: false,
  },
});
