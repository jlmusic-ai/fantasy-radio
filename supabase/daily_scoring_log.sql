-- Keep a public-to-players snapshot of each completed broadcast day's events.
-- Names and counts are copied when a day is marked complete, so later lineup
-- changes cannot rewrite its history.
create table if not exists public.daily_scoring_lines (
  scoring_date date not null references public.daily_scoring_status(scoring_date) on delete cascade,
  week_id date not null references public.weeks(id),
  category_id uuid not null,
  topic_name text not null,
  scoring_type text not null,
  quantity integer not null check (quantity > 0),
  primary key (scoring_date, category_id)
);
create index if not exists daily_scoring_lines_week_date
  on public.daily_scoring_lines(week_id, scoring_date);
alter table public.daily_scoring_lines enable row level security;
revoke all on public.daily_scoring_lines from anon, authenticated;
grant select on public.daily_scoring_lines to authenticated;
create policy daily_scoring_lines_read on public.daily_scoring_lines
  for select to authenticated using (true);

-- Preserve already completed days, using the event dates and names currently
-- recorded for the existing test week. Later edits cannot change these rows.
insert into public.daily_scoring_lines
  (scoring_date, week_id, category_id, topic_name, scoring_type, quantity)
select s.scoring_date, s.week_id, e.category_id, c.name, c.scoring_type,
  sum(e.quantity)::integer
from public.daily_scoring_status s
join public.events e on e.week_id=s.week_id
  and (e.occurred_at at time zone 'America/New_York')::date=s.scoring_date
join public.categories c on c.id=e.category_id
group by s.scoring_date,s.week_id,e.category_id,c.name,c.scoring_type
on conflict (scoring_date,category_id) do nothing;

create or replace function public.set_today_scoring_complete(p_complete boolean)
returns boolean language plpgsql security definer set search_path=''
as $function$
declare today date; current_week date;
begin
  if (select auth.uid()) is null or not public.is_commissioner() then
    raise exception 'Commissioner access required' using errcode='42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('mooberball_finalize_closed_weeks')
  );
  today:=(now() at time zone 'America/New_York')::date;
  current_week:=today-(extract(isodow from today)::integer-1);
  if exists(select 1 from public.finalized_weeks
    where week_id=current_week and scores_finalized_at is not null) then
    raise exception 'Weekly scores are finalized';
  end if;
  if p_complete then
    insert into public.weeks(id,lock_at,season_start)
    values(
      current_week,
      (current_week::timestamp+time '06:00') at time zone 'America/New_York',
      case when current_week between date '2026-10-05' and date '2026-11-20'
        then date '2026-10-05' else current_week end
    ) on conflict(id) do nothing;
    insert into public.daily_scoring_status(scoring_date,week_id,completed_at,completed_by)
    values(today,current_week,now(),(select auth.uid()))
    on conflict(scoring_date) do update
      set completed_at=excluded.completed_at,completed_by=excluded.completed_by;
    delete from public.daily_scoring_lines where scoring_date=today;
    insert into public.daily_scoring_lines
      (scoring_date,week_id,category_id,topic_name,scoring_type,quantity)
    select today,current_week,e.category_id,c.name,c.scoring_type,
      sum(e.quantity)::integer
    from public.events e
    join public.categories c on c.id=e.category_id
    where e.week_id=current_week
      and (e.occurred_at at time zone 'America/New_York')::date=today
    group by e.category_id,c.name,c.scoring_type;
  else
    delete from public.daily_scoring_status where scoring_date=today;
  end if;
  return p_complete;
end
$function$;
revoke all on function public.set_today_scoring_complete(boolean) from public,anon;
grant execute on function public.set_today_scoring_complete(boolean) to authenticated;

-- Completed days must be reopened before events for that date can change.
create or replace function private.prevent_completed_day_event_edits()
returns trigger language plpgsql security definer set search_path=''
as $function$
begin
  if (tg_op in ('UPDATE','DELETE') and exists (
    select 1 from public.daily_scoring_status s
    where s.scoring_date=(old.occurred_at at time zone 'America/New_York')::date
      and s.week_id=old.week_id
  )) or (tg_op in ('INSERT','UPDATE') and exists (
    select 1 from public.daily_scoring_status s
    where s.scoring_date=(new.occurred_at at time zone 'America/New_York')::date
      and s.week_id=new.week_id
  )) then
    raise exception 'Undo completed daily scoring before editing this day';
  end if;
  return case when tg_op='DELETE' then old else new end;
end
$function$;
revoke all on function private.prevent_completed_day_event_edits() from public,anon,authenticated;
create trigger prevent_completed_day_event_edits
before insert or update or delete on public.events
for each row execute function private.prevent_completed_day_event_edits();

-- Keep each day's events intact when the commissioner changes a weekly total.
-- A total cannot be reduced below occurrences already logged on prior days.
create or replace function public.adjust_weekly_occurrences(
  p_week date,p_category_id uuid,p_delta integer default null,p_target integer default null
)
returns integer language plpgsql security invoker set search_path=''
as $function$
declare
  today date;
  current_monday date;
  current_total integer;
  previous_total integer;
  new_total integer;
  new_today integer;
begin
  if auth.uid() is null or not public.is_commissioner() then
    raise exception 'Commissioner access required' using errcode='42501';
  end if;
  if (p_delta is null) = (p_target is null) then
    raise exception 'Provide either a change or a total';
  end if;
  today:=(now() at time zone 'America/New_York')::date;
  current_monday:=today-(extract(isodow from today)::integer-1);
  if p_week<>current_monday then
    raise exception 'Only the current broadcast week can be scored';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('mooberball_finalize_closed_weeks')
  );
  if exists(select 1 from public.finalized_weeks
    where week_id=p_week and scores_finalized_at is not null) then
    raise exception 'Weekly scores are finalized';
  end if;
  if exists(select 1 from public.daily_scoring_status where scoring_date=today) then
    raise exception 'Undo today''s completed scoring before changing counts';
  end if;
  if not exists(select 1 from public.categories
    where id=p_category_id and active) then
    raise exception 'Unknown or inactive lineup topic';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_week::text||':'||p_category_id::text,0)
  );
  insert into public.weeks(id,lock_at,season_start)
  values(
    p_week,(p_week::timestamp+time '06:00') at time zone 'America/New_York',
    case when p_week between date '2026-10-05' and date '2026-11-20'
      then date '2026-10-05' else p_week end
  ) on conflict(id) do nothing;

  select coalesce(sum(quantity),0)::integer,
    coalesce(sum(quantity) filter (where
      (occurred_at at time zone 'America/New_York')::date<>today),0)::integer
    into current_total,previous_total
  from public.events where week_id=p_week and category_id=p_category_id;
  new_total:=case when p_target is not null then p_target
    else greatest(0,current_total+p_delta) end;
  if new_total not between 0 and 5000 then
    raise exception 'Occurrence total must be between 0 and 5000';
  end if;
  if new_total<previous_total then
    raise exception 'This total cannot be lower than % occurrences from prior days',
      previous_total;
  end if;
  new_today:=new_total-previous_total;
  delete from public.events where week_id=p_week and category_id=p_category_id
    and (occurred_at at time zone 'America/New_York')::date=today;
  if new_today>0 then
    insert into public.events(week_id,category_id,occurred_at,quantity,note,created_by)
    select p_week,p_category_id,now(),least(100,new_today-((part-1)*100)),
      'Set from Score this week',auth.uid()
    from pg_catalog.generate_series(1,pg_catalog.ceil(new_today/100.0)::integer) as part;
  end if;
  return new_total;
end
$function$;
revoke all on function public.adjust_weekly_occurrences(date,uuid,integer,integer)
  from public,anon;
grant execute on function public.adjust_weekly_occurrences(date,uuid,integer,integer)
  to authenticated;
