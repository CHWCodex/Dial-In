-- Name filter, round 2: catch joined-up words like "CockMuncher".
-- New: ROOTS are blocked anywhere in a name, after first removing known innocent words that contain them
-- (Hancock, Peacock, cockpit, Dickens, Essex, cucumber, Cumbria, Scunthorpe...). More compounds and slurs added.
-- index.html keeps an identical copy (NAME_BLOCK) so players are told straight away; keep the two in step.
create or replace function public.name_ok(p text) returns boolean
language plpgsql immutable set search_path = '' as $$
declare
  raw text := translate(lower(coalesce(p, '')), '013456789', 'oieasgtbg');
  j text := regexp_replace(raw, '[^a-z]', '', 'g');
  s text;            -- j with innocent words removed
  c text;            -- s with repeated letters collapsed
  w text;
  -- innocent words that contain a blocked root
  safe constant text[] := array['scunthorpe','hancock','peacock','babcock','woodcock','hitchcock','alcock','glasscock','shuttlecock','weathercock',
    'gamecock','stopcock','ballcock','haycock','cockburn','cockney','cockpit','cockatoo','cockatiel','cockerel','cocker','cocktail','cockle','cockroach',
    'dickens','dickinson','dickson','dickie','dicky','dickey','benedick','riddick','sussex','essex','wessex','middlesex','sexton','sextant','sextet',
    'cucumber','cumberland','cumbria','cumbrian','document','circum','accumul','cumulus','incumb','succumb','modicum','capsicum','talcum','locum','cumin',
    'cummings','cumnock','cuckoo','cuckfield','clitheroe','scum','acumen','dickerson','cockrell','thorny','yoshit','toshit'];
  -- blocked anywhere once innocent words are removed
  roots constant text[] := array['cock','dick','sex','cum','cuck','clit'];
  -- blocked anywhere
  anywhere constant text[] := array['nigg','niga','nigl','nigr','nigur','niglet','fuck','fuk','fck','cunt','faggot','fagot','fagg','wank','whore','slut',
    'bitch','shit','bastard','bollock','bolock','twat','pussy','penis','vagina','dildo','porn','jizz','rimjob','blowjob','handjob','boob','asshole',
    'arsehole','piss','retard','spastic','spaz','paedo','pedophile','paedophile','molest','hitler','jigaboo','wetback','kike','chink','raghead','towelhead',
    'pikey','tranny','trannie','shemale','golliwog','darkie','beaner','killyourself','lamicstate',
    'asshat','assclown','asswipe','asslick','dumbass','jackass','smartass','fatass','eatass','kissmyass','assmunch','butthole','buttplug','buttsex',
    'ballsack','ballbag','nutsack','teabag','knobhead','knobend','nobhead','bellend','minge','skank','milf','hentai','horny','boner','erection','sperm',
    'nipple','schlong','scrotum','testicle','jerkoff','jackoff','spunk','bukkake','gangbang','threesome','onlyfans','incest','bestiality','zoophil',
    'orgasm','titty','titties','tittie','carpetmunch','rugmunch','kaffir','kafir','zipperhead','redskin','junglebunny','porchmonkey','motherf','mofo'];
  -- only as a whole word
  whole constant text[] := array['ass','arse','tit','tits','anal','anus','prick','rape','raped','rapes','raping','rapey','rapist','nonce','coon','paki',
    'pakis','gook','spic','spick','dyke','wog','sambo','gyppo','gypo','mongo','nazi','nazis','negro','negros','kys','jew','jews','hoe','hoes','fag','fags',
    'nig','nigs','dih','homo','lesbo','tard','yid','jap','wop','dago','thot','slag','nude','nudes','orgy','semen','puss','heil','kkk','xxx'];
begin
  if j = '' then return true; end if;
  s := j;
  foreach w in array safe loop s := replace(s, w, ''); end loop;
  c := regexp_replace(s, '(.)\1+', '\1', 'g');
  foreach w in array roots || anywhere loop
    if position(w in s) > 0 or position(w in c) > 0 then return false; end if;
  end loop;
  foreach w in array regexp_split_to_array(btrim(regexp_replace(raw, '[^a-z]+', ' ', 'g')), ' ') loop
    if w = any(whole) or regexp_replace(w, '(.)\1+', '\1', 'g') = any(whole) then return false; end if;
  end loop;
  return true;
end $$;

-- Re-check every name with the stronger filter (blocked ones fall back to Player-XXXX via the guard trigger).
update public.profiles set display_name = display_name where not public.name_ok(display_name);
update public.leagues set name = name where not public.name_ok(name);
