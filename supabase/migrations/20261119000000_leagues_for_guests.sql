-- Leagues for everyone: guests (no email) can create and join leagues and appear on them.
-- To make that work, guests' daily results are now posted too (checked exactly as before). Every PUBLIC
-- board and ranking (daily, all-time, friends, daily rank, 'you'd be #N') still filters on
-- has_verified_email, so they are unchanged: guests only ever appear inside their own leagues.

create or replace function public.create_league(p_name text)
returns table(code text, name text)
language plpgsql security definer set search_path = public as $$
declare n text := public.clean_name(p_name); c text; lid uuid; tries int := 0;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
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
  if auth.uid() is null then raise exception 'Not signed in'; end if;
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
  from mine where auth.uid() is not null
  order by mine.created_at
$$;

create or replace function public.get_league_board(p_code text, p_date date)
returns table(rank bigint, player_id uuid, display_name text, score bigint, exact_count bigint, days_played bigint, supporter boolean)
language sql stable security definer set search_path = public as $$
  with l as (select id from public.leagues where code = upper(trim(p_code))),
  mem as (select m.user_id from public.league_members m join l on l.id = m.league_id),
  ok as (select 1 from mem where mem.user_id = auth.uid()),
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

-- Same checks as before (today or yesterday only, the day's real questions, 7 answers, one result per player,
-- bonus capped by balls earned); the only change is that a signed-in guest may post too.
create or replace function public.submit_result(p_date date, p_question_ids text[], p_guesses numeric[], p_bonus integer)
 returns table(score integer, exact_count integer)
 language plpgsql security definer set search_path to 'public'
as $function$
declare
  s public.daily_sets;
  q public.questions;
  pts int[] := '{}';
  total int := 0;
  ex int := 0;
  balls int := 0;
  bonus int;
  i int;
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
  insert into public.daily_results (user_id, puzzle_date, score, exact_count, guesses, points, bonus)
  values (auth.uid(), p_date, total + bonus, ex, p_guesses, pts, bonus);
  return query select total + bonus, ex;
end $function$;
