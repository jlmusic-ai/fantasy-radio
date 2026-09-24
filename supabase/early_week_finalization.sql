-- Both normal and early finalization use one atomic snapshot path.
create or replace function private.complete_week_scores(p_week date)
returns integer language plpgsql security definer set search_path=''
as $function$
declare
  awarded integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('mooberball_finalize_closed_weeks')
  );
  if not exists (select 1 from public.weeks where id=p_week) then
    raise exception 'This week has no scores to finalize';
  end if;
  insert into public.finalized_weeks(week_id,scores_finalized_at)
  values(p_week,now())
  on conflict(week_id) do update
    set scores_finalized_at=excluded.scores_finalized_at
    where public.finalized_weeks.scores_finalized_at is null;
  if not found then
    raise exception 'Scores have already been finalized';
  end if;
  insert into public.weekly_score_snapshots(week_id,user_id,score)
  select c.week_id,c.user_id,c.score
  from public.calculated_weekly_scores c where c.week_id=p_week
  on conflict(week_id,user_id) do update
    set score=excluded.score,finalized_at=now();
  get diagnostics awarded=row_count;
  return awarded;
end
$function$;
revoke all on function private.complete_week_scores(date) from public,anon,authenticated;

create or replace function public.finalize_week_scores(p_week date)
returns integer language plpgsql security definer set search_path=''
as $function$
declare
  current_monday date;
begin
  if (select auth.uid()) is null or not public.is_commissioner() then
    raise exception 'Commissioner access required' using errcode='42501';
  end if;
  current_monday:=(now() at time zone 'America/New_York')::date
    -(extract(isodow from now() at time zone 'America/New_York')::integer-1);
  if p_week<>current_monday then
    raise exception 'Only the current broadcast week can be finalized';
  end if;
  if now()<(((p_week+4)::timestamp+interval '17 hours')
      at time zone 'America/New_York') then
    raise exception 'Finalize after Friday at 5:00 p.m. Eastern';
  end if;
  return private.complete_week_scores(p_week);
end
$function$;
revoke all on function public.finalize_week_scores(date) from public,anon;
grant execute on function public.finalize_week_scores(date) to authenticated;

-- Explicit override: only the current broadcast week, after its lineup locks.
-- The next picking week still opens on Friday at 5 p.m. Eastern.
create or replace function public.finalize_week_scores_early(p_week date)
returns integer language plpgsql security definer set search_path=''
as $function$
declare
  current_monday date;
  lineup_lock timestamptz;
begin
  if (select auth.uid()) is null or not public.is_commissioner() then
    raise exception 'Commissioner access required' using errcode='42501';
  end if;
  current_monday:=(now() at time zone 'America/New_York')::date
    -(extract(isodow from now() at time zone 'America/New_York')::integer-1);
  if p_week<>current_monday then
    raise exception 'Only the current broadcast week can be finalized';
  end if;
  select lock_at into lineup_lock from public.weeks where id=p_week;
  if lineup_lock is null then
    raise exception 'This week has no scores to finalize';
  end if;
  if now()<lineup_lock then
    raise exception 'Wait until this week’s picks are locked';
  end if;
  if now()>=(((p_week+4)::timestamp+interval '17 hours')
      at time zone 'America/New_York') then
    raise exception 'Use regular finalization after Friday at 5:00 p.m. Eastern';
  end if;
  return private.complete_week_scores(p_week);
end
$function$;
revoke all on function public.finalize_week_scores_early(date) from public,anon;
grant execute on function public.finalize_week_scores_early(date) to authenticated;
