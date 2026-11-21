-- Pending email changes (an address typed in but never confirmed) and unused sign-in codes also hold emails.
create or replace function public.acct_scrub(p_user uuid default null) returns int
language plpgsql security definer set search_path = '' as $$
declare n int; m int;
begin
  update auth.users set email_change = '', email_change_token_new = '', email_change_token_current = '', email_change_confirm_status = 0
  where coalesce(email_change, '') <> '' and (p_user is null or id = p_user);
  get diagnostics n = row_count;
  delete from auth.one_time_tokens where relates_to like '%@%' and relates_to not like '%@accounts.playdialin.com' and (p_user is null or user_id = p_user);
  get diagnostics m = row_count;
  return n + m;
end $$;
revoke all on function public.acct_scrub(uuid) from public, anon, authenticated;

-- the daily tidy-up also scrubs everyone's once the cut-off has passed
create or replace function public.acct_cleanup() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a int; b int; c int; g int; e int := 0;
begin
  delete from public.net_plays where at < now() - interval '48 hours'; get diagnostics a = row_count;
  delete from public.net_events where at < now() - interval '48 hours'; get diagnostics b = row_count;
  delete from public.net_salts where day < public.uk_today() - 2;
  delete from public.device_codes where expires_at < now() - interval '1 hour'; get diagnostics c = row_count;
  with idle as (
    select u.id from auth.users u
    where coalesce(u.is_anonymous, false) and u.email is null
      and not exists (select 1 from public.pin_accounts x where x.user_id = u.id)
      and not exists (select 1 from public.purchases x where x.user_id = u.id)
      and greatest(u.created_at, coalesce(u.last_sign_in_at, u.created_at),
                   coalesce((select s.updated_at from public.player_saves s where s.user_id = u.id), u.created_at),
                   coalesce((select max(d.puzzle_date)::timestamptz from public.daily_results d where d.user_id = u.id), u.created_at)) < now() - interval '12 months'
    limit 500
  )
  delete from auth.users where id in (select id from idle); get diagnostics g = row_count;
  if public.uk_today() >= (select email_cutoff from public.acct_config where id = 1) then e := public.acct_scrub(null); end if;
  return jsonb_build_object('net_plays', a, 'net_events', b, 'device_codes', c, 'idle_guests', g, 'email_leftovers', e);
end $$;
revoke all on function public.acct_cleanup() from public, anon, authenticated;
