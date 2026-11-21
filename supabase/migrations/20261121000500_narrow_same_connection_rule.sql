-- Shared connections (mobile networks, schools, offices) put many strangers behind one IP address, so the
-- fairness tag for daily plays now also includes the browser type, and only counts an earlier guest who
-- started within the hour before. The private-window trick (same phone, same browser, minutes apart) is
-- still caught; strangers on a shared network almost never match.
create or replace function public.net_tag(p_ip text default null) returns text
language plpgsql security definer set search_path = '' as $$
declare
  h jsonb := coalesce(nullif(current_setting('request.headers', true), '')::jsonb, '{}'::jsonb);
  ip text := nullif(trim(split_part(coalesce(p_ip, h->>'cf-connecting-ip', h->>'x-forwarded-for', ''), ',', 1)), '');
  ua text := case when p_ip is null then coalesce(h->>'user-agent', '') else '' end;   -- account rate limits pass an IP only
  s text;
begin
  if ip is null then return null; end if;
  insert into public.net_salts (day, salt) values (public.uk_today(), encode(extensions.gen_random_bytes(16), 'hex')) on conflict (day) do nothing;
  select salt into s from public.net_salts where day = public.uk_today();
  return encode(extensions.digest(s || '|' || ip || '|' || ua, 'sha256'), 'hex');
end $$;
revoke all on function public.net_tag(text) from public, anon, authenticated;

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
  mine timestamptz;
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
    insert into public.net_plays (net, puzzle_date, user_id, member) values (n, p_date, auth.uid(), public.is_member(auth.uid()))
    on conflict (net, puzzle_date, user_id) do nothing;
    select x.at into mine from public.net_plays x where x.net = n and x.puzzle_date = p_date and x.user_id = auth.uid();
    off := exists (select 1 from public.net_plays p
                   where p.net = n and p.puzzle_date = p_date and not p.member and p.user_id <> auth.uid()
                     and p.at < mine and p.at > mine - interval '1 hour');
  end if;
  insert into public.daily_results (user_id, puzzle_date, score, exact_count, guesses, points, bonus, off_board)
  values (auth.uid(), p_date, total + bonus, ex, p_guesses, pts, bonus, off);
  return query select total + bonus, ex;
end $$;
revoke all on function public.submit_result(date, text[], numeric[], integer) from public, anon;
grant execute on function public.submit_result(date, text[], numeric[], integer) to authenticated;
