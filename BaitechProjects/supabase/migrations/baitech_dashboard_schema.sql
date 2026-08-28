-- BaiTech Projects Dashboard schema (prefixed bt_ to coexist with other tables)
-- Applied to Supabase project srobzqlzuzextpchdmul as migration
-- "baitech_dashboard_schema" on 2026-07-02.

create table if not exists bt_members (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  role text not null check (role in ('boss','developer')),
  phone text,
  avatar_color text default '#37B6E9',
  created_at timestamptz not null default now()
);

create table if not exists bt_projects (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  status text not null default 'todo' check (status in ('todo','in_progress','done')),
  assignee_id uuid references bt_members(id) on delete set null,
  created_by uuid references bt_members(id) on delete set null,
  deadline timestamptz,
  cover_url text,
  github_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists bt_photos (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references bt_projects(id) on delete cascade,
  url text not null,
  created_at timestamptz not null default now()
);

create table if not exists bt_comments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references bt_projects(id) on delete cascade,
  author_id uuid references bt_members(id) on delete set null,
  body text not null,
  created_at timestamptz not null default now()
);

create table if not exists bt_activity (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references bt_projects(id) on delete cascade,
  actor_id uuid references bt_members(id) on delete set null,
  action text not null,
  detail text,
  created_at timestamptz not null default now()
);

create or replace function bt_touch_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  if new.status = 'done' and old.status is distinct from 'done' then
    new.completed_at := now();
  end if;
  if new.status <> 'done' then
    new.completed_at := null;
  end if;
  return new;
end $$;

drop trigger if exists trg_bt_projects_touch on bt_projects;
create trigger trg_bt_projects_touch before update on bt_projects
  for each row execute function bt_touch_updated_at();

alter table bt_members enable row level security;
alter table bt_projects enable row level security;
alter table bt_photos enable row level security;
alter table bt_comments enable row level security;
alter table bt_activity enable row level security;

create policy bt_members_all on bt_members for all using (true) with check (true);
create policy bt_projects_all on bt_projects for all using (true) with check (true);
create policy bt_photos_all on bt_photos for all using (true) with check (true);
create policy bt_comments_all on bt_comments for all using (true) with check (true);
create policy bt_activity_all on bt_activity for all using (true) with check (true);

insert into storage.buckets (id, name, public)
values ('bt-photos', 'bt-photos', true)
on conflict (id) do nothing;

create policy bt_photos_storage_read on storage.objects for select using (bucket_id = 'bt-photos');
create policy bt_photos_storage_insert on storage.objects for insert with check (bucket_id = 'bt-photos');
create policy bt_photos_storage_delete on storage.objects for delete using (bucket_id = 'bt-photos');

insert into bt_members (name, role, phone, avatar_color) values
  ('Boss', 'boss', null, '#4B4CED'),
  ('Akhad', 'developer', null, '#37B6E9'),
  ('Ruslan', 'developer', null, '#22C55E')
on conflict (name) do nothing;
