import { supabase } from './supabaseClient';

export type VersusMatch = {
  id: string;
  player1_id: string;
  player2_id: string;
  status: 'active' | 'finished';
  player1_count: number;
  player2_count: number;
  duration_sec: number;
  started_at: string;
  winner_id: string | null;
};

/**
 * Returns the current user's id and display name — AuthGate guarantees a
 * real (Google) session exists by the time any versus-mode screen is
 * reachable, so this just reads it rather than signing in.
 */
export async function getCurrentPlayer(): Promise<{ id: string; name: string }> {
  const { data, error } = await supabase.auth.getUser();
  if (error != null || data.user == null) {
    throw new Error(error?.message ?? 'no authenticated user');
  }
  const name = (data.user.user_metadata?.full_name as string | undefined) ?? '상대';
  return { id: data.user.id, name };
}

/**
 * Atomically pairs with the oldest other waiting player (see try_match() in
 * supabase/migrations) — returns the new match id immediately if someone was
 * already waiting, or null if the caller is now the one waiting (use
 * subscribeToIncomingMatch to find out when someone else matches them).
 */
export async function startMatchmaking(): Promise<string | null> {
  const { data, error } = await supabase.rpc('try_match');
  if (error != null) throw new Error(error.message);
  return (data as string | null) ?? null;
}

export async function cancelMatchmaking(): Promise<void> {
  const { error } = await supabase.rpc('cancel_matchmaking');
  if (error != null) console.warn('cancelMatchmaking failed', error.message);
}

export async function getMatch(matchId: string): Promise<VersusMatch | null> {
  const { data, error } = await supabase.from('matches').select('*').eq('id', matchId).single();
  if (error != null) {
    console.warn('getMatch failed', error.message);
    return null;
  }
  return data as VersusMatch;
}

/** Live updates (count/status changes) for a match already in progress. */
export function subscribeToMatch(matchId: string, onUpdate: (match: VersusMatch) => void): () => void {
  const channel = supabase
    .channel(`match-${matchId}`)
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'matches', filter: `id=eq.${matchId}` },
      (payload) => onUpdate(payload.new as VersusMatch)
    )
    .subscribe();
  return () => {
    supabase.removeChannel(channel);
  };
}

/**
 * While waiting in the queue: fires once another player's try_match() call
 * pairs them with us — two separate filters since Realtime can't express
 * "player1_id = me OR player2_id = me" in one subscription.
 */
export function subscribeToIncomingMatch(myUserId: string, onMatched: (matchId: string) => void): () => void {
  const channel = supabase
    .channel(`incoming-match-${myUserId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'matches', filter: `player1_id=eq.${myUserId}` },
      (payload) => onMatched((payload.new as VersusMatch).id)
    )
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'matches', filter: `player2_id=eq.${myUserId}` },
      (payload) => onMatched((payload.new as VersusMatch).id)
    )
    .subscribe();
  return () => {
    supabase.removeChannel(channel);
  };
}

export async function updateMyCount(matchId: string, count: number): Promise<void> {
  const { error } = await supabase.rpc('update_my_count', { p_match_id: matchId, p_count: count });
  if (error != null) console.warn('updateMyCount failed', error.message);
}

export async function finishMatch(matchId: string): Promise<void> {
  const { error } = await supabase.rpc('finish_match', { p_match_id: matchId });
  if (error != null) console.warn('finishMatch failed', error.message);
}
