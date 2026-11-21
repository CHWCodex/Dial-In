-- Every saved account is on the public boards straight away (no minimum number of days played).
create or replace function public.is_listed(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_member(p_user)
$$;
revoke all on function public.is_listed(uuid) from public, anon, authenticated;

create or replace function public.get_alltime_leaderboard(p_limit integer)
returns table(rank bigint, player_id uuid, display_name text, total_score bigint, days_played bigint, exact_total bigint, supporter boolean, streak integer)
language sql stable security definer set search_path = '' as $$
  with t as (
    select d.user_id, sum(d.score)::bigint as total_score, count(*)::bigint as days_played, sum(d.exact_count)::bigint as exact_total
    from public.daily_results d group by d.user_id
  ), r as (
    select t.*, p.display_name, (p.premium and p.show_badge) as sup, rank() over (order by t.total_score desc, t.exact_total desc) as rk
    from t join public.profiles p using (user_id) where public.is_member(t.user_id)
  )
  select rk, user_id, display_name, total_score, days_played, exact_total, sup, public.streak_of(user_id) from r
  where public.is_member(auth.uid())
    and (rk <= least(greatest(coalesce(p_limit, 50), 1), 100) or user_id = auth.uid())
  order by rk
$$;

create or replace function public.get_streak_leaderboard(p_limit integer)
returns table(rank bigint, player_id uuid, display_name text, streak integer, days_played bigint, supporter boolean)
language sql stable security definer set search_path = '' as $$
  with u as (
    select d.user_id, count(*)::bigint as days_played from public.daily_results d
    where d.user_id in (select d2.user_id from public.daily_results d2 where d2.puzzle_date >= public.uk_today() - 1)
    group by d.user_id
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
