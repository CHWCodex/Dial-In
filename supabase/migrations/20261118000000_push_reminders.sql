-- Daily reminder notifications (Web Push). Opt-in from the game; sent once a day at about 6:30pm UK time,
-- only to players who haven't finished that day's puzzle yet.
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

-- One row: the signing keys (made by the daily-push function itself, never leave the server) and the
-- secret the scheduled job uses to call that function.
create table if not exists public.push_config (
  id int primary key default 1 check (id = 1),
  cron_secret text not null default encode(extensions.gen_random_bytes(24), 'hex'),
  vapid_public text,
  vapid_private text
);
insert into public.push_config (id) values (1) on conflict do nothing;

create table if not exists public.push_subs (
  endpoint text primary key check (endpoint ~ '^https://' and char_length(endpoint) <= 1000),
  user_id uuid not null references auth.users(id) on delete cascade,
  p256dh text not null check (char_length(p256dh) between 40 and 200),
  auth text not null check (char_length(auth) between 10 and 100),
  created_at timestamptz not null default now(),
  last_sent date,
  fails int not null default 0
);
create index if not exists push_subs_user_idx on public.push_subs (user_id);
alter table public.push_config enable row level security;
alter table public.push_subs enable row level security;
revoke all on public.push_config, public.push_subs from anon, authenticated;

create or replace function public.push_public_key() returns text
language sql stable security definer set search_path = public as $$ select vapid_public from public.push_config where id = 1 $$;

create or replace function public.save_push(p_endpoint text, p_p256dh text, p_auth text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if (select count(*) from public.push_subs where user_id = auth.uid()) >= 5 then
    delete from public.push_subs where endpoint in (select endpoint from public.push_subs where user_id = auth.uid() order by created_at limit 1);
  end if;
  insert into public.push_subs (endpoint, user_id, p256dh, auth) values (p_endpoint, auth.uid(), p_p256dh, p_auth)
  on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, fails = 0;
end $$;

create or replace function public.delete_push(p_endpoint text) returns void
language sql security definer set search_path = public as $$ delete from public.push_subs where endpoint = p_endpoint and user_id = auth.uid() $$;

-- For the daily-push function only: who still needs a nudge today, and whether they're on a streak
create or replace function public.push_targets(p_date date)
returns table(endpoint text, p256dh text, auth text, streak boolean)
language sql stable security definer set search_path = public as $$
  select s.endpoint, s.p256dh, s.auth,
    coalesce((ps.data->'days'->((p_date - 1)::text)->>'done') = 'true', false)
      or exists (select 1 from public.daily_results r where r.user_id = s.user_id and r.puzzle_date = p_date - 1)
  from public.push_subs s left join public.player_saves ps on ps.user_id = s.user_id
  where s.last_sent is distinct from p_date
    and coalesce((ps.data->'days'->(p_date::text)->>'done') = 'true', false) = false
    and not exists (select 1 from public.daily_results r where r.user_id = s.user_id and r.puzzle_date = p_date)
$$;
create or replace function public.push_mark(p_sent text[], p_gone text[], p_failed text[], p_date date) returns void
language sql security definer set search_path = public as $$
  update public.push_subs set last_sent = p_date, fails = 0 where endpoint = any(p_sent);
  delete from public.push_subs where endpoint = any(p_gone);
  update public.push_subs set fails = fails + 1, last_sent = p_date where endpoint = any(p_failed);
  delete from public.push_subs where fails >= 5;
$$;

revoke all on function public.push_targets(date), public.push_mark(text[], text[], text[], date) from public, anon, authenticated;
grant execute on function public.push_targets(date), public.push_mark(text[], text[], text[], date) to service_role;
revoke all on function public.push_public_key(), public.save_push(text, text, text), public.delete_push(text) from public, anon;
grant execute on function public.push_public_key(), public.save_push(text, text, text), public.delete_push(text) to authenticated;

-- Scheduled job (applied separately as push_reminders_schedule). Runs at 17:30 and 18:30 UTC; the function only
-- sends when it's 6pm-7pm in the UK, so the reminder lands at 6:30pm UK in both winter and summer.
select cron.unschedule(jobid) from cron.job where jobname = 'dialin-daily-push';
select cron.schedule('dialin-daily-push', '30 17,18 * * *', $$
  select net.http_post(
    url := 'https://jfutntnbxwhstqgrwskj.supabase.co/functions/v1/daily-push',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', (select cron_secret from public.push_config where id = 1)),
    body := '{}'::jsonb, timeout_milliseconds := 60000)
$$);
