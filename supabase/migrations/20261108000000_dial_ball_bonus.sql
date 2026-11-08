-- Dial Ball: the pinball bonus round after question 7 adds points to the day's score.
-- The server works out how many balls the answers earned (3 for spot on, 2 for 900/750,
-- 1 for 600/400/200, 0 for no signal) and caps the bonus at 400 per ball, so a tampered
-- client can't post more than the machine could ever pay out.
alter table public.daily_results add column if not exists bonus integer not null default 0;
-- A day can now score more than 7,000: 7,000 from the answers plus up to 21 balls x 400.
alter table public.daily_results drop constraint if exists daily_results_score_check;
alter table public.daily_results add constraint daily_results_score_check check (score >= 0 and score <= 15400);
alter table public.daily_results add constraint daily_results_bonus_check check (bonus >= 0 and bonus <= 8400);

create or replace function public.balls_for_points(p int)
returns int language sql immutable set search_path = public
as $$ select case when p >= 1000 then 3 when p >= 750 then 2 when p >= 200 then 1 else 0 end $$;

create or replace function public.submit_result(p_date date, p_question_ids text[], p_guesses numeric[], p_bonus integer)
returns table(score integer, exact_count integer)
language plpgsql security definer set search_path = public
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
    balls := balls + public.balls_for_points(pts[i]);
    if pts[i] = 1000 then ex := ex + 1; end if;
  end loop;
  bonus := least(greatest(coalesce(p_bonus, 0), 0), balls * 400);
  insert into public.daily_results (user_id, puzzle_date, score, exact_count, guesses, points, bonus)
  values (auth.uid(), p_date, total + bonus, ex, p_guesses, pts, bonus);
  return query select total + bonus, ex;
end $function$;

-- Older copies of the game still call the three-argument version: no bonus.
create or replace function public.submit_result(p_date date, p_question_ids text[], p_guesses numeric[])
returns table(score integer, exact_count integer)
language sql security definer set search_path = public
as $$ select * from public.submit_result(p_date, p_question_ids, p_guesses, 0) $$;

revoke all on function public.submit_result(date, text[], numeric[], integer) from public, anon;
grant execute on function public.submit_result(date, text[], numeric[], integer) to authenticated;
revoke all on function public.submit_result(date, text[], numeric[]) from public, anon;
grant execute on function public.submit_result(date, text[], numeric[]) to authenticated;
