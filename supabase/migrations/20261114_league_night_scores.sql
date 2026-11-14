-- League Night: the online leaderboard (2026-11-14).
-- Shares the project's `players` table with Michael's other games, so a leaderboard name
-- claimed in any of them is the same name here, and a ban there stops posting here too.
--
--   ln_scores            one row per checked round. Nobody can insert directly: the
--                        ln-submit-score server function replays the round with the game's
--                        own code first, then calls ln_record_score with the service key.
--   ln_record_score()    stamps the player's name, holds back floods, stores the round.
--   ln_leaderboard()     each player's best round on a course and length, best first,
--                        all time or since a date.
--   ln_my_best()         one player's best and their place, for when they're off the top.
-- Safe to run again.

create table if not exists public.ln_scores (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users on delete set null,
  name text not null check (char_length(name) between 1 and 16),
  course text not null check (course in ('lantern-park', 'loon-lake', 'red-mesa')),
  holes int not null check (holes in (9, 18)),
  strokes int not null,
  par int not null check (par between holes * 2 and holes * 6),
  to_par int generated always as (strokes - par) stored,
  mode text not null check (mode in ('casual', 'cup', 'skins')),
  chaser text not null check (char_length(chaser) <= 20),
  mulligans int not null default 0 check (mulligans between 0 and 3),
  seed bigint not null,
  version text check (char_length(version) <= 20),
  created_at timestamptz not null default now(),
  constraint ln_scores_strokes_range check (strokes between holes and par + holes * 5),
  constraint ln_scores_once unique (user_id, seed)
);
create index if not exists ln_scores_board on public.ln_scores (course, holes, to_par, created_at);
create index if not exists ln_scores_user on public.ln_scores (user_id);
alter table public.ln_scores enable row level security;
revoke all on table public.ln_scores from anon, authenticated;
grant select (id, name, course, holes, strokes, par, to_par, mode, chaser, mulligans, created_at) on table public.ln_scores to anon, authenticated;
drop policy if exists "anyone can read" on public.ln_scores;
create policy "anyone can read" on public.ln_scores for select using (true);

-- Called only by the server function, after it has replayed the round.
create or replace function public.ln_record_score(
  p_user uuid, p_course text, p_holes int, p_strokes int, p_par int, p_mode text,
  p_chaser text, p_mulligans int, p_seed bigint, p_version text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  p public.players;
  better int;
begin
  select * into p from public.players where user_id = p_user;
  if not found then raise exception 'Pick a leaderboard name first.'; end if;
  if p.banned then raise exception 'This account can''t post scores.'; end if;
  if (select count(*) from public.ln_scores where created_at > now() - interval '1 minute') >= 30
    or (select count(*) from public.ln_scores where user_id = p_user and created_at > now() - interval '1 minute') >= 3 then
    raise exception 'Too many scores right now. Try again in a minute.';
  end if;
  if exists (select 1 from public.ln_scores where user_id = p_user and seed = p_seed) then
    raise exception 'This round is already on the board.';
  end if;
  insert into public.ln_scores (user_id, name, course, holes, strokes, par, mode, chaser, mulligans, seed, version)
  values (p_user, p.name, p_course, p_holes, p_strokes, p_par, p_mode, p_chaser, p_mulligans, p_seed, left(p_version, 20));
  -- Place among each player's best rounds on this board.
  select count(*) into better from (
    select min(to_par) as best from public.ln_scores
    where course = p_course and holes = p_holes and user_id is distinct from p_user
    group by coalesce(user_id::text, name)
  ) b where b.best < p_strokes - p_par;
  return jsonb_build_object('name', p.name, 'rank', better + 1, 'to_par', p_strokes - p_par);
end $$;
revoke all on function public.ln_record_score(uuid, text, int, int, int, text, text, int, bigint, text) from public, anon, authenticated;
grant execute on function public.ln_record_score(uuid, text, int, int, int, text, text, int, bigint, text) to service_role;

-- Each player's best round on one board, best first (ties: whoever got there first).
create or replace function public.ln_leaderboard(p_course text, p_holes int, p_since timestamptz default null, p_limit int default 20)
returns table (rank bigint, name text, strokes int, to_par int, chaser text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  with best as (
    select distinct on (coalesce(s.user_id::text, s.name)) s.name, s.strokes, s.to_par, s.chaser, s.created_at
    from public.ln_scores s
    left join public.players pl on pl.user_id = s.user_id
    where s.course = p_course and s.holes = p_holes
      and (p_since is null or s.created_at >= p_since)
      and not coalesce(pl.banned, false)
    order by coalesce(s.user_id::text, s.name), s.to_par, s.created_at
  )
  select rank() over (order by to_par), name, strokes, to_par, chaser, created_at
  from best order by to_par, created_at limit least(greatest(p_limit, 1), 50);
$$;
grant execute on function public.ln_leaderboard(text, int, timestamptz, int) to anon, authenticated;

-- The signed-in player's best on one board and its place.
create or replace function public.ln_my_best(p_course text, p_holes int, p_since timestamptz default null)
returns jsonb
language sql stable security definer set search_path = public as $$
  with mine as (
    select to_par, strokes from public.ln_scores
    where user_id = auth.uid() and course = p_course and holes = p_holes
      and (p_since is null or created_at >= p_since)
    order by to_par, created_at limit 1
  )
  select case when not exists (select 1 from mine) then null else jsonb_build_object(
    'strokes', (select strokes from mine),
    'to_par', (select to_par from mine),
    'rank', 1 + (select count(*) from (
      select min(s.to_par) as best from public.ln_scores s
      left join public.players pl on pl.user_id = s.user_id
      where s.course = p_course and s.holes = p_holes and s.user_id is distinct from auth.uid()
        and (p_since is null or s.created_at >= p_since) and not coalesce(pl.banned, false)
      group by coalesce(s.user_id::text, s.name)
    ) b where b.best < (select to_par from mine))
  ) end;
$$;
grant execute on function public.ln_my_best(text, int, timestamptz) to authenticated;

-- A rename in any game renames League Night scores too.
create or replace function public.players_rename_ln_scores() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.ln_scores set name = new.name where user_id = new.user_id;
  return new;
end $$;
revoke all on function public.players_rename_ln_scores() from public, anon, authenticated;
drop trigger if exists players_rename_ln_scores on public.players;
create trigger players_rename_ln_scores after update of name on public.players
  for each row execute function public.players_rename_ln_scores();
