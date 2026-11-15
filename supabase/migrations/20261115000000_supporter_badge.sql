-- Supporter badge: players who bought Unlimited get a badge on the leaderboards, unless they turn it off.
alter table public.profiles add column if not exists show_badge boolean not null default true;

create or replace function public.set_show_badge(p_show boolean)
returns void language sql security definer set search_path = public
as $$ update public.profiles set show_badge = coalesce(p_show, true) where user_id = auth.uid() $$;
revoke all on function public.set_show_badge(boolean) from public, anon;
grant execute on function public.set_show_badge(boolean) to authenticated;

-- The leaderboards gain a "supporter" column, so they have to be dropped and recreated.
drop function if exists public.get_daily_leaderboard(date, integer);
drop function if exists public.get_alltime_leaderboard(integer);
drop function if exists public.get_friends_leaderboard(date, text[]);
drop function if exists public.get_friends_alltime_leaderboard(text[]);

create function public.get_daily_leaderboard(p_date date, p_limit integer default 50)
returns table(rank bigint, player_id uuid, display_name text, score integer, exact_count integer, supporter boolean)
language sql stable security definer set search_path = public
as $function$
  with r as (
    select d.user_id, p.display_name, d.score, d.exact_count, d.submitted_at, (p.premium and p.show_badge) as sup,
           rank() over (order by d.score desc, d.exact_count desc) as rk
    from public.daily_results d join public.profiles p using (user_id)
    where d.puzzle_date = p_date and public.has_verified_email(d.user_id)
  )
  select rk, user_id, display_name, score, exact_count, sup from r
  where public.has_verified_email(auth.uid())
    and (rk <= least(greatest(coalesce(p_limit, 50), 1), 100) or user_id = auth.uid())
  order by rk, submitted_at
$function$;

create function public.get_alltime_leaderboard(p_limit integer default 50)
returns table(rank bigint, player_id uuid, display_name text, total_score bigint, days_played bigint, exact_total bigint, supporter boolean)
language sql stable security definer set search_path = public
as $function$
  with t as (
    select d.user_id, sum(d.score)::bigint as total_score, count(*)::bigint as days_played, sum(d.exact_count)::bigint as exact_total
    from public.daily_results d where public.has_verified_email(d.user_id) group by d.user_id
  ), r as (
    select t.*, p.display_name, (p.premium and p.show_badge) as sup, rank() over (order by t.total_score desc, t.exact_total desc) as rk
    from t join public.profiles p using (user_id)
  )
  select rk, user_id, display_name, total_score, days_played, exact_total, sup from r
  where public.has_verified_email(auth.uid())
    and (rk <= least(greatest(coalesce(p_limit, 50), 1), 100) or user_id = auth.uid())
  order by rk
$function$;

create function public.get_friends_leaderboard(p_date date, p_codes text[])
returns table(rank bigint, player_id uuid, display_name text, score integer, exact_count integer, supporter boolean)
language sql stable security definer set search_path = public
as $function$
  with r as (
    select d.user_id, p.display_name, d.score, d.exact_count, d.submitted_at, (p.premium and p.show_badge) as sup,
           rank() over (order by d.score desc, d.exact_count desc) as rk
    from public.daily_results d join public.profiles p using (user_id)
    where d.puzzle_date = p_date and public.has_verified_email(d.user_id)
      and (p.user_id = auth.uid() or p.friend_code = any ((coalesce(p_codes, '{}'::text[]))[1:100]))
  )
  select rk, user_id, display_name, score, exact_count, sup from r
  where public.has_verified_email(auth.uid())
  order by rk, submitted_at
$function$;

create function public.get_friends_alltime_leaderboard(p_codes text[])
returns table(rank bigint, player_id uuid, display_name text, total_score bigint, days_played bigint, exact_total bigint, supporter boolean)
language sql stable security definer set search_path = public
as $function$
  with f as (
    select p.user_id, p.display_name, (p.premium and p.show_badge) as sup from public.profiles p
    where (p.user_id = auth.uid() or p.friend_code = any ((coalesce(p_codes, '{}'::text[]))[1:100]))
      and public.has_verified_email(p.user_id)
  ), t as (
    select d.user_id, sum(d.score)::bigint as total_score, count(*)::bigint as days_played, sum(d.exact_count)::bigint as exact_total
    from public.daily_results d where d.user_id in (select user_id from f) group by d.user_id
  ), r as (
    select t.*, f.display_name, f.sup, rank() over (order by t.total_score desc, t.exact_total desc) as rk
    from t join f using (user_id)
  )
  select rk, user_id, display_name, total_score, days_played, exact_total, sup from r
  where public.has_verified_email(auth.uid())
  order by rk, display_name
$function$;

revoke all on function public.get_daily_leaderboard(date, integer) from public, anon;
revoke all on function public.get_alltime_leaderboard(integer) from public, anon;
revoke all on function public.get_friends_leaderboard(date, text[]) from public, anon;
revoke all on function public.get_friends_alltime_leaderboard(text[]) from public, anon;
grant execute on function public.get_daily_leaderboard(date, integer) to authenticated;
grant execute on function public.get_alltime_leaderboard(integer) to authenticated;
grant execute on function public.get_friends_leaderboard(date, text[]) to authenticated;
grant execute on function public.get_friends_alltime_leaderboard(text[]) to authenticated;
