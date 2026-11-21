-- Accounts without email.
-- Players save their account with a username and a 6-digit PIN (checked here, with a lockout), get a
-- one-time recovery code, and can add another device with a short code. Each account's sign-in address is an
-- internal one (u-<id>@accounts.playdialin.com) that never receives mail, so no real email is needed or kept.
-- Existing email accounts keep the same player ID (and so every score, save, league and purchase) when they
-- move over; real emails are removed on the cut-off date.
-- Also: public boards list established players only (3+ days played), a same-network check stops the
-- "practise in a private window first" trick, streaks on the boards, in-game delete and export.

-- ---------- private settings (service role only) ----------
create table if not exists public.acct_config (
  id int primary key default 1 check (id = 1),
  pepper text not null,                 -- signs each account's internal password
  cron_secret text not null,            -- the clean-up job sends this to the account function
  email_cutoff date not null            -- real emails are removed from this day
);
alter table public.acct_config enable row level security;
revoke all on public.acct_config from public, anon, authenticated;
insert into public.acct_config (pepper, cron_secret, email_cutoff)
values (encode(extensions.gen_random_bytes(32), 'hex'), encode(extensions.gen_random_bytes(24), 'hex'), date '2026-12-05')
on conflict (id) do nothing;

-- ---------- accounts ----------
create table if not exists public.pin_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username text not null check (username ~ '^[a-z0-9_]{3,16}$'),
  pin_hash text not null,
  recovery_hash text not null,
  fails int not null default 0,
  lock_level int not null default 0,
  locked_until timestamptz,
  created_at timestamptz not null default now(),
  pin_changed_at timestamptz not null default now()
);
create unique index if not exists pin_accounts_username on public.pin_accounts (username);
alter table public.pin_accounts enable row level security;
revoke all on public.pin_accounts from public, anon, authenticated;

create table if not exists public.device_codes (
  code_hash text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null,
  used_at timestamptz
);
alter table public.device_codes enable row level security;
revoke all on public.device_codes from public, anon, authenticated;

-- ---------- network tags: a salted hash of the connection, salt changes daily, everything deleted after 48 hours ----------
create table if not exists public.net_salts (day date primary key, salt text not null);
create table if not exists public.net_events (net text not null, kind text not null, at timestamptz not null default now());
create index if not exists net_events_lookup on public.net_events (net, kind, at);
create table if not exists public.net_plays (
  net text not null, puzzle_date date not null, user_id uuid not null references auth.users(id) on delete cascade,
  member boolean not null, at timestamptz not null default now(),
  primary key (net, puzzle_date, user_id)
);
alter table public.net_salts enable row level security;
alter table public.net_events enable row level security;
alter table public.net_plays enable row level security;
revoke all on public.net_salts, public.net_events, public.net_plays from public, anon, authenticated;

alter table public.daily_results add column if not exists off_board boolean not null default false;

create or replace function public.net_tag(p_ip text default null) returns text
language plpgsql security definer set search_path = '' as $$
declare
  h jsonb := coalesce(nullif(current_setting('request.headers', true), '')::jsonb, '{}'::jsonb);
  ip text := nullif(trim(split_part(coalesce(p_ip, h->>'cf-connecting-ip', h->>'x-forwarded-for', ''), ',', 1)), '');
  s text;
begin
  if ip is null then return null; end if;
  insert into public.net_salts (day, salt) values (public.uk_today(), encode(extensions.gen_random_bytes(16), 'hex')) on conflict (day) do nothing;
  select salt into s from public.net_salts where day = public.uk_today();
  return encode(extensions.digest(s || '|' || ip, 'sha256'), 'hex');
end $$;
revoke all on function public.net_tag(text) from public, anon, authenticated;

-- ---------- who counts ----------
-- A member has saved an account (username and PIN), or, until the cut-off, still has a verified email.
create or replace function public.is_member(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_user is not null and (
    exists (select 1 from public.pin_accounts a where a.user_id = p_user)
    or (public.uk_today() < (select c.email_cutoff from public.acct_config c where c.id = 1)
        and exists (select 1 from auth.users u where u.id = p_user and u.email is not null and u.email_confirmed_at is not null
                    and not coalesce(u.is_anonymous, false) and u.email not like '%@accounts.playdialin.com')))
$$;
-- Public boards list members who have played on at least 3 days (a throwaway account can't top them)
create or replace function public.is_listed(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_member(p_user) and (select count(*) from public.daily_results d where d.user_id = p_user) >= 3
$$;
-- Current daily streak, from official results (ends today or yesterday)
create or replace function public.streak_of(p_user uuid) returns int
language sql stable security definer set search_path = '' as $$
  with d as (select puzzle_date from public.daily_results where user_id = p_user and puzzle_date <= public.uk_today()),
  g as (select puzzle_date, puzzle_date - (row_number() over (order by puzzle_date))::int as grp from d),
  runs as (select max(puzzle_date) as last_day, count(*)::int as len from g group by grp)
  select coalesce((select len from runs where last_day >= public.uk_today() - 1 order by last_day desc limit 1), 0)
$$;
revoke all on function public.is_member(uuid), public.is_listed(uuid), public.streak_of(uuid) from public, anon, authenticated;

-- Leagues used to need an email; the old guard now means "is a member"
create or replace function public.require_email() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_member(auth.uid()) then raise exception 'Save your account to use this'; end if;
end $$;

-- ---------- the same-network check ----------
-- Called when anyone starts today's daily. A guest who started it on this connection earlier today means a
-- member's later score from the same connection stays off the public Daily board (it still counts everywhere else).
create or replace function public.note_play(p_date date) returns void
language plpgsql security definer set search_path = '' as $$
declare n text := public.net_tag();
begin
  if auth.uid() is null or n is null or p_date is distinct from public.uk_today() then return; end if;
  insert into public.net_plays (net, puzzle_date, user_id, member) values (n, p_date, auth.uid(), public.is_member(auth.uid()))
  on conflict (net, puzzle_date, user_id) do nothing;
end $$;
revoke all on function public.note_play(date) from public, anon;
grant execute on function public.note_play(date) to authenticated;

create or replace function public.submit_result(p_date date, p_question_ids text[], p_guesses numeric[], p_bonus integer)
returns table(score integer, exact_count integer)
language plpgsql security definer set search_path = '' as $$
declare
  s public.daily_sets;
  q public.questions;
  pts int[] := '{}';
  total int := 0;
  ex int := 0;
  balls int := 0;
  bonus int;
  i int;
  n text;
  off boolean := false;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  perform public.ensure_profile(auth.uid());
  if p_date > public.uk_today() or p_date < public.uk_today() - 1 then
    raise exception 'Results can only be posted for today''s puzzle';
  end if;
  select * into s from public.daily_sets where puzzle_date = p_date;
  if not found then raise exception 'No puzzle is set up for % (run supabase/seed.sql)', p_date; end if;
  if p_question_ids is distinct from s.question_ids then raise exception 'Those aren''t the questions for that day'; end if;
  if coalesce(array_length(p_guesses, 1), 0) <> 7 then raise exception 'Expected 7 answers'; end if;
  if exists (select 1 from public.daily_results r where r.user_id = auth.uid() and r.puzzle_date = p_date) then
    raise exception 'Result already submitted for this day';
  end if;
  for i in 1..7 loop
    select * into q from public.questions where id = s.question_ids[i];
    if not found then raise exception 'Question % is missing (run supabase/seed.sql)', s.question_ids[i]; end if;
    pts := pts || public.score_guess(q, p_guesses[i]);
    total := total + pts[i];
    balls := balls + public.balls_for_points(pts[i]);
    if pts[i] = 1000 then ex := ex + 1; end if;
  end loop;
  bonus := least(greatest(coalesce(p_bonus, 0), 0), balls * 400);
  n := public.net_tag();
  if n is not null then
    if public.is_member(auth.uid()) then
      off := exists (select 1 from public.net_plays p where p.net = n and p.puzzle_date = p_date and not p.member and p.user_id <> auth.uid());
    end if;
    insert into public.net_plays (net, puzzle_date, user_id, member) values (n, p_date, auth.uid(), public.is_member(auth.uid()))
    on conflict (net, puzzle_date, user_id) do nothing;
  end if;
  insert into public.daily_results (user_id, puzzle_date, score, exact_count, guesses, points, bonus, off_board)
  values (auth.uid(), p_date, total + bonus, ex, p_guesses, pts, bonus, off);
  return query select total + bonus, ex;
end $$;
-- the old 3-argument version (from before Dial Ball) is no longer used
drop function if exists public.submit_result(date, text[], numeric[]);

-- ---------- leaderboards (now with streaks) ----------
drop function if exists public.get_daily_leaderboard(date, integer);
create function public.get_daily_leaderboard(p_date date, p_limit integer)
returns table(rank bigint, player_id uuid, display_name text, score integer, exact_count integer, supporter boolean, streak integer)
language sql stable security definer set search_path = '' as $$
  with r as (
    select d.user_id, p.display_name, d.score, d.exact_count, d.submitted_at, (p.premium and p.show_badge) as sup,
           rank() over (order by d.score desc, d.exact_count desc) as rk
    from public.daily_results d join public.profiles p using (user_id)
    where d.puzzle_date = p_date and not d.off_board and public.is_listed(d.user_id)
  )
  select rk, user_id, display_name, score, exact_count, sup, public.streak_of(user_id) from r
  where public.is_member(auth.uid())
    and (rk <= least(greatest(coalesce(p_limit, 50), 1), 100) or user_id = auth.uid())
  order by rk, submitted_at
$$;

drop function if exists public.get_alltime_leaderboard(integer);
create function public.get_alltime_leaderboard(p_limit integer)
returns table(rank bigint, player_id uuid, display_name text, total_score bigint, days_played bigint, exact_total bigint, supporter boolean, streak integer)
language sql stable security definer set search_path = '' as $$
  with t as (
    select d.user_id, sum(d.score)::bigint as total_score, count(*)::bigint as days_played, sum(d.exact_count)::bigint as exact_total
    from public.daily_results d group by d.user_id having count(*) >= 3
  ), r as (
    select t.*, p.display_name, (p.premium and p.show_badge) as sup, rank() over (order by t.total_score desc, t.exact_total desc) as rk
    from t join public.profiles p using (user_id) where public.is_member(t.user_id)
  )
  select rk, user_id, display_name, total_score, days_played, exact_total, sup, public.streak_of(user_id) from r
  where public.is_member(auth.uid())
    and (rk <= least(greatest(coalesce(p_limit, 50), 1), 100) or user_id = auth.uid())
  order by rk
$$;

drop function if exists public.get_friends_leaderboard(date, text[]);
create function public.get_friends_leaderboard(p_date date, p_codes text[])
returns table(rank bigint, player_id uuid, display_name text, score integer, exact_count integer, supporter boolean, streak integer)
language sql stable security definer set search_path = '' as $$
  with r as (
    select d.user_id, p.display_name, d.score, d.exact_count, d.submitted_at, (p.premium and p.show_badge) as sup,
           rank() over (order by d.score desc, d.exact_count desc) as rk
    from public.daily_results d join public.profiles p using (user_id)
    where d.puzzle_date = p_date and public.is_member(d.user_id)
      and (p.user_id = auth.uid() or p.friend_code = any ((coalesce(p_codes, '{}'::text[]))[1:100]))
  )
  select rk, user_id, display_name, score, exact_count, sup, public.streak_of(user_id) from r
  where public.is_member(auth.uid())
  order by rk, submitted_at
$$;

drop function if exists public.get_friends_alltime_leaderboard(text[]);
create function public.get_friends_alltime_leaderboard(p_codes text[])
returns table(rank bigint, player_id uuid, display_name text, total_score bigint, days_played bigint, exact_total bigint, supporter boolean, streak integer)
language sql stable security definer set search_path = '' as $$
  with f as (
    select p.user_id, p.display_name, (p.premium and p.show_badge) as sup from public.profiles p
    where (p.user_id = auth.uid() or p.friend_code = any ((coalesce(p_codes, '{}'::text[]))[1:100]))
      and public.is_member(p.user_id)
  ), t as (
    select d.user_id, sum(d.score)::bigint as total_score, count(*)::bigint as days_played, sum(d.exact_count)::bigint as exact_total
    from public.daily_results d where d.user_id in (select user_id from f) group by d.user_id
  ), r as (
    select t.*, f.display_name, f.sup, rank() over (order by t.total_score desc, t.exact_total desc) as rk
    from t join f using (user_id)
  )
  select rk, user_id, display_name, total_score, days_played, exact_total, sup, public.streak_of(user_id) from r
  where public.is_member(auth.uid())
  order by rk, display_name
$$;

-- Longest current daily streaks among listed players
create or replace function public.get_streak_leaderboard(p_limit integer)
returns table(rank bigint, player_id uuid, display_name text, streak integer, days_played bigint, supporter boolean)
language sql stable security definer set search_path = '' as $$
  with u as (
    select d.user_id, count(*)::bigint as days_played from public.daily_results d
    where d.user_id in (select d2.user_id from public.daily_results d2 where d2.puzzle_date >= public.uk_today() - 1)
    group by d.user_id having count(*) >= 3
  ), s as (
    select u.user_id, u.days_played, public.streak_of(u.user_id) as streak from u where public.is_member(u.user_id)
  ), r as (
    select s.*, p.display_name, (p.premium and p.show_badge) as sup, rank() over (order by s.streak desc, s.days_played desc) as rk
    from s join public.profiles p using (user_id) where s.streak >= 2
  )
  select rk, user_id, display_name, streak, days_played, sup from r
  where public.is_member(auth.uid())
    and (rk <= least(greatest(coalesce(p_limit, 50), 1), 100) or user_id = auth.uid())
  order by rk, display_name
$$;

create or replace function public.get_daily_rank(p_date date)
returns table(players integer, my_rank integer, beaten integer, my_score integer, buckets integer[])
language plpgsql stable security definer set search_path = '' as $$
declare
  mine int;
begin
  if not public.is_member(auth.uid()) then return; end if;
  select r.score into mine from public.daily_results r where r.puzzle_date = p_date and r.user_id = auth.uid();
  return query
  select count(*)::int,
         case when mine is null then null else (count(*) filter (where d.score > mine) + 1)::int end,
         case when mine is null then 0 else (count(*) filter (where d.score < mine))::int end,
         mine,
         (select array_agg(coalesce(x.c, 0) order by g.b)
            from generate_series(0, 14) as g(b)
            left join (select least(r2.score / 500, 14) as bk, count(*)::int as c
                       from public.daily_results r2
                       where r2.puzzle_date = p_date and not r2.off_board and public.is_listed(r2.user_id) group by 1) x on x.bk = g.b)
  from public.daily_results d where d.puzzle_date = p_date and not d.off_board and public.is_listed(d.user_id);
end $$;

create or replace function public.peek_daily_rank(p_date date, p_score integer)
returns table(players integer, would_rank integer)
language sql stable security definer set search_path = '' as $$
  select count(*)::int, (count(*) filter (where d.score > least(greatest(coalesce(p_score, 0), 0), 15400)) + 1)::int
  from public.daily_results d
  where d.puzzle_date = p_date and p_date between public.uk_today() - 1 and public.uk_today()
    and not d.off_board and public.is_listed(d.user_id)
$$;

-- Why am I (not) on the public board today?
create or replace function public.my_board_status(p_date date)
returns table(member boolean, username text, days_played integer, listed boolean, off_board boolean, streak integer, email_until date)
language sql stable security definer set search_path = '' as $$
  select public.is_member(auth.uid()),
         (select a.username from public.pin_accounts a where a.user_id = auth.uid()),
         (select count(*)::int from public.daily_results d where d.user_id = auth.uid()),
         public.is_listed(auth.uid()),
         coalesce((select d.off_board from public.daily_results d where d.user_id = auth.uid() and d.puzzle_date = p_date), false),
         public.streak_of(auth.uid()),
         (select c.email_cutoff from public.acct_config c where c.id = 1)
$$;

revoke all on function public.get_daily_leaderboard(date, integer), public.get_alltime_leaderboard(integer),
  public.get_friends_leaderboard(date, text[]), public.get_friends_alltime_leaderboard(text[]), public.get_streak_leaderboard(integer),
  public.get_daily_rank(date), public.peek_daily_rank(date, integer), public.my_board_status(date),
  public.submit_result(date, text[], numeric[], integer) from public, anon;
grant execute on function public.get_daily_leaderboard(date, integer), public.get_alltime_leaderboard(integer),
  public.get_friends_leaderboard(date, text[]), public.get_friends_alltime_leaderboard(text[]), public.get_streak_leaderboard(integer),
  public.get_daily_rank(date), public.peek_daily_rank(date, integer), public.my_board_status(date),
  public.submit_result(date, text[], numeric[], integer) to authenticated;

-- ---------- account functions used only by the account edge function (service role) ----------
create or replace function public.acct_rate(p_ip text, p_kind text, p_max int, p_window interval) returns boolean
language plpgsql security definer set search_path = '' as $$
declare n text := public.net_tag(p_ip);
begin
  if n is null then return true; end if;
  if (select count(*) from public.net_events e where e.net = n and e.kind = p_kind and e.at > now() - p_window) >= p_max then return false; end if;
  insert into public.net_events (net, kind) values (n, p_kind);
  return true;
end $$;

create or replace function public.acct_new_code() returns text language sql volatile set search_path = '' as $$
  select string_agg(substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789', 1 + (get_byte(b, i) % 31), 1), '' order by i)
  from (select extensions.gen_random_bytes(12) as b) x, generate_series(0, 11) as i
$$;

create or replace function public.acct_create(p_user uuid, p_username text, p_pin text) returns text
language plpgsql security definer set search_path = '' as $$
declare code text := public.acct_new_code();
begin
  insert into public.pin_accounts (user_id, username, pin_hash, recovery_hash)
  values (p_user, p_username, extensions.crypt(p_pin, extensions.gen_salt('bf', 8)), extensions.crypt(code, extensions.gen_salt('bf', 8)));
  return code;
end $$;

-- Checks a PIN (p_kind 'pin') or recovery code ('code'). Returns user_id on success. Five wrong tries locks the
-- account for 15 minutes, doubling each time it happens again (up to a day).
create or replace function public.acct_check(p_username text, p_secret text, p_kind text)
returns table(user_id uuid, status text, wait_seconds int)
language plpgsql security definer set search_path = '' as $$
declare a public.pin_accounts; ok boolean;
begin
  select * into a from public.pin_accounts x where x.username = lower(trim(p_username)) for update;
  if not found then
    perform extensions.crypt('x', extensions.gen_salt('bf', 8));   -- same work either way
    return query select null::uuid, 'wrong', 0; return;
  end if;
  if a.locked_until is not null and a.locked_until > now() then
    return query select null::uuid, 'locked', ceil(extract(epoch from a.locked_until - now()))::int; return;
  end if;
  ok := case when p_kind = 'code' then a.recovery_hash = extensions.crypt(upper(regexp_replace(p_secret, '[^A-Za-z0-9]', '', 'g')), a.recovery_hash)
             else a.pin_hash = extensions.crypt(p_secret, a.pin_hash) end;
  if ok then
    update public.pin_accounts x set fails = 0, lock_level = greatest(x.lock_level - 1, 0), locked_until = null where x.user_id = a.user_id;
    return query select a.user_id, 'ok', 0; return;
  end if;
  if a.fails + 1 >= 5 then
    update public.pin_accounts x set fails = 0, lock_level = x.lock_level + 1,
      locked_until = now() + least(interval '15 minutes' * power(2, a.lock_level), interval '24 hours') where x.user_id = a.user_id;
    return query select null::uuid, 'locked', (extract(epoch from least(interval '15 minutes' * power(2, a.lock_level), interval '24 hours')))::int; return;
  end if;
  update public.pin_accounts x set fails = x.fails + 1 where x.user_id = a.user_id;
  return query select null::uuid, 'wrong', 0;
end $$;

create or replace function public.acct_set_pin(p_user uuid, p_pin text, p_new_code boolean) returns text
language plpgsql security definer set search_path = '' as $$
declare code text := case when p_new_code then public.acct_new_code() end;
begin
  update public.pin_accounts set pin_hash = extensions.crypt(p_pin, extensions.gen_salt('bf', 8)), pin_changed_at = now(), fails = 0, locked_until = null,
    recovery_hash = case when p_new_code then extensions.crypt(code, extensions.gen_salt('bf', 8)) else recovery_hash end
  where user_id = p_user;
  return code;
end $$;

create or replace function public.acct_new_recovery(p_user uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare code text := public.acct_new_code();
begin
  update public.pin_accounts set recovery_hash = extensions.crypt(code, extensions.gen_salt('bf', 8)) where user_id = p_user;
  return code;
end $$;

create or replace function public.acct_device_code(p_user uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare code text := left(public.acct_new_code(), 6);
begin
  delete from public.device_codes where user_id = p_user or expires_at < now() - interval '1 day';
  insert into public.device_codes (code_hash, user_id, expires_at) values (encode(extensions.digest(code, 'sha256'), 'hex'), p_user, now() + interval '10 minutes');
  return code;
end $$;

create or replace function public.acct_use_device_code(p_code text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare u uuid;
begin
  update public.device_codes set used_at = now()
  where code_hash = encode(extensions.digest(upper(regexp_replace(p_code, '[^A-Za-z0-9]', '', 'g')), 'sha256'), 'hex')
    and used_at is null and expires_at > now()
  returning user_id into u;
  return u;
end $$;

revoke all on function public.acct_rate(text, text, int, interval), public.acct_new_code(), public.acct_create(uuid, text, text),
  public.acct_check(text, text, text), public.acct_set_pin(uuid, text, boolean), public.acct_new_recovery(uuid),
  public.acct_device_code(uuid), public.acct_use_device_code(text) from public, anon, authenticated;

-- ---------- your data: export and delete ----------
create or replace function public.export_my_data() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'player_id', auth.uid(),
    'account', (select jsonb_build_object('username', a.username, 'created_at', a.created_at, 'pin_changed_at', a.pin_changed_at) from public.pin_accounts a where a.user_id = auth.uid()),
    'email', (select u.email from auth.users u where u.id = auth.uid() and u.email not like '%@accounts.playdialin.com'),
    'joined', (select u.created_at from auth.users u where u.id = auth.uid()),
    'profile', (select jsonb_build_object('display_name', p.display_name, 'friend_code', p.friend_code, 'dial_in_plus', p.premium, 'dial_in_plus_since', p.premium_at, 'show_badge', p.show_badge, 'created_at', p.created_at) from public.profiles p where p.user_id = auth.uid()),
    'daily_results', coalesce((select jsonb_agg(jsonb_build_object('date', d.puzzle_date, 'score', d.score, 'exact', d.exact_count, 'answers', d.guesses, 'points', d.points, 'dial_ball_bonus', d.bonus, 'posted_at', d.submitted_at, 'kept_off_public_board', d.off_board) order by d.puzzle_date) from public.daily_results d where d.user_id = auth.uid()), '[]'::jsonb),
    'leagues', coalesce((select jsonb_agg(jsonb_build_object('name', l.name, 'code', l.code, 'owner', l.owner = auth.uid(), 'joined_at', m.joined_at)) from public.league_members m join public.leagues l on l.id = m.league_id where m.user_id = auth.uid()), '[]'::jsonb),
    'purchases', coalesce((select jsonb_agg(jsonb_build_object('amount', x.amount, 'currency', x.currency, 'date', x.created_at, 'refunded_at', x.refunded_at)) from public.purchases x where x.user_id = auth.uid()), '[]'::jsonb),
    'daily_reminder_devices', (select count(*) from public.push_subs s where s.user_id = auth.uid()),
    'saved_progress', (select s.data from public.player_saves s where s.user_id = auth.uid())
  )
$$;

-- Deletes the player and everything linked to them. Leagues they own pass to the longest-standing other member
-- (or close if nobody else is in them). Purchase records stay for six years for tax, without the player link.
create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); l record; nxt uuid;
begin
  if me is null then raise exception 'Not signed in'; end if;
  for l in select id from public.leagues where owner = me loop
    select m.user_id into nxt from public.league_members m where m.league_id = l.id and m.user_id <> me order by m.joined_at limit 1;
    if nxt is not null then update public.leagues set owner = nxt where id = l.id; end if;
  end loop;
  delete from public.mp_docs where owner = me;
  delete from auth.users where id = me;
end $$;

revoke all on function public.export_my_data(), public.delete_my_account() from public, anon;
grant execute on function public.export_my_data(), public.delete_my_account() to authenticated;

-- ---------- clean-up ----------
-- Network tags and salts after 48 hours; used or expired device codes; guest profiles nobody has used for 12 months
-- (a guest who never saved an account and hasn't played or opened the game in that time).
create or replace function public.acct_cleanup() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a int; b int; c int; g int;
begin
  delete from public.net_plays where at < now() - interval '48 hours'; get diagnostics a = row_count;
  delete from public.net_events where at < now() - interval '48 hours'; get diagnostics b = row_count;
  delete from public.net_salts where day < public.uk_today() - 2;
  delete from public.device_codes where expires_at < now() - interval '1 hour'; get diagnostics c = row_count;
  with idle as (
    select u.id from auth.users u
    where coalesce(u.is_anonymous, false) and u.email is null
      and not exists (select 1 from public.pin_accounts x where x.user_id = u.id)
      and not exists (select 1 from public.purchases x where x.user_id = u.id)
      and greatest(u.created_at, coalesce(u.last_sign_in_at, u.created_at),
                   coalesce((select s.updated_at from public.player_saves s where s.user_id = u.id), u.created_at),
                   coalesce((select max(d.puzzle_date)::timestamptz from public.daily_results d where d.user_id = u.id), u.created_at)) < now() - interval '12 months'
    limit 500
  )
  delete from auth.users where id in (select id from idle); get diagnostics g = row_count;
  return jsonb_build_object('net_plays', a, 'net_events', b, 'device_codes', c, 'idle_guests', g);
end $$;
revoke all on function public.acct_cleanup() from public, anon, authenticated;

-- an old warning from the database linter
alter function public.mp_touch() set search_path = '';

-- daily at 03:10 UK-ish (UTC): tidy up, and once the cut-off has passed, have the account function remove any real emails left
select cron.schedule('dialin-acct-cleanup', '10 3 * * *', $$ select public.acct_cleanup(); $$);
select cron.schedule('dialin-email-purge', '20 3 * * *', $$
  select net.http_post(
    url := 'https://jfutntnbxwhstqgrwskj.supabase.co/functions/v1/account',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', (select cron_secret from public.acct_config where id = 1)),
    body := '{"action":"purge"}'::jsonb)
  where public.uk_today() >= (select email_cutoff from public.acct_config where id = 1);
$$);
