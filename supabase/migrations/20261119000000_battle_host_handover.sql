-- Battles: let the room survive the host dropping out.
-- 1. updated_at now changes on every write, so the server can tell when a player's phone has gone quiet
--    (each phone in a room re-saves its player doc every few seconds as a heartbeat).
-- 2. Room changes go through mp_update_room: allowed for the room's current host, or for a seated player
--    taking over when the host's heartbeat has stopped. (Before, only the phone that created the room
--    could ever change it, so a handed-over room froze.)
create or replace function public.mp_touch() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists mp_docs_touch on public.mp_docs;
create trigger mp_docs_touch before update on public.mp_docs for each row execute function public.mp_touch();

create or replace function public.mp_update_room(p_code text, p_data jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  cur jsonb; host text; me text := auth.uid()::text; host_seen timestamptz;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if p_code !~ '^\d{4}$' or p_data is null or jsonb_typeof(p_data) <> 'object' or pg_column_size(p_data) > 65536 then raise exception 'Bad room data'; end if;
  select data into cur from public.mp_docs where path = 'rooms/' || p_code for update;
  if not found then raise exception 'No room with that code'; end if;
  host := cur->>'host';
  if host is distinct from me then
    -- taking over: you must be seated in the room, name yourself host, and the host must have gone quiet
    if (p_data->>'host') is distinct from me
       or not exists (select 1 from jsonb_array_elements(coalesce(cur->'roster', '[]'::jsonb)) r where r->>'id' = me) then
      raise exception 'Only the host can change the room';
    end if;
    select updated_at into host_seen from public.mp_docs where path = 'rooms/' || p_code || '/players/' || host;
    if host_seen is not null and host_seen > now() - interval '20 seconds' then raise exception 'The host is still here'; end if;
  end if;
  update public.mp_docs set data = p_data || jsonb_build_object('code', p_code), updated_at = now() where path = 'rooms/' || p_code;
end $$;
revoke all on function public.mp_update_room(text, jsonb) from public, anon;
grant execute on function public.mp_update_room(text, jsonb) to authenticated;
