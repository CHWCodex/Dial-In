-- Friends (all-time) leaderboard: you plus the players whose friend codes you've added,
-- ranked by total points across every daily puzzle they've finished.
create or replace function public.get_friends_alltime_leaderboard(p_codes text[])
returns table(rank bigint, player_id uuid, display_name text, total_score bigint, days_played bigint, exact_total bigint)
language sql stable security definer set search_path = public
as $$
  with f as (
    select p.user_id, p.display_name from public.profiles p
    where p.user_id = auth.uid() or p.friend_code = any ((coalesce(p_codes, '{}'::text[]))[1:100])
  ), t as (
    select d.user_id, sum(d.score)::bigint as total_score, count(*)::bigint as days_played, sum(d.exact_count)::bigint as exact_total
    from public.daily_results d where d.user_id in (select user_id from f) group by d.user_id
  ), r as (
    select t.*, f.display_name, rank() over (order by t.total_score desc, t.exact_total desc) as rk
    from t join f using (user_id)
  )
  select rk, user_id, display_name, total_score, days_played, exact_total from r order by rk, display_name
$$;

-- Names for friend codes, so Settings can show who you've added and reject codes that don't exist.
create or replace function public.friend_names(p_codes text[])
returns table(friend_code text, display_name text)
language sql stable security definer set search_path = public
as $$
  select p.friend_code, p.display_name from public.profiles p
  where p.friend_code = any ((coalesce(p_codes, '{}'::text[]))[1:100])
$$;

revoke all on function public.get_friends_alltime_leaderboard(text[]) from public, anon;
revoke all on function public.friend_names(text[]) from public, anon;
grant execute on function public.get_friends_alltime_leaderboard(text[]) to authenticated;
grant execute on function public.friend_names(text[]) to authenticated;
