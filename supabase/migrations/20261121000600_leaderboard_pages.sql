-- Leaderboards in pages of up to 100: p_offset skips that many places (your own row comes with the first page).
drop function if exists public.get_daily_leaderboard(date, integer);
create function public.get_daily_leaderboard(p_date date, p_limit integer, p_offset integer default 0)
returns table(rank bigint, player_id uuid, display_name text, score integer, exact_count integer, supporter boolean, streak integer, verified boolean)
language sql stable security definer set search_path = '' as $$
  with r as (
    select d.user_id, p.display_name, d.score, d.exact_count, d.submitted_at, (p.premium and p.show_badge) as sup,
           row_number() over (order by d.score desc, d.exact_count desc, d.submitted_at) as pos,
           rank() over (order by d.score desc, d.exact_count desc) as rk
    from public.daily_results d join public.profiles p using (user_id)
    where d.puzzle_date = p_date and not d.off_board
  )
  select rk, user_id, display_name, score, exact_count, sup, public.streak_of(user_id), public.is_member(user_id) from r
  where auth.uid() is not null
    and ((pos > greatest(coalesce(p_offset, 0), 0) and pos <= greatest(coalesce(p_offset, 0), 0) + least(greatest(coalesce(p_limit, 100), 1), 100))
         or (coalesce(p_offset, 0) = 0 and user_id = auth.uid()))
  order by pos
$$;

drop function if exists public.get_alltime_leaderboard(integer);
create function public.get_alltime_leaderboard(p_limit integer, p_offset integer default 0)
returns table(rank bigint, player_id uuid, display_name text, total_score bigint, days_played bigint, exact_total bigint, supporter boolean, streak integer, verified boolean)
language sql stable security definer set search_path = '' as $$
  with t as (
    select d.user_id, sum(d.score)::bigint as total_score, count(*)::bigint as days_played, sum(d.exact_count)::bigint as exact_total
    from public.daily_results d group by d.user_id
  ), r as (
    select t.*, p.display_name, (p.premium and p.show_badge) as sup,
           row_number() over (order by t.total_score desc, t.exact_total desc, p.display_name, t.user_id) as pos,
           rank() over (order by t.total_score desc, t.exact_total desc) as rk
    from t join public.profiles p using (user_id)
  )
  select rk, user_id, display_name, total_score, days_played, exact_total, sup, public.streak_of(user_id), public.is_member(user_id) from r
  where auth.uid() is not null
    and ((pos > greatest(coalesce(p_offset, 0), 0) and pos <= greatest(coalesce(p_offset, 0), 0) + least(greatest(coalesce(p_limit, 100), 1), 100))
         or (coalesce(p_offset, 0) = 0 and user_id = auth.uid()))
  order by pos
$$;

drop function if exists public.get_streak_leaderboard(integer);
create function public.get_streak_leaderboard(p_limit integer, p_offset integer default 0)
returns table(rank bigint, player_id uuid, display_name text, streak integer, days_played bigint, supporter boolean, verified boolean)
language sql stable security definer set search_path = '' as $$
  with u as (
    select d.user_id, count(*)::bigint as days_played from public.daily_results d
    where d.user_id in (select d2.user_id from public.daily_results d2 where d2.puzzle_date >= public.uk_today() - 1)
    group by d.user_id
  ), s as (
    select u.user_id, u.days_played, public.streak_of(u.user_id) as streak from u
  ), r as (
    select s.*, p.display_name, (p.premium and p.show_badge) as sup,
           row_number() over (order by s.streak desc, s.days_played desc, p.display_name, s.user_id) as pos,
           rank() over (order by s.streak desc, s.days_played desc) as rk
    from s join public.profiles p using (user_id) where s.streak >= 2
  )
  select rk, user_id, display_name, streak, days_played, sup, public.is_member(user_id) from r
  where auth.uid() is not null
    and ((pos > greatest(coalesce(p_offset, 0), 0) and pos <= greatest(coalesce(p_offset, 0), 0) + least(greatest(coalesce(p_limit, 100), 1), 100))
         or (coalesce(p_offset, 0) = 0 and user_id = auth.uid()))
  order by pos
$$;

revoke all on function public.get_daily_leaderboard(date, integer, integer), public.get_alltime_leaderboard(integer, integer),
  public.get_streak_leaderboard(integer, integer) from public, anon;
grant execute on function public.get_daily_leaderboard(date, integer, integer), public.get_alltime_leaderboard(integer, integer),
  public.get_streak_leaderboard(integer, integer) to authenticated;
