-- Score a missed broadcast on a later date in the same week. Existing today-only RPCs stay compatible.
-- Mutations keep the existing finalization lock, commissioner checks, and daily snapshot guards.
create or replace function public.adjust_show_occurrences(
  p_scoring_date date,p_category_id uuid,p_delta integer default null,p_target integer default null
)
returns integer language plpgsql security invoker set search_path=''
as $function$
declare
  today date;
  current_monday date;
  actual_today date;
  p_week date;
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
  actual_today:=(now() at time zone 'America/New_York')::date;
  current_monday:=actual_today-(extract(isodow from actual_today)::integer-1);
  if p_scoring_date is null or p_scoring_date<current_monday or p_scoring_date>actual_today then
    raise exception 'Choose today or an earlier show date in the current broadcast week';
  end if;
  today:=p_scoring_date;
  p_week:=current_monday;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('mooberball_finalize_closed_weeks')
  );
  if exists(select 1 from public.finalized_weeks
    where week_id=p_week and scores_finalized_at is not null) then
    raise exception 'Weekly scores are finalized';
  end if;
  if exists(select 1 from public.daily_scoring_status where scoring_date=today) then
    raise exception 'Undo the selected show completion before changing counts';
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
  new_today:=case when p_target is not null then p_target
    else greatest(0,current_total-previous_total+p_delta) end;
  new_total:=previous_total+new_today;
  if new_today not between 0 and 5000 or new_total not between 0 and 5000 then
    raise exception 'Show and weekly occurrence totals must be between 0 and 5000';
  end if;
  delete from public.events where week_id=p_week and category_id=p_category_id
    and (occurred_at at time zone 'America/New_York')::date=today;
  if new_today>0 then
    insert into public.events(week_id,category_id,occurred_at,quantity,note,created_by)
    select p_week,p_category_id,(today::timestamp+time '12:00') at time zone 'America/New_York',least(100,new_today-((part-1)*100)),
      'Scored show '||today::text,auth.uid()
    from pg_catalog.generate_series(1,pg_catalog.ceil(new_today/100.0)::integer) as part;
  end if;
  return new_today;
end
$function$;
revoke all on function public.adjust_show_occurrences(date,uuid,integer,integer)
  from public,anon;
grant execute on function public.adjust_show_occurrences(date,uuid,integer,integer)
  to authenticated;

create or replace function public.set_show_scoring_complete(p_scoring_date date,p_complete boolean)
returns boolean language plpgsql security definer set search_path=''
as $function$
declare today date; current_week date; actual_today date;
begin
  if (select auth.uid()) is null or not public.is_commissioner() then
    raise exception 'Commissioner access required' using errcode='42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('mooberball_finalize_closed_weeks')
  );
  actual_today:=(now() at time zone 'America/New_York')::date;
  current_week:=actual_today-(extract(isodow from actual_today)::integer-1);
  if p_scoring_date is null or p_scoring_date<current_week or p_scoring_date>actual_today then
    raise exception 'Choose today or an earlier show date in the current broadcast week';
  end if;
  if p_complete is null then raise exception 'Completion status is required'; end if;
  today:=p_scoring_date;
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
revoke all on function public.set_show_scoring_complete(date,boolean) from public,anon;
grant execute on function public.set_show_scoring_complete(date,boolean) to authenticated;

create or replace function public.save_show_scoring_note(
  p_scoring_date date, p_note text, p_mark_complete boolean default false
)
returns void language plpgsql security definer set search_path = ''
as $function$
declare
  today date := p_scoring_date;
  actual_today date := (now() at time zone 'America/New_York')::date;
  current_week date;
  clean_note text := pg_catalog.btrim(p_note);
begin
  if (select auth.uid()) is null or not public.is_commissioner() then
    raise exception 'Commissioner access required' using errcode = '42501';
  end if;
  if clean_note is null or pg_catalog.char_length(clean_note) > 2000 then
    raise exception 'Note must contain no more than 2000 characters';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('mooberball_finalize_closed_weeks'));
  current_week := actual_today - (extract(isodow from actual_today)::integer - 1);
  if today is null or today<current_week or today>actual_today then
    raise exception 'Choose today or an earlier show date in the current broadcast week';
  end if;
  if exists(select 1 from public.finalized_weeks where week_id=current_week and scores_finalized_at is not null) then
    raise exception 'Weekly scores are finalized';
  end if;
  if p_mark_complete then
    perform public.set_show_scoring_complete(today,true);
  end if;
  update public.daily_scoring_status
     set commissioner_note = clean_note
   where scoring_date = today and week_id = current_week;
  if not found then
    raise exception 'Mark the selected show complete before saving the note';
  end if;
end
$function$;
revoke all on function public.save_show_scoring_note(date, text, boolean) from public, anon;
grant execute on function public.save_show_scoring_note(date, text, boolean) to authenticated;
