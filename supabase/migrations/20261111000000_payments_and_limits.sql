-- Payments: remember the Stripe payment behind each purchase so a refund can switch Unlimited back off.
alter table public.purchases add column if not exists payment_intent text;
alter table public.purchases add column if not exists refunded_at timestamptz;
create index if not exists purchases_payment_intent on public.purchases (payment_intent);

create or replace function public.grant_premium(p_user uuid, p_session text, p_amount integer, p_currency text, p_intent text)
returns void language plpgsql security definer set search_path = public
as $$
begin
  perform public.ensure_profile(p_user);
  insert into public.purchases (id, user_id, amount, currency, payment_intent) values (p_session, p_user, p_amount, p_currency, p_intent)
  on conflict (id) do nothing;
  update public.profiles set premium = true, premium_at = coalesce(premium_at, now()) where user_id = p_user;
end $$;

-- A full refund: mark the purchase, and switch Unlimited off unless the player has another paid purchase.
create or replace function public.revoke_premium(p_intent text)
returns void language plpgsql security definer set search_path = public
as $$
declare u uuid;
begin
  update public.purchases set refunded_at = now() where payment_intent = p_intent and refunded_at is null returning user_id into u;
  if u is null then return; end if;
  if not exists (select 1 from public.purchases where user_id = u and refunded_at is null) then
    update public.profiles set premium = false where user_id = u;
  end if;
end $$;

revoke all on function public.grant_premium(uuid, text, integer, text, text) from public, anon, authenticated;
revoke all on function public.revoke_premium(text) from public, anon, authenticated;
grant execute on function public.grant_premium(uuid, text, integer, text, text) to service_role;
grant execute on function public.revoke_premium(text) to service_role;

-- Abuse limits: a saved game is a couple of KB and a battle document far less, so cap what any one row can hold.
alter table public.player_saves add constraint player_saves_size check (pg_column_size(data) <= 524288);
alter table public.mp_docs add constraint mp_docs_size check (pg_column_size(data) <= 65536);
alter table public.mp_docs add constraint mp_docs_path_len check (char_length(path) <= 120 and char_length(room) <= 8);
