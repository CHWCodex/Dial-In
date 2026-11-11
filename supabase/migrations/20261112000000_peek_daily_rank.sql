-- "You'd be #3 today": where a score would sit on today's board, for players who haven't joined yet.
-- Returns counts only (no names or other players' scores), so guests may call it.
create or replace function public.peek_daily_rank(p_date date, p_score integer)
returns table(players integer, would_rank integer)
language sql stable security definer set search_path = public
as $$
  select count(*)::int, (count(*) filter (where d.score > least(greatest(coalesce(p_score, 0), 0), 15400)) + 1)::int
  from public.daily_results d
  where d.puzzle_date = p_date and p_date between public.uk_today() - 1 and public.uk_today()
    and public.has_verified_email(d.user_id)
$$;
revoke all on function public.peek_daily_rank(date, integer) from public, anon;
grant execute on function public.peek_daily_rank(date, integer) to authenticated;
