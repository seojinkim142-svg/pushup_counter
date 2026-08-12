-- A client that starts matchmaking and then force-quits (rather than
-- pressing 취소) leaves its matchmaking_queue row behind forever — the next
-- real user's try_match() would instantly "match" against that permanent
-- ghost, who never sends any count updates. Sweeping stale rows before
-- picking an opponent keeps the queue self-cleaning without needing a
-- client-side heartbeat.
create or replace function try_match() returns uuid
language plpgsql security definer as $$
declare
  me uuid := auth.uid();
  opponent uuid;
  new_match_id uuid;
begin
  if me is null then raise exception 'not authenticated'; end if;
  delete from matchmaking_queue where user_id = me;
  delete from matchmaking_queue where joined_at < now() - interval '30 seconds';

  select user_id into opponent from matchmaking_queue
  where user_id <> me order by joined_at limit 1 for update skip locked;

  if opponent is null then
    insert into matchmaking_queue (user_id) values (me);
    return null;
  end if;

  delete from matchmaking_queue where user_id = opponent;
  insert into matches (player1_id, player2_id) values (me, opponent)
  returning id into new_match_id;
  return new_match_id;
end;
$$;
