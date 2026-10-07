-- 在 Supabase SQL Editor 运行。先登录一次网站，再把你的 auth.users.id 加入 site_creators。
create table if not exists public.site_creators (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.trips (
  slug text primary key,
  title text not null,
  subtitle text,
  summary text,
  cover_url text,
  date_label text,
  duration_label text,
  status text default 'TRIP',
  places_count text,
  budget_label text,
  display_order int not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.places (
  id bigint generated always as identity primary key,
  trip_slug text not null references public.trips(slug) on delete cascade,
  name text not null,
  label text,
  display_order int not null default 100,
  created_at timestamptz not null default now()
);

create table if not exists public.photos (
  id bigint generated always as identity primary key,
  trip_slug text not null references public.trips(slug) on delete cascade,
  image_url text not null,
  caption text,
  display_order int not null default 100,
  created_at timestamptz not null default now()
);

create table if not exists public.itinerary_days (
  id bigint generated always as identity primary key,
  trip_slug text not null references public.trips(slug) on delete cascade,
  day_label text not null,
  title text not null,
  body text,
  display_order int not null default 100,
  created_at timestamptz not null default now()
);

create table if not exists public.travel_logs (
  id bigint generated always as identity primary key,
  trip_slug text not null references public.trips(slug) on delete cascade,
  day_label text,
  entry_date date,
  title text not null,
  body text,
  display_order int not null default 100,
  created_at timestamptz not null default now()
);

create table if not exists public.expenses (
  id bigint generated always as identity primary key,
  trip_slug text not null references public.trips(slug) on delete cascade,
  category text not null,
  amount numeric not null default 0,
  currency text not null default '¥',
  display_order int not null default 100,
  created_at timestamptz not null default now()
);

alter table public.site_creators enable row level security;
alter table public.trips enable row level security;
alter table public.places enable row level security;
alter table public.photos enable row level security;
alter table public.itinerary_days enable row level security;
alter table public.travel_logs enable row level security;
alter table public.expenses enable row level security;

create or replace function public.is_site_creator()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.site_creators
    where user_id = auth.uid()
  );
$$;

drop policy if exists "Creators can read own creator row" on public.site_creators;
create policy "Creators can read own creator row"
on public.site_creators for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "Anyone can read trips" on public.trips;
create policy "Anyone can read trips" on public.trips for select to anon, authenticated using (true);
drop policy if exists "Creators manage trips" on public.trips;
create policy "Creators manage trips" on public.trips for all to authenticated using (public.is_site_creator()) with check (public.is_site_creator());

drop policy if exists "Anyone can read places" on public.places;
create policy "Anyone can read places" on public.places for select to anon, authenticated using (true);
drop policy if exists "Creators manage places" on public.places;
create policy "Creators manage places" on public.places for all to authenticated using (public.is_site_creator()) with check (public.is_site_creator());

drop policy if exists "Anyone can read photos" on public.photos;
create policy "Anyone can read photos" on public.photos for select to anon, authenticated using (true);
drop policy if exists "Creators manage photos" on public.photos;
create policy "Creators manage photos" on public.photos for all to authenticated using (public.is_site_creator()) with check (public.is_site_creator());

drop policy if exists "Anyone can read itinerary days" on public.itinerary_days;
create policy "Anyone can read itinerary days" on public.itinerary_days for select to anon, authenticated using (true);
drop policy if exists "Creators manage itinerary days" on public.itinerary_days;
create policy "Creators manage itinerary days" on public.itinerary_days for all to authenticated using (public.is_site_creator()) with check (public.is_site_creator());

drop policy if exists "Anyone can read travel logs" on public.travel_logs;
create policy "Anyone can read travel logs" on public.travel_logs for select to anon, authenticated using (true);
drop policy if exists "Creators manage travel logs" on public.travel_logs;
create policy "Creators manage travel logs" on public.travel_logs for all to authenticated using (public.is_site_creator()) with check (public.is_site_creator());

drop policy if exists "Anyone can read expenses" on public.expenses;
create policy "Anyone can read expenses" on public.expenses for select to anon, authenticated using (true);
drop policy if exists "Creators manage expenses" on public.expenses;
create policy "Creators manage expenses" on public.expenses for all to authenticated using (public.is_site_creator()) with check (public.is_site_creator());

insert into public.trips (slug, title, subtitle, summary, cover_url, date_label, duration_label, status, places_count, budget_label, display_order)
values (
  'japan',
  'Japan · 日本',
  'Tokyo · Kamakura · Suwa · Kyoto · Osaka',
  '东京、镰仓、诹访湖、京都、大阪的 8 天旅行。',
  'https://images.unsplash.com/photo-1490806843957-31f4c9a91c65?auto=format&fit=crop&w=1800&q=85',
  '2027.01',
  '8 DAYS / 7 NIGHTS',
  'UPCOMING TRIP',
  '5',
  '待记录',
  1
) on conflict (slug) do nothing;
