-- A finalized week is complete even if an individual day was not explicitly
-- marked done. Freeze those missing days while their event names still exist.
create or replace function private.capture_missing_finalized_days(p_week date)
returns void language plpgsql security definer set search_path=''
as $function$
begin
  insert into public.daily_scoring_status
    (scoring_date,week_id,completed_at,completed_by)
  select event_days.scoring_date,p_week,f.scores_finalized_at,event_days.completed_by
  from (
    select (e.occurred_at at time zone 'America/New_York')::date scoring_date,
      min(e.created_by::text)::uuid completed_by
    from public.events e where e.week_id=p_week
    group by (e.occurred_at at time zone 'America/New_York')::date
  ) event_days
  join public.finalized_weeks f on f.week_id=p_week
  where f.scores_finalized_at is not null
  on conflict (scoring_date) do nothing;

  insert into public.daily_scoring_lines
    (scoring_date,week_id,category_id,topic_name,scoring_type,quantity)
  select s.scoring_date,p_week,e.category_id,c.name,c.scoring_type,
    sum(e.quantity)::integer
  from public.daily_scoring_status s
  join public.events e on e.week_id=p_week
    and (e.occurred_at at time zone 'America/New_York')::date=s.scoring_date
  join public.categories c on c.id=e.category_id
  where s.week_id=p_week and not exists (
    select 1 from public.daily_scoring_lines l
    where l.scoring_date=s.scoring_date and l.category_id=e.category_id
  )
  group by s.scoring_date,e.category_id,c.name,c.scoring_type
  on conflict (scoring_date,category_id) do nothing;
end
$function$;
revoke all on function private.capture_missing_finalized_days(date)
  from public,anon,authenticated;

create or replace function private.capture_missing_finalized_days_on_finalize()
returns trigger language plpgsql security definer set search_path=''
as $function$
begin
  if new.scores_finalized_at is not null then
    perform private.capture_missing_finalized_days(new.week_id);
  end if;
  return new;
end
$function$;
revoke all on function private.capture_missing_finalized_days_on_finalize()
  from public,anon,authenticated;
create trigger capture_missing_finalized_days
after insert or update of scores_finalized_at on public.finalized_weeks
for each row execute function private.capture_missing_finalized_days_on_finalize();

-- Repair already finalized weeks, including the September 21 test week.
do $backfill$
declare finalized record;
begin
  for finalized in
    select week_id from public.finalized_weeks
    where scores_finalized_at is not null
  loop
    perform private.capture_missing_finalized_days(finalized.week_id);
  end loop;
end
$backfill$;
