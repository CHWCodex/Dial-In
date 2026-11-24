-- Sweep tidy-up: remove a leftover debugging function and index the foreign keys the advisor flagged.
drop function if exists public.zz_hdr2();

create index if not exists device_codes_user_id_idx on public.device_codes (user_id);
create index if not exists leagues_owner_idx on public.leagues (owner);
create index if not exists net_plays_user_id_idx on public.net_plays (user_id);
