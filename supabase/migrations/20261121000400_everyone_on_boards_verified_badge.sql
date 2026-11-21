-- Everyone is on the public boards, guests included. Saved accounts get a verified badge.
-- Fairness: a score stays off the public Daily board if a different guest profile had already started that
-- day's puzzle on the same connection (stops posting several guest scores, or practising in a private window).

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
    -- recorded first, so the earlier "started" note from this same profile is kept
    insert into public.net_plays (net, puzzle_date, user_id, member) values (n, p_date, auth.uid(), public.is_member(auth.uid()))
    on conflict (net, puzzle_date, user_id) do nothing;
    off := exists (select 1 from public.net_plays p
                   where p.net = n and p.puzzle_date = p_date and not p.member and p.user_id <> auth.uid()
                     and p.at < (select x.at from public.net_plays x where x.net = n and x.puzzle_date = p_date and x.user_id = auth.uid()));
  end if;
  insert into public.daily_results (user_id, puzzle_date, score, exact_count, guesses, points, bonus, off_board)
  values (auth.uid(), p_date, total + bonus, ex, p_guesses, pts, bonus, off);
  return query select total + bonus, ex;
end $$;

drop function if exists public.get_daily_leaderboard(date, integer);
create function public.get_daily_leaderboard(p_date date, p_limit integer)
returns table(rank bigint, player_id uuid, display_name text, score integer, exact_count integer, supporter boolean, streak integer, verified boolean)
language sql stable security definer set search_path = '' as $$
  with r as (
    select d.user_id, p.display_name, d.score, d.exact_count, d.submitted_at, (p.premium and p.show_badge) as sup,
           rank() over (order by d.score desc, d.exact_count desc) as rk
    from public.daily_results d join public.profiles p using (user_id)
    where d.puzzle_date = p_date and not d.off_board
  )
  select rk, user_id, display_name, score, exact_count, sup, public.streak_of(user_id), public.is_member(user_id) from r
  where auth.uid() is not null
    and (rk <= least(greatest(coalesce(p_limit, 50), 1), 100) or user_id = auth.uid())
  order by rk, submitted_at
$$;

drop function if exists public.get_alltime_leaderboard(integer);
create function public.get_alltime_leaderboard(p_limit integer)
returns table(rank bigint, player_id uuid, display_name text, total_score bigint, days_played bigint, exact_total bigint, supporter boolean, streak integer, verified boolean)
language sql stable security definer set search_path = '' as $$
  with t as (
    select d.user_id, sum(d.score)::bigint as total_score, count(*)::bigint as days_played, sum(d.exact_count)::bigint as exact_total
    from public.daily_results d group by d.user_id
  ), r as (
    select t.*, p.display_name, (p.premium and p.show_badge) as sup, rank() over (order by t.total_score desc, t.exact_total desc) as rk
    from t join public.profiles p using (user_id)
  )
  select rk, user_id, display_name, total_score, days_played, exact_total, sup, public.streak_of(user_id), public.is_member(user_id) from r
  where auth.uid() is not null
    and (rk <= least(greatest(coalesce(p_limit, 50), 1), 100) or user_id = auth.uid())
  order by rk
$$;

drop function if exists public.get_friends_leaderboard(date, text[]);
create function public.get_friends_leaderboard(p_date date, p_codes text[])
returns table(rank bigint, player_id uuid, display_name text, score integer, exact_count integer, supporter boolean, streak integer, verified boolean)
language sql stable security definer set search_path = '' as $$
  with r as (
    select d.user_id, p.display_name, d.score, d.exact_count, d.submitted_at, (p.premium and p.show_badge) as sup,
           rank() over (order by d.score desc, d.exact_count desc) as rk
    from public.daily_results d join public.profiles p using (user_id)
    where d.puzzle_date = p_date
      and (p.user_id = auth.uid() or p.friend_code = any ((coalesce(p_codes, '{}'::text[]))[1:100]))
  )
  select rk, user_id, display_name, score, exact_count, sup, public.streak_of(user_id), public.is_member(user_id) from r
  where auth.uid() is not null
  order by rk, submitted_at
$$;

drop function if exists public.get_friends_alltime_leaderboard(text[]);
create function public.get_friends_alltime_leaderboard(p_codes text[])
returns table(rank bigint, player_id uuid, display_name text, total_score bigint, days_played bigint, exact_total bigint, supporter boolean, streak integer, verified boolean)
language sql stable security definer set search_path = '' as $$
  with f as (
    select p.user_id, p.display_name, (p.premium and p.show_badge) as sup from public.profiles p
    where (p.user_id = auth.uid() or p.friend_code = any ((coalesce(p_codes, '{}'::text[]))[1:100]))
  ), t as (
    select d.user_id, sum(d.score)::bigint as total_score, count(*)::bigint as days_played, sum(d.exact_count)::bigint as exact_total
    from public.daily_results d where d.user_id in (select user_id from f) group by d.user_id
  ), r as (
    select t.*, f.display_name, f.sup, rank() over (order by t.total_score desc, t.exact_total desc) as rk
    from t join f using (user_id)
  )
  select rk, user_id, display_name, total_score, days_played, exact_total, sup, public.streak_of(user_id), public.is_member(user_id) from r
  where auth.uid() is not null
  order by rk, display_name
$$;

drop function if exists public.get_streak_leaderboard(integer);
create function public.get_streak_leaderboard(p_limit integer)
returns table(rank bigint, player_id uuid, display_name text, streak integer, days_played bigint, supporter boolean, verified boolean)
language sql stable security definer set search_path = '' as $$
  with u as (
    select d.user_id, count(*)::bigint as days_played from public.daily_results d
    where d.user_id in (select d2.user_id from public.daily_results d2 where d2.puzzle_date >= public.uk_today() - 1)
    group by d.user_id
  ), s as (
    select u.user_id, u.days_played, public.streak_of(u.user_id) as streak from u
  ), r as (
    select s.*, p.display_name, (p.premium and p.show_badge) as sup, rank() over (order by s.streak desc, s.days_played desc) as rk
    from s join public.profiles p using (user_id) where s.streak >= 2
  )
  select rk, user_id, display_name, streak, days_played, sup, public.is_member(user_id) from r
  where auth.uid() is not null
    and (rk <= least(greatest(coalesce(p_limit, 50), 1), 100) or user_id = auth.uid())
  order by rk, display_name
$$;

create or replace function public.get_daily_rank(p_date date)
returns table(players integer, my_rank integer, beaten integer, my_score integer, buckets integer[])
language plpgsql stable security definer set search_path = '' as $$
declare
  mine int;
begin
  if auth.uid() is null then return; end if;
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
                       where r2.puzzle_date = p_date and not r2.off_board group by 1) x on x.bk = g.b)
  from public.daily_results d where d.puzzle_date = p_date and (not d.off_board or d.user_id = auth.uid());
end $$;

create or replace function public.peek_daily_rank(p_date date, p_score integer)
returns table(players integer, would_rank integer)
language sql stable security definer set search_path = '' as $$
  select count(*)::int, (count(*) filter (where d.score > least(greatest(coalesce(p_score, 0), 0), 15400)) + 1)::int
  from public.daily_results d
  where d.puzzle_date = p_date and p_date between public.uk_today() - 1 and public.uk_today() and not d.off_board
$$;

create or replace function public.is_listed(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$ select p_user is not null $$;

revoke all on function public.get_daily_leaderboard(date, integer), public.get_alltime_leaderboard(integer),
  public.get_friends_leaderboard(date, text[]), public.get_friends_alltime_leaderboard(text[]), public.get_streak_leaderboard(integer),
  public.submit_result(date, text[], numeric[], integer) from public, anon;
grant execute on function public.get_daily_leaderboard(date, integer), public.get_alltime_leaderboard(integer),
  public.get_friends_leaderboard(date, text[]), public.get_friends_alltime_leaderboard(text[]), public.get_streak_leaderboard(integer),
  public.submit_result(date, text[], numeric[], integer) to authenticated;
revoke all on function public.is_listed(uuid) from public, anon, authenticated;
