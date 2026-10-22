-- Assign stable weekly rivalries from complete lineups after the Monday lock.
create table public.weekly_rivalries (
  week_id date not null references public.weeks(id) on delete cascade,
  rivalry_number integer not null check (rivalry_number > 0),
  user_id uuid not null references public.profiles(id) on delete cascade,
  assigned_at timestamptz not null default now(),
  primary key (week_id, user_id)
);

create index weekly_rivalries_group_idx
  on public.weekly_rivalries (week_id, rivalry_number);

alter table public.weekly_rivalries enable row level security;
grant select on public.weekly_rivalries to authenticated;
create policy "Players can browse weekly rivalries"
  on public.weekly_rivalries for select to authenticated
  using ((select auth.uid()) is not null);

create table private.rivalry_assignment_weeks (
  week_id date primary key references public.weeks(id) on delete cascade,
  assigned_at timestamptz not null default now(),
  participant_count integer not null check (participant_count >= 0)
);

create function private.assign_due_rivalries()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_week date;
  participants integer;
begin
  -- The function can run every minute: only the current Pittsburgh week is eligible.
  target_week := (now() at time zone 'America/New_York')::date;
  target_week := target_week - (extract(isodow from target_week)::integer - 1);
  if target_week < date '2026-10-26' then return; end if;

  -- A session-level race cannot create duplicate or different groups.
  perform pg_catalog.pg_advisory_xact_lock(261026);
  if exists (select 1 from private.rivalry_assignment_weeks where week_id = target_week) then return; end if;
  if not exists (
    select 1 from public.weeks w
    where w.id = target_week
      and now() >= w.lock_at
      and now() >= ((w.id::timestamp + interval '6 hours') at time zone 'America/New_York')
  ) then return; end if;

  select count(*) into participants
  from public.lineup_status_totals l
  join public.profiles p on p.id = l.user_id
  where l.week_id = target_week
    and l.allocated_points = 100
    and p.hide_from_leaderboards = false;

  if participants >= 2 then
    insert into public.weekly_rivalries (week_id, rivalry_number, user_id)
    with shuffled as (
      select l.user_id,
        row_number() over (order by md5(target_week::text || ':' || l.user_id::text)) as rn
      from public.lineup_status_totals l
      join public.profiles p on p.id = l.user_id
      where l.week_id = target_week
        and l.allocated_points = 100
        and p.hide_from_leaderboards = false
    )
    select target_week,
      case when participants % 2 = 1 and rn > participants - 3
        then (participants - 3) / 2 + 1
        else ((rn + 1) / 2)::integer
      end,
      user_id
    from shuffled;
  end if;

  insert into private.rivalry_assignment_weeks (week_id, participant_count)
  values (target_week, participants);
end;
$$;

revoke all on function private.assign_due_rivalries() from public, anon, authenticated;

select cron.schedule(
  'mooberball-assign-weekly-rivalries',
  '* * * * *',
  'select private.assign_due_rivalries();'
);
