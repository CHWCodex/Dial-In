-- Leagues: private leaderboards for a group chat, office or family, joined with one invite link.
-- Members need a verified email (the same rule as every other leaderboard, since only they post scores).
create table if not exists public.leagues (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z2-9]{6}$'),
  name text not null check (char_length(name) between 1 and 24),
  owner uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create table if not exists public.league_members (
  league_id uuid not null references public.leagues(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (league_id, user_id)
);
create index if not exists league_members_user_idx on public.league_members (user_id);
alter table public.leagues enable row level security;
alter table public.league_members enable row level security;
-- No table policies: everything goes through the functions below.
revoke all on public.leagues, public.league_members from anon, authenticated;

create or replace function public.require_email() returns void language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_verified_email(auth.uid()) then raise exception 'Link your email to use leagues'; end if;
end $$;

-- Name and member count for an invite link, so the invite screen can say what you're joining
create or replace function public.league_preview(p_code text)
returns table(name text, members bigint, is_member boolean)
language sql stable security definer set search_path = public as $$
  select l.name, (select count(*) from public.league_members m where m.league_id = l.id),
         exists (select 1 from public.league_members m where m.league_id = l.id and m.user_id = auth.uid())
  from public.leagues l where l.code = upper(trim(p_code))
$$;

create or replace function public.create_league(p_name text)
returns table(code text, name text)
language plpgsql security definer set search_path = public as $$
declare n text := public.clean_name(p_name); c text; lid uuid; tries int := 0;
begin
  perform public.require_email();
  if n = '' then raise exception 'Give your league a name'; end if;
  if (select count(*) from public.leagues l where l.owner = auth.uid()) >= 10 then raise exception 'You can run up to 10 leagues'; end if;
  if (select count(*) from public.league_members m where m.user_id = auth.uid()) >= 20 then raise exception 'You can be in up to 20 leagues'; end if;
  perform public.ensure_profile(auth.uid());
  loop
    c := (select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + floor(random() * 32)::int, 1), '') from generate_series(1, 6));
    begin
      insert into public.leagues (code, name, owner) values (c, n, auth.uid()) returning id into lid; exit;
    exception when unique_violation then tries := tries + 1; if tries > 5 then raise; end if;
    end;
  end loop;
  insert into public.league_members (league_id, user_id) values (lid, auth.uid());
  return query select c, n;
end $$;

create or replace function public.join_league(p_code text)
returns table(code text, name text)
language plpgsql security definer set search_path = public as $$
declare l public.leagues;
begin
  perform public.require_email();
  select * into l from public.leagues where leagues.code = upper(trim(p_code));
  if not found then raise exception 'That league link doesn''t work. Ask for a new one.'; end if;
  if not exists (select 1 from public.league_members m where m.league_id = l.id and m.user_id = auth.uid()) then
    if (select count(*) from public.league_members m where m.user_id = auth.uid()) >= 20 then raise exception 'You can be in up to 20 leagues'; end if;
    if (select count(*) from public.league_members m where m.league_id = l.id) >= 100 then raise exception 'This league is full (100 players)'; end if;
    perform public.ensure_profile(auth.uid());
    insert into public.league_members (league_id, user_id) values (l.id, auth.uid());
  end if;
  return query select l.code, l.name;
end $$;

-- Leaving: the last member out (or the owner) closes the league for everyone
create or replace function public.leave_league(p_code text)
returns void language plpgsql security definer set search_path = public as $$
declare l public.leagues;
begin
  select * into l from public.leagues where leagues.code = upper(trim(p_code));
  if not found then return; end if;
  if l.owner = auth.uid() then delete from public.leagues where id = l.id; return; end if;
  delete from public.league_members where league_id = l.id and user_id = auth.uid();
end $$;

-- Your leagues, with your rank on today's board in each
create or replace function public.my_leagues(p_date date)
returns table(code text, name text, members bigint, is_owner boolean, played_today bigint, my_rank bigint)
language sql stable security definer set search_path = public as $$
  with mine as (select l.* from public.leagues l join public.league_members m on m.league_id = l.id and m.user_id = auth.uid()),
  today as (
    select m.league_id, d.user_id, rank() over (partition by m.league_id order by d.score desc, d.exact_count desc) rk
    from public.league_members m join mine on mine.id = m.league_id
    join public.daily_results d on d.user_id = m.user_id and d.puzzle_date = p_date
  )
  select mine.code, mine.name,
    (select count(*) from public.league_members m where m.league_id = mine.id),
    mine.owner = auth.uid(),
    (select count(*) from today t where t.league_id = mine.id),
    (select t.rk from today t where t.league_id = mine.id and t.user_id = auth.uid())
  from mine where public.has_verified_email(auth.uid())
  order by mine.created_at
$$;

-- A league's board: today's puzzle (p_date set) or all-time (p_date null). Members only.
create or replace function public.get_league_board(p_code text, p_date date)
returns table(rank bigint, player_id uuid, display_name text, score bigint, exact_count bigint, days_played bigint, supporter boolean)
language sql stable security definer set search_path = public as $$
  with l as (select id from public.leagues where code = upper(trim(p_code))),
  mem as (select m.user_id from public.league_members m join l on l.id = m.league_id),
  ok as (select 1 from mem where mem.user_id = auth.uid() and public.has_verified_email(auth.uid())),
  t as (
    select d.user_id, sum(d.score)::bigint score, sum(d.exact_count)::bigint ex, count(*)::bigint days
    from public.daily_results d join mem using (user_id)
    where (p_date is null or d.puzzle_date = p_date) and exists (select 1 from ok)
    group by d.user_id
  )
  select rank() over (order by t.score desc, t.ex desc), t.user_id, p.display_name, t.score, t.ex, t.days, (p.premium and p.show_badge)
  from t join public.profiles p using (user_id)
  order by 1, p.display_name
$$;

-- Members who haven't played today yet (so the board can nudge them), for members only
create or replace function public.league_waiting(p_code text, p_date date)
returns table(display_name text)
language sql stable security definer set search_path = public as $$
  with l as (select id from public.leagues where code = upper(trim(p_code)))
  select p.display_name from public.league_members m join l on l.id = m.league_id join public.profiles p using (user_id)
  where exists (select 1 from public.league_members me where me.league_id = m.league_id and me.user_id = auth.uid())
    and not exists (select 1 from public.daily_results d where d.user_id = m.user_id and d.puzzle_date = p_date)
  order by p.display_name
$$;

revoke all on function public.require_email() from public, anon, authenticated;
do $$ declare f text; begin
  foreach f in array array['league_preview(text)','create_league(text)','join_league(text)','leave_league(text)','my_leagues(date)','get_league_board(text, date)','league_waiting(text, date)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
