-- 대결모드 (versus mode): random-matchmaking PvP.
-- Apply via the Supabase Dashboard SQL Editor, or `npx supabase db push`
-- after `npx supabase login` + `npx supabase link`.

create extension if not exists pgcrypto;

create table matchmaking_queue (
  user_id uuid primary key references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now()
);

create table matches (
  id uuid primary key default gen_random_uuid(),
  player1_id uuid not null references auth.users(id),
  player2_id uuid not null references auth.users(id),
  status text not null default 'active' check (status in ('active', 'finished')),
  player1_count int not null default 0,
  player2_count int not null default 0,
  duration_sec int not null default 60,
  started_at timestamptz not null default now(),
  winner_id uuid,
  created_at timestamptz not null default now()
);

alter table matchmaking_queue enable row level security;
alter table matches enable row level security;

-- Everyone can only see/delete their own queue row directly — insertion into
-- someone else's row, or reading the whole queue, only ever happens inside
-- try_match() below (security definer, bypasses RLS).
create policy "own queue row select" on matchmaking_queue
  for select using (auth.uid() = user_id);
create policy "own queue row delete" on matchmaking_queue
  for delete using (auth.uid() = user_id);

-- Players can only see matches they're part of. There's no direct UPDATE
-- policy on purpose — count/status changes only happen through the RPCs
-- below, so a player can never touch the opponent's count column or finish
-- someone else's match.
create policy "own matches" on matches
  for select using (auth.uid() in (player1_id, player2_id));

-- Atomically pairs the caller with the oldest other waiting player. FOR
-- UPDATE SKIP LOCKED means two callers racing to match never both grab the
-- same opponent. Returns the new match id, or null if no one was waiting
-- (the caller is now the one waiting in the queue instead).
create or replace function try_match() returns uuid
language plpgsql security definer as $$
declare
  me uuid := auth.uid();
  opponent uuid;
  new_match_id uuid;
begin
  if me is null then
    raise exception 'not authenticated';
  end if;

  -- Clear any stale self-entry (e.g. a previous call that found no one)
  -- before looking for an opponent, so we never match against ourselves.
  delete from matchmaking_queue where user_id = me;

  select user_id into opponent
  from matchmaking_queue
  where user_id <> me
  order by joined_at
  limit 1
  for update skip locked;

  if opponent is null then
    insert into matchmaking_queue (user_id) values (me);
    return null;
  end if;

  delete from matchmaking_queue where user_id = opponent;

  insert into matches (player1_id, player2_id)
  values (me, opponent)
  returning id into new_match_id;

  return new_match_id;
end;
$$;

create or replace function cancel_matchmaking() returns void
language sql security definer as $$
  delete from matchmaking_queue where user_id = auth.uid();
$$;

-- Updates only the calling player's own count column, and only while the
-- match is still active — never the opponent's column, never a finished match.
create or replace function update_my_count(p_match_id uuid, p_count int) returns void
language plpgsql security definer as $$
declare
  me uuid := auth.uid();
begin
  update matches
  set
    player1_count = case when player1_id = me then p_count else player1_count end,
    player2_count = case when player2_id = me then p_count else player2_count end
  where id = p_match_id and status = 'active' and me in (player1_id, player2_id);
end;
$$;

-- Either player can call this once their local timer hits zero — idempotent
-- (a second call on an already-finished match is a no-op), so it's safe for
-- both sides to call it without coordinating who goes first.
create or replace function finish_match(p_match_id uuid) returns void
language plpgsql security definer as $$
declare
  m matches;
begin
  select * into m from matches where id = p_match_id;
  if m.id is null or m.status = 'finished' then
    return;
  end if;

  update matches
  set
    status = 'finished',
    winner_id = case
      when player1_count > player2_count then player1_id
      when player2_count > player1_count then player2_id
      else null
    end
  where id = p_match_id;
end;
$$;

-- Needed for the client's Realtime Postgres Changes subscription (live
-- opponent-count updates and match-found detection) to receive anything.
alter publication supabase_realtime add table matches;
