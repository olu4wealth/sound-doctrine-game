-- Item 5b: Daily-Quest Realtime leaderboard (supabase.js is offline-safe).
-- Apply in the Supabase SQL editor, THEN paste your publishable anon key into the
-- gitignored `supabase.config.js` (never commit the key).

create table public.daily_scores (
  name      text       not null,
  date      date       not null,
  score     int        not null default 0 check (score >= 0),
  answered  int        not null default 0 check (answered between 0 and 10),
  streak    int        not null default 0 check (streak >= 0),
  acc       numeric(4,3) default 0 check (acc between 0 and 1),
  updated_at timestamptz default now(),
  primary key (name, date)
);
create index daily_scores_date_idx  on public.daily_scores (date desc);
create index daily_scores_score_idx on public.daily_scores (score desc);

alter table daily_scores enable row level security;
create policy "public read"   on public.daily_scores for select using (true);
create policy "submit score"  on public.daily_scores for insert with check (true);
create policy "improve score" on public.daily_scores for update using (true) with check (true);

-- A repeat Daily-Quest attempt on the same day only lands if it beats the
-- existing score; otherwise the row is left untouched.
create or replace function public.guard_best_daily()
returns trigger language plpgsql as $$
begin
  if TG_OP = 'UPDATE' and new.score <= old.score then return NULL; end if;
  return new;
end$$;
create trigger trg_guard_best_daily before insert or update
  on public.daily_scores for each row execute function public.guard_best_daily();