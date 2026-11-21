-- A recovery code (12 random characters) is the way out of a PIN lockout, so the lock only applies to PINs.
-- Recovery tries are limited per connection by the account function instead.
create or replace function public.acct_check(p_username text, p_secret text, p_kind text)
returns table(user_id uuid, status text, wait_seconds int)
language plpgsql security definer set search_path = '' as $$
declare a public.pin_accounts; ok boolean;
begin
  select * into a from public.pin_accounts x where x.username = lower(trim(p_username)) for update;
  if not found then
    perform extensions.crypt('x', extensions.gen_salt('bf', 8));
    return query select null::uuid, 'wrong', 0; return;
  end if;
  if p_kind = 'code' then
    if a.recovery_hash = extensions.crypt(upper(regexp_replace(p_secret, '[^A-Za-z0-9]', '', 'g')), a.recovery_hash) then
      update public.pin_accounts x set fails = 0, locked_until = null where x.user_id = a.user_id;
      return query select a.user_id, 'ok', 0; return;
    end if;
    return query select null::uuid, 'wrong', 0; return;
  end if;
  if a.locked_until is not null and a.locked_until > now() then
    return query select null::uuid, 'locked', ceil(extract(epoch from a.locked_until - now()))::int; return;
  end if;
  ok := a.pin_hash = extensions.crypt(p_secret, a.pin_hash);
  if ok then
    update public.pin_accounts x set fails = 0, lock_level = greatest(x.lock_level - 1, 0), locked_until = null where x.user_id = a.user_id;
    return query select a.user_id, 'ok', 0; return;
  end if;
  if a.fails + 1 >= 5 then
    update public.pin_accounts x set fails = 0, lock_level = x.lock_level + 1,
      locked_until = now() + least(interval '15 minutes' * power(2, a.lock_level), interval '24 hours') where x.user_id = a.user_id;
    return query select null::uuid, 'locked', (extract(epoch from least(interval '15 minutes' * power(2, a.lock_level), interval '24 hours')))::int; return;
  end if;
  update public.pin_accounts x set fails = x.fails + 1 where x.user_id = a.user_id;
  return query select null::uuid, 'wrong', 0;
end $$;
revoke all on function public.acct_check(text, text, text) from public, anon, authenticated;
