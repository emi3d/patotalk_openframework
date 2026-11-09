create table if not exists situ_users (
  user_id text primary key,
  streak integer not null default 0,
  last_active_date date
);

create table if not exists situ_attempts (
  id bigint generated always as identity primary key,
  user_id text not null references situ_users (user_id) on delete cascade,
  situation_id text not null,
  score double precision not null,
  completed boolean not null default false,
  objectives_met text[] not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists situ_attempts_user_idx on situ_attempts (user_id, created_at desc);

create or replace view situ_progress_summary as
  select user_id, situation_id, count(*) as attempts, max(score) as best_score, bool_or(completed) as completed
  from situ_attempts
  group by user_id, situation_id;
