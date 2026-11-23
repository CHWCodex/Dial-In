-- Name filter: blocks slurs, sexual names and strong swearing in player names, league names and usernames.
-- The same lists live in index.html (NAME_BLOCK) so players get told straight away; keep the two in step.
-- Checks a squashed copy of the name (lower case, digits read as letters: 0=o 1=i 3=e 4=a 5=s 6=g 7=t 8=b 9=g,
-- spaces and symbols removed), and the same with repeated letters collapsed, so "N i 9 9 a" and "fuuuck" are caught.

create or replace function public.name_squash(p text) returns text
language sql immutable set search_path = '' as $$
  select regexp_replace(translate(lower(coalesce(p, '')), '013456789', 'oieasgtbg'), '[^a-z]', '', 'g')
$$;

create or replace function public.name_ok(p text) returns boolean
language plpgsql immutable set search_path = '' as $$
declare
  j text := public.name_squash(p);
  c text := regexp_replace(j, '(.)\1+', '\1', 'g');
  w text;
  -- anywhere in the name
  anywhere constant text[] := array['nigg','niga','nigl','nigr','nigur','niglet','fuck','fuk','fck','cunt','faggot','fagot','fagg','wank','whore','slut',
    'bitch','shit','bastard','bollock','bolock','twat','cocksuck','dickhead','dickass','dicksuck','pussy','penis','vagina','dildo','porn','jizz','cumshot',
    'rimjob','blowjob','handjob','boob','asshole','arsehole','piss','retard','spastic','spaz','paedo','pedophile','paedophile','molest',
    'hitler','jigaboo','wetback','kike','chink','raghead','towelhead','pikey','tranny','golliwog','darkie','beaner','killyourself',
    'lamicstate'];
  -- only as a whole word (so Hancock, Dickens, Cassie, Essex and Pakistan are fine)
  whole constant text[] := array['ass','arse','cock','dick','dih','tit','tits','cum','sex','anal','anus','prick','rape','nonce','coon','paki',
    'gook','spic','dyke','wog','sambo','gyppo','gypo','mongo','nazi','nazis','negro','negros','rapist','kys','jew','jews','hoe','hoes','fag','fags','nig','nigs'];
begin
  if j = '' then return true; end if;
  foreach w in array anywhere loop
    if position(w in j) > 0 or position(w in c) > 0 then return false; end if;
  end loop;
  foreach w in array regexp_split_to_array(btrim(regexp_replace(translate(lower(coalesce(p, '')), '013456789', 'oieasgtbg'), '[^a-z]+', ' ', 'g')), ' ') loop
    if w = any(whole) or regexp_replace(w, '(.)\1+', '\1', 'g') = any(whole) then return false; end if;
  end loop;
  return true;
end $$;

grant execute on function public.name_squash(text), public.name_ok(text) to anon, authenticated;

-- Player names: a blocked name is ignored and the player keeps (gets back) their current name; the game then
-- copies the server's name onto the device. No error, so a bad old name never stops scores from posting.
create or replace function public.set_display_name(p_name text)
returns table(out_name text, out_code text)
language plpgsql security definer set search_path = 'public' as $$
declare
  n text := public.clean_name(p_name);
begin
  perform public.ensure_profile(auth.uid());
  if n <> '' and public.name_ok(n) then update public.profiles set display_name = n where user_id = auth.uid(); end if;
  return query select display_name, friend_code from public.profiles where user_id = auth.uid();
end $$;

-- League names
create or replace function public.create_league(p_name text)
returns table(code text, name text)
language plpgsql security definer set search_path = 'public' as $$
declare n text := public.clean_name(p_name); c text; lid uuid; tries int := 0;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if n = '' then raise exception 'Give your league a name'; end if;
  if not public.name_ok(n) then raise exception 'That league name isn’t allowed. Try another.'; end if;
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

-- Usernames (the account function turns this message into "That username isn't allowed")
create or replace function public.acct_create(p_user uuid, p_username text, p_pin text)
returns text language plpgsql security definer set search_path = '' as $$
declare code text := public.acct_new_code();
begin
  if not public.name_ok(p_username) then raise exception 'name_not_allowed'; end if;
  insert into public.pin_accounts (user_id, username, pin_hash, recovery_hash)
  values (p_user, p_username, extensions.crypt(p_pin, extensions.gen_salt('bf', 8)), extensions.crypt(code, extensions.gen_salt('bf', 8)));
  return code;
end $$;

-- Belt and braces: whatever path writes a name, a blocked one becomes the player's default Player-XXXX name.
create or replace function public.profiles_name_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if not public.name_ok(new.display_name) then
    new.display_name := 'Player-' || upper(substr(replace(new.user_id::text, '-', ''), 1, 4));
  end if;
  return new;
end $$;
drop trigger if exists profiles_name_guard on public.profiles;
create trigger profiles_name_guard before insert or update of display_name on public.profiles
  for each row execute function public.profiles_name_guard();

create or replace function public.leagues_name_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if not public.name_ok(new.name) then new.name := 'League ' || new.code; end if;
  return new;
end $$;
drop trigger if exists leagues_name_guard on public.leagues;
create trigger leagues_name_guard before insert or update of name on public.leagues
  for each row execute function public.leagues_name_guard();

-- Clean up names already on the boards: blocked ones fall back to Player-XXXX (via the guard above), plus one
-- that picks on a named person, which a word list can't catch.
update public.profiles set display_name = display_name where not public.name_ok(display_name);
update public.profiles set display_name = 'Player-' || upper(substr(replace(user_id::text, '-', ''), 1, 4))
  where lower(display_name) = 'jaxsonfeetsniffe';
update public.leagues set name = name where not public.name_ok(name);
