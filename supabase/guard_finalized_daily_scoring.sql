-- Do not reopen or rewrite daily scoring after the week is finalized.
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
