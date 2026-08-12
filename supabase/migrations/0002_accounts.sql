-- Per-account progress storage for adventure/routine mode, now that Google
-- login provides real (non-anonymous) users. No profiles table needed —
-- display name/avatar come straight from session.user.user_metadata.

create table adventure_cleared_stages (
  user_id uuid not null references auth.users(id) on delete cascade,
  stage_id text not null,
  cleared_at timestamptz not null default now(),
  primary key (user_id, stage_id)
);
alter table adventure_cleared_stages enable row level security;
create policy "own cleared stages" on adventure_cleared_stages
  for select using (auth.uid() = user_id);
create policy "insert own cleared stage" on adventure_cleared_stages
  for insert with check (auth.uid() = user_id);

create table routine_progress (
  user_id uuid primary key references auth.users(id) on delete cascade,
  baseline int not null,
  track int not null,
  week int not null,
  day int not null,
  updated_at timestamptz not null default now()
);
alter table routine_progress enable row level security;
create policy "own routine progress" on routine_progress
  for select using (auth.uid() = user_id);
create policy "upsert own routine progress" on routine_progress
  for insert with check (auth.uid() = user_id);
create policy "update own routine progress" on routine_progress
  for update using (auth.uid() = user_id);
create policy "delete own routine progress" on routine_progress
  for delete using (auth.uid() = user_id);
