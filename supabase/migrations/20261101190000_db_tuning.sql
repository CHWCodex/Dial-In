-- Same rules, faster: evaluate auth.uid() once per query instead of once per row (Supabase advisor 0003).
alter policy "read own results" on public.daily_results using (user_id = (select auth.uid()));
alter policy "read own profile" on public.profiles using (user_id = (select auth.uid()));
alter policy "own save: read" on public.player_saves using (user_id = (select auth.uid()));
alter policy "own save: insert" on public.player_saves with check (user_id = (select auth.uid()));
alter policy "own save: update" on public.player_saves using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
alter policy "rooms: update" on public.mp_docs using (owner = (select auth.uid())) with check (owner = (select auth.uid()));
alter policy "rooms: insert" on public.mp_docs with check (
  owner = (select auth.uid())
  and (path = 'rooms/' || room || '/players/' || (select auth.uid())::text or path = 'rooms/' || room));
alter policy "rooms: delete" on public.mp_docs using (
  owner = (select auth.uid())
  or exists (select 1 from public.mp_docs r where r.path = 'rooms/' || mp_docs.room and r.owner = (select auth.uid())));

-- Index the purchases foreign key (advisor 0001).
create index if not exists purchases_user_id on public.purchases (user_id);

-- Pin search_path on the helper functions (advisor 0011).
alter function public.clean_name(text) set search_path = public;
alter function public.score_guess(public.questions, numeric) set search_path = public;
alter function public.touch_updated_at() set search_path = public;
alter function public.uk_today() set search_path = public;
