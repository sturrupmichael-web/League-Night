-- League Night: async friend matches.
-- Every table is prefixed ln_ so it can live next to other apps in the same project.
-- Clients never write ln_matches directly: they call the ln_* functions below.
-- Throws are checked by a trigger: player in the match, match active, seq strictly increasing,
-- holes in order, and (without play-ahead) at most one hole ahead of the opponent.

create table public.ln_players (
  id uuid primary key references auth.users (id) on delete cascade default auth.uid(),
  name text not null check (char_length(name) between 1 and 16),
  created_at timestamptz not null default now()
);

create table public.ln_matches (
  id uuid primary key default gen_random_uuid(),
  code text not null check (code ~ '^[A-Z2-9]{6}$'),
  host uuid not null references auth.users (id) on delete cascade,
  guest uuid references auth.users (id) on delete cascade,
  host_meta jsonb not null,
  guest_meta jsonb,
  seed bigint not null check (seed >= 0 and seed < 4294967296),
  settings jsonb not null,
  status text not null default 'waiting' check (status in ('waiting', 'active', 'done', 'conceded')),
  conceded_by uuid,
  rematch_of uuid references public.ln_matches (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index ln_matches_open_code on public.ln_matches (code) where status = 'waiting';
create index ln_matches_host on public.ln_matches (host);
create index ln_matches_guest on public.ln_matches (guest);
create index ln_matches_rematch_of on public.ln_matches (rematch_of);

create table public.ln_throws (
  match_id uuid not null references public.ln_matches (id) on delete cascade,
  player_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
  hole int not null check (hole >= 0 and hole < 18),
  seq int not null check (seq >= 1),
  payload jsonb not null check (octet_length(payload::text) <= 4000),
  created_at timestamptz not null default now(),
  primary key (match_id, player_id, seq)
);
create index ln_throws_player on public.ln_throws (player_id);

create table public.ln_messages (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.ln_matches (id) on delete cascade,
  player_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
  body text not null check (char_length(body) between 1 and 60),
  created_at timestamptz not null default now()
);
create index ln_messages_match on public.ln_messages (match_id);
create index ln_messages_player on public.ln_messages (player_id);

alter table public.ln_players enable row level security;
alter table public.ln_matches enable row level security;
alter table public.ln_throws enable row level security;
alter table public.ln_messages enable row level security;

-- Is the current user in this match?
create function public.ln_in_match(m uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.ln_matches x where x.id = m and (select auth.uid()) in (x.host, x.guest));
$$;

create policy ln_players_own on public.ln_players for all to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy ln_matches_read on public.ln_matches for select to authenticated
  using ((select auth.uid()) in (host, guest));

create policy ln_throws_read on public.ln_throws for select to authenticated
  using (public.ln_in_match(match_id));
create policy ln_throws_insert on public.ln_throws for insert to authenticated
  with check (player_id = (select auth.uid()) and public.ln_in_match(match_id));

create policy ln_messages_read on public.ln_messages for select to authenticated
  using (public.ln_in_match(match_id));
create policy ln_messages_insert on public.ln_messages for insert to authenticated
  with check (player_id = (select auth.uid()) and public.ln_in_match(match_id));

-- Turn checks on every throw.
create function public.ln_check_throw() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  m public.ln_matches;
  opp uuid;
  last_seq int;
  my_done int;
  opp_done int;
begin
  select * into m from public.ln_matches where id = new.match_id for update;
  if m.id is null then raise exception 'match not found'; end if;
  if new.player_id is distinct from (select auth.uid()) then raise exception 'not your throw'; end if;
  if new.player_id not in (m.host, m.guest) then raise exception 'not in this match'; end if;
  if m.status <> 'active' then raise exception 'match is not active'; end if;
  select coalesce(max(seq), 0) into last_seq from public.ln_throws where match_id = new.match_id and player_id = new.player_id;
  if new.seq <> last_seq + 1 then raise exception 'seq must be %', last_seq + 1; end if;
  select count(*) into my_done from public.ln_throws where match_id = new.match_id and player_id = new.player_id and payload->>'kind' = 'done';
  if new.hole <> my_done then raise exception 'you are on hole %', my_done; end if;
  if new.hole >= (m.settings->>'length')::int then raise exception 'card is complete'; end if;
  opp := case when new.player_id = m.host then m.guest else m.host end;
  select count(*) into opp_done from public.ln_throws where match_id = new.match_id and player_id = opp and payload->>'kind' = 'done';
  if not coalesce((m.settings->>'playAhead')::boolean, false) and my_done > opp_done then raise exception 'wait for your friend'; end if;
  return new;
end $$;

create trigger ln_throws_check before insert on public.ln_throws
  for each row execute function public.ln_check_throw();

-- Close the match when both cards are in.
create function public.ln_after_throw() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  m public.ln_matches;
  host_done int;
  guest_done int;
begin
  select * into m from public.ln_matches where id = new.match_id;
  select count(*) into host_done from public.ln_throws where match_id = m.id and player_id = m.host and payload->>'kind' = 'done';
  select count(*) into guest_done from public.ln_throws where match_id = m.id and player_id = m.guest and payload->>'kind' = 'done';
  update public.ln_matches
    set updated_at = now(),
        status = case when host_done >= (m.settings->>'length')::int and guest_done >= (m.settings->>'length')::int then 'done' else status end
    where id = m.id;
  return null;
end $$;

create trigger ln_throws_after after insert on public.ln_throws
  for each row execute function public.ln_after_throw();

-- Match actions.
create function public.ln_new_code() returns text
language plpgsql volatile set search_path = '' as $$
declare
  a text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  c text;
begin
  loop
    c := '';
    for i in 1..6 loop c := c || substr(a, 1 + floor(random() * 32)::int, 1); end loop;
    exit when not exists (select 1 from public.ln_matches where code = c and status = 'waiting');
  end loop;
  return c;
end $$;

create function public.ln_create_match(p_settings jsonb, p_meta jsonb, p_seed bigint) returns public.ln_matches
language plpgsql security definer set search_path = '' as $$
declare r public.ln_matches;
begin
  if (select auth.uid()) is null then raise exception 'sign in first'; end if;
  if (p_settings->>'length')::int not in (3, 9, 18) then raise exception 'bad length'; end if;
  insert into public.ln_matches (code, host, host_meta, seed, settings)
    values (public.ln_new_code(), (select auth.uid()), p_meta, p_seed, p_settings)
    returning * into r;
  return r;
end $$;

create function public.ln_join_match(p_code text, p_meta jsonb) returns public.ln_matches
language plpgsql security definer set search_path = '' as $$
declare r public.ln_matches;
begin
  select * into r from public.ln_matches where code = upper(p_code) and status = 'waiting' for update;
  if r.id is null then raise exception 'NO OPEN MATCH WITH THAT CODE'; end if;
  if r.host = (select auth.uid()) then raise exception 'THAT IS YOUR OWN MATCH'; end if;
  update public.ln_matches set guest = (select auth.uid()), guest_meta = p_meta, status = 'active', updated_at = now()
    where id = r.id returning * into r;
  return r;
end $$;

create function public.ln_concede(p_match uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.ln_matches set status = 'conceded', conceded_by = (select auth.uid()), updated_at = now()
    where id = p_match and (select auth.uid()) in (host, guest) and status in ('waiting', 'active');
end $$;

create function public.ln_rematch(p_match uuid, p_meta jsonb, p_seed bigint) returns public.ln_matches
language plpgsql security definer set search_path = '' as $$
declare
  o public.ln_matches;
  r public.ln_matches;
  me uuid := (select auth.uid());
begin
  select * into o from public.ln_matches where id = p_match and me in (host, guest);
  if o.id is null or o.guest is null then raise exception 'MATCH NOT FOUND'; end if;
  insert into public.ln_matches (code, host, guest, host_meta, guest_meta, seed, settings, status, rematch_of)
    values (public.ln_new_code(), me, case when o.host = me then o.guest else o.host end, p_meta,
            case when o.host = me then o.guest_meta else o.host_meta end, p_seed, o.settings, 'active', o.id)
    returning * into r;
  return r;
end $$;

revoke all on function public.ln_check_throw() from public, anon, authenticated;
revoke all on function public.ln_after_throw() from public, anon, authenticated;
revoke all on function public.ln_new_code() from public, anon, authenticated;
revoke all on function public.ln_create_match(jsonb, jsonb, bigint) from public, anon;
revoke all on function public.ln_join_match(text, jsonb) from public, anon;
revoke all on function public.ln_concede(uuid) from public, anon;
revoke all on function public.ln_rematch(uuid, jsonb, bigint) from public, anon;
revoke all on function public.ln_in_match(uuid) from public, anon;
grant execute on function public.ln_create_match(jsonb, jsonb, bigint) to authenticated;
grant execute on function public.ln_join_match(text, jsonb) to authenticated;
grant execute on function public.ln_concede(uuid) to authenticated;
grant execute on function public.ln_rematch(uuid, jsonb, bigint) to authenticated;
grant execute on function public.ln_in_match(uuid) to authenticated;

-- "Your turn" updates.
alter publication supabase_realtime add table public.ln_matches, public.ln_throws, public.ln_messages;
