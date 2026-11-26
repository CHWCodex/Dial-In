-- DIAL IN database structure (no data), read from production on 26 Nov 2026 for the staging copy and as a recovery record.
-- Part 1: tables, constraints, indexes, row-level security, policies, triggers. Functions are in part 2.
create extension if not exists pgcrypto with schema extensions;
create extension if not exists "uuid-ossp" with schema extensions;
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

create table public.acct_config (
  id integer default 1 not null,
  pepper text not null,
  cron_secret text not null,
  email_cutoff date not null
);
create table public.daily_results (
  user_id uuid not null,
  puzzle_date date not null,
  score integer not null,
  exact_count integer not null,
  guesses numeric[] not null,
  points integer[] not null,
  submitted_at timestamp with time zone default now() not null,
  bonus integer default 0 not null,
  off_board boolean default false not null
);
create table public.daily_sets (
  puzzle_date date not null,
  puzzle_no integer not null,
  question_ids text[] not null
);
create table public.device_codes (
  code_hash text not null,
  user_id uuid not null,
  expires_at timestamp with time zone not null,
  used_at timestamp with time zone
);
create table public.league_members (
  league_id uuid not null,
  user_id uuid not null,
  joined_at timestamp with time zone default now() not null
);
create table public.leagues (
  id uuid default gen_random_uuid() not null,
  code text not null,
  name text not null,
  owner uuid not null,
  created_at timestamp with time zone default now() not null
);
create table public.mp_docs (
  path text not null,
  room text not null,
  data jsonb not null,
  owner uuid default auth.uid() not null,
  updated_at timestamp with time zone default now() not null
);
create table public.net_events (
  net text not null,
  kind text not null,
  at timestamp with time zone default now() not null
);
create table public.net_plays (
  net text not null,
  puzzle_date date not null,
  user_id uuid not null,
  member boolean not null,
  at timestamp with time zone default now() not null
);
create table public.net_salts (
  day date not null,
  salt text not null
);
create table public.pin_accounts (
  user_id uuid not null,
  username text not null,
  pin_hash text not null,
  recovery_hash text not null,
  fails integer default 0 not null,
  lock_level integer default 0 not null,
  locked_until timestamp with time zone,
  created_at timestamp with time zone default now() not null,
  pin_changed_at timestamp with time zone default now() not null
);
create table public.player_saves (
  user_id uuid default auth.uid() not null,
  data jsonb not null,
  updated_at timestamp with time zone default now() not null
);
create table public.profiles (
  user_id uuid not null,
  display_name text not null,
  friend_code text not null,
  premium boolean default false not null,
  premium_at timestamp with time zone,
  created_at timestamp with time zone default now() not null,
  show_badge boolean default true not null
);
create table public.purchases (
  id text not null,
  user_id uuid,
  amount integer,
  currency text,
  created_at timestamp with time zone default now() not null,
  payment_intent text,
  refunded_at timestamp with time zone
);
create table public.push_config (
  id integer default 1 not null,
  cron_secret text default encode(extensions.gen_random_bytes(24), 'hex'::text) not null,
  vapid_public text,
  vapid_private text
);
create table public.push_subs (
  endpoint text not null,
  user_id uuid not null,
  p256dh text not null,
  auth text not null,
  created_at timestamp with time zone default now() not null,
  last_sent date,
  fails integer default 0 not null
);
create table public.questions (
  id text not null,
  question text not null,
  answer numeric not null,
  range_lo numeric,
  range_hi numeric,
  unit text default ''::text not null,
  category text not null,
  difficulty smallint not null,
  scoring text not null,
  explanation text,
  source text,
  geo text
);
alter table public.acct_config add constraint acct_config_pkey PRIMARY KEY (id);
alter table public.daily_results add constraint daily_results_pkey PRIMARY KEY (user_id, puzzle_date);
alter table public.daily_sets add constraint daily_sets_pkey PRIMARY KEY (puzzle_date);
alter table public.device_codes add constraint device_codes_pkey PRIMARY KEY (code_hash);
alter table public.league_members add constraint league_members_pkey PRIMARY KEY (league_id, user_id);
alter table public.leagues add constraint leagues_pkey PRIMARY KEY (id);
alter table public.mp_docs add constraint mp_docs_pkey PRIMARY KEY (path);
alter table public.net_plays add constraint net_plays_pkey PRIMARY KEY (net, puzzle_date, user_id);
alter table public.net_salts add constraint net_salts_pkey PRIMARY KEY (day);
alter table public.pin_accounts add constraint pin_accounts_pkey PRIMARY KEY (user_id);
alter table public.player_saves add constraint player_saves_pkey PRIMARY KEY (user_id);
alter table public.profiles add constraint profiles_pkey PRIMARY KEY (user_id);
alter table public.purchases add constraint purchases_pkey PRIMARY KEY (id);
alter table public.push_config add constraint push_config_pkey PRIMARY KEY (id);
alter table public.push_subs add constraint push_subs_pkey PRIMARY KEY (endpoint);
alter table public.questions add constraint questions_pkey PRIMARY KEY (id);
alter table public.leagues add constraint leagues_code_key UNIQUE (code);
alter table public.profiles add constraint profiles_friend_code_key UNIQUE (friend_code);
alter table public.acct_config add constraint acct_config_id_check CHECK ((id = 1));
alter table public.daily_results add constraint daily_results_score_check CHECK (((score >= 0) AND (score <= 15400)));
alter table public.daily_results add constraint daily_results_exact_count_check CHECK (((exact_count >= 0) AND (exact_count <= 7)));
alter table public.daily_results add constraint daily_results_bonus_check CHECK (((bonus >= 0) AND (bonus <= 8400)));
alter table public.daily_sets add constraint daily_sets_question_ids_check CHECK ((array_length(question_ids, 1) = 7));
alter table public.leagues add constraint leagues_name_check CHECK (((char_length(name) >= 1) AND (char_length(name) <= 24)));
alter table public.leagues add constraint leagues_code_check CHECK ((code ~ '^[A-Z2-9]{6}$'::text));
alter table public.mp_docs add constraint mp_docs_check CHECK (((path = ('rooms/'::text || room)) OR (path ~~ (('rooms/'::text || room) || '/players/%'::text))));
alter table public.mp_docs add constraint mp_docs_path_len CHECK (((char_length(path) <= 120) AND (char_length(room) <= 8)));
alter table public.mp_docs add constraint mp_docs_room_check CHECK ((room ~ '^\d{4}$'::text));
alter table public.mp_docs add constraint mp_docs_size CHECK ((pg_column_size(data) <= 65536));
alter table public.pin_accounts add constraint pin_accounts_username_check CHECK ((username ~ '^[a-z0-9_]{3,16}$'::text));
alter table public.player_saves add constraint player_saves_size CHECK ((pg_column_size(data) <= 524288));
alter table public.profiles add constraint profiles_friend_code_check CHECK ((friend_code ~ '^[A-Z0-9]{6}$'::text));
alter table public.push_config add constraint push_config_id_check CHECK ((id = 1));
alter table public.push_subs add constraint push_subs_auth_check CHECK (((char_length(auth) >= 10) AND (char_length(auth) <= 100)));
alter table public.push_subs add constraint push_subs_p256dh_check CHECK (((char_length(p256dh) >= 40) AND (char_length(p256dh) <= 200)));
alter table public.push_subs add constraint push_subs_endpoint_check CHECK (((endpoint ~ '^https://'::text) AND (char_length(endpoint) <= 1000)));
alter table public.questions add constraint questions_difficulty_check CHECK (((difficulty >= 1) AND (difficulty <= 3)));
alter table public.questions add constraint questions_scoring_check CHECK ((scoring = ANY (ARRAY['pct'::text, 'year'::text, 'abs'::text])));
alter table public.daily_results add constraint daily_results_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.daily_results add constraint daily_results_puzzle_date_fkey FOREIGN KEY (puzzle_date) REFERENCES public.daily_sets(puzzle_date);
alter table public.device_codes add constraint device_codes_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.league_members add constraint league_members_league_id_fkey FOREIGN KEY (league_id) REFERENCES public.leagues(id) ON DELETE CASCADE;
alter table public.league_members add constraint league_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.leagues add constraint leagues_owner_fkey FOREIGN KEY (owner) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.net_plays add constraint net_plays_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.pin_accounts add constraint pin_accounts_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.player_saves add constraint player_saves_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.profiles add constraint profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.purchases add constraint purchases_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table public.push_subs add constraint push_subs_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
CREATE UNIQUE INDEX pin_accounts_username ON public.pin_accounts USING btree (username);
CREATE INDEX device_codes_user_id_idx ON public.device_codes USING btree (user_id);
CREATE INDEX net_events_lookup ON public.net_events USING btree (net, kind, at);
CREATE INDEX net_plays_user_id_idx ON public.net_plays USING btree (user_id);
CREATE INDEX purchases_user_id ON public.purchases USING btree (user_id);
CREATE INDEX purchases_payment_intent ON public.purchases USING btree (payment_intent);
CREATE INDEX daily_results_day_score ON public.daily_results USING btree (puzzle_date, score DESC);
CREATE INDEX mp_docs_room ON public.mp_docs USING btree (room);
CREATE INDEX leagues_owner_idx ON public.leagues USING btree (owner);
CREATE INDEX league_members_user_idx ON public.league_members USING btree (user_id);
CREATE INDEX push_subs_user_idx ON public.push_subs USING btree (user_id);
alter table public.acct_config enable row level security;
alter table public.pin_accounts enable row level security;
alter table public.device_codes enable row level security;
alter table public.net_salts enable row level security;
alter table public.net_events enable row level security;
alter table public.net_plays enable row level security;
alter table public.purchases enable row level security;
alter table public.daily_results enable row level security;
alter table public.questions enable row level security;
alter table public.daily_sets enable row level security;
alter table public.player_saves enable row level security;
alter table public.mp_docs enable row level security;
alter table public.profiles enable row level security;
alter table public.leagues enable row level security;
alter table public.league_members enable row level security;
alter table public.push_config enable row level security;
alter table public.push_subs enable row level security;
create policy "read own results" on public.daily_results as PERMISSIVE for SELECT to authenticated using ((user_id = ( SELECT auth.uid() AS uid)));
create policy "own save: insert" on public.player_saves as PERMISSIVE for INSERT to authenticated with check ((user_id = ( SELECT auth.uid() AS uid)));
create policy "own save: read" on public.player_saves as PERMISSIVE for SELECT to authenticated using ((user_id = ( SELECT auth.uid() AS uid)));
create policy "own save: update" on public.player_saves as PERMISSIVE for UPDATE to authenticated using ((user_id = ( SELECT auth.uid() AS uid))) with check ((user_id = ( SELECT auth.uid() AS uid)));
create policy "rooms: delete" on public.mp_docs as PERMISSIVE for DELETE to authenticated using (((owner = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1 FROM public.mp_docs r WHERE ((r.path = ('rooms/'::text || mp_docs.room)) AND (r.owner = ( SELECT auth.uid() AS uid)))))));
create policy "rooms: insert" on public.mp_docs as PERMISSIVE for INSERT to authenticated with check (((owner = ( SELECT auth.uid() AS uid)) AND ((path = ((('rooms/'::text || room) || '/players/'::text) || (( SELECT auth.uid() AS uid))::text)) OR (path = ('rooms/'::text || room)))));
create policy "rooms: read" on public.mp_docs as PERMISSIVE for SELECT to authenticated using (true);
create policy "rooms: update" on public.mp_docs as PERMISSIVE for UPDATE to authenticated using ((owner = ( SELECT auth.uid() AS uid))) with check ((owner = ( SELECT auth.uid() AS uid)));
create policy "read own profile" on public.profiles as PERMISSIVE for SELECT to authenticated using ((user_id = ( SELECT auth.uid() AS uid)));
-- triggers are created after the functions (part 2)
