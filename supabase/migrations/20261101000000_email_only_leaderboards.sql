-- Leaderboards are for players with a verified email: one profile per email, however many devices they use.
-- Guests (anonymous sign-ins) can still play, save to the cloud and battle, but can't post or see scores.

create or replace function public.has_verified_email(p_user uuid)
returns boolean language sql stable security definer set search_path = public, auth
as $$
  select exists (select 1 from auth.users u
                 where u.id = p_user and u.email is not null and u.email_confirmed_at is not null
                   and not coalesce(u.is_anonymous, false))
$$;
revoke all on function public.has_verified_email(uuid) from public, anon, authenticated;

create or replace function public.submit_result(p_date date, p_question_ids text[], p_guesses numeric[])
returns table(score integer, exact_count integer)
language plpgsql security definer set search_path = public
as $function$
declare
  s public.daily_sets;
  q public.questions;
  pts int[] := '{}';
  total int := 0;
  ex int := 0;
  i int;
begin
  if not public.has_verified_email(auth.uid()) then
    raise exception 'Link your email to post scores to the leaderboards';
  end if;
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
    if pts[i] = 1000 then ex := ex + 1; end if;
  end loop;
  insert into public.daily_results (user_id, puzzle_date, score, exact_count, guesses, points)
  values (auth.uid(), p_date, total, ex, p_guesses, pts);
  return query select total, ex;
end $function$;

create or replace function public.get_daily_leaderboard(p_date date, p_limit integer default 50)
returns table(rank bigint, player_id uuid, display_name text, score integer, exact_count integer)
language sql stable security definer set search_path = public
as $function$
  with r as (
    select d.user_id, p.display_name, d.score, d.exact_count, d.submitted_at,
           rank() over (order by d.score desc, d.exact_count desc) as rk
    from public.daily_results d join public.profiles p using (user_id)
    where d.puzzle_date = p_date and public.has_verified_email(d.user_id)
  )
  select rk, user_id, display_name, score, exact_count from r
  where public.has_verified_email(auth.uid())
    and (rk <= least(greatest(coalesce(p_limit, 50), 1), 100) or user_id = auth.uid())
  order by rk, submitted_at
$function$;

create or replace function public.get_alltime_leaderboard(p_limit integer default 50)
returns table(rank bigint, player_id uuid, display_name text, total_score bigint, days_played bigint, exact_total bigint)
language sql stable security definer set search_path = public
as $function$
  with t as (
    select d.user_id, sum(d.score)::bigint as total_score, count(*)::bigint as days_played, sum(d.exact_count)::bigint as exact_total
    from public.daily_results d where public.has_verified_email(d.user_id) group by d.user_id
  ), r as (
    select t.*, p.display_name, rank() over (order by t.total_score desc, t.exact_total desc) as rk
    from t join public.profiles p using (user_id)
  )
  select rk, user_id, display_name, total_score, days_played, exact_total from r
  where public.has_verified_email(auth.uid())
    and (rk <= least(greatest(coalesce(p_limit, 50), 1), 100) or user_id = auth.uid())
  order by rk
$function$;

create or replace function public.get_friends_leaderboard(p_date date, p_codes text[])
returns table(rank bigint, player_id uuid, display_name text, score integer, exact_count integer)
language sql stable security definer set search_path = public
as $function$
  with r as (
    select d.user_id, p.display_name, d.score, d.exact_count, d.submitted_at,
           rank() over (order by d.score desc, d.exact_count desc) as rk
    from public.daily_results d join public.profiles p using (user_id)
    where d.puzzle_date = p_date and public.has_verified_email(d.user_id)
      and (p.user_id = auth.uid() or p.friend_code = any ((coalesce(p_codes, '{}'::text[]))[1:100]))
  )
  select rk, user_id, display_name, score, exact_count from r
  where public.has_verified_email(auth.uid())
  order by rk, submitted_at
$function$;

create or replace function public.get_friends_alltime_leaderboard(p_codes text[])
returns table(rank bigint, player_id uuid, display_name text, total_score bigint, days_played bigint, exact_total bigint)
language sql stable security definer set search_path = public
as $$
  with f as (
    select p.user_id, p.display_name from public.profiles p
    where (p.user_id = auth.uid() or p.friend_code = any ((coalesce(p_codes, '{}'::text[]))[1:100]))
      and public.has_verified_email(p.user_id)
  ), t as (
    select d.user_id, sum(d.score)::bigint as total_score, count(*)::bigint as days_played, sum(d.exact_count)::bigint as exact_total
    from public.daily_results d where d.user_id in (select user_id from f) group by d.user_id
  ), r as (
    select t.*, f.display_name, rank() over (order by t.total_score desc, t.exact_total desc) as rk
    from t join f using (user_id)
  )
  select rk, user_id, display_name, total_score, days_played, exact_total from r
  where public.has_verified_email(auth.uid())
  order by rk, display_name
$$;

create or replace function public.get_daily_rank(p_date date)
returns table(players integer, my_rank integer, beaten integer, my_score integer, buckets integer[])
language plpgsql stable security definer set search_path = public
as $function$
declare
  mine int;
begin
  if not public.has_verified_email(auth.uid()) then return; end if;
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
                       where r2.puzzle_date = p_date and public.has_verified_email(r2.user_id) group by 1) x on x.bk = g.b)
  from public.daily_results d where d.puzzle_date = p_date and public.has_verified_email(d.user_id);
end $function$;
