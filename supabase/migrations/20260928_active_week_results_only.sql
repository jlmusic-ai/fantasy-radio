-- Rank and email only players whose 100-point lineups were submitted.
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

  insert into public.week_result_email_sends(week_id,user_id,score,place,tied)
  select p_week, ranked.user_id, ranked.score, ranked.place,
    ranked.tied_count>1
  from (
    select p.id as user_id, s.score,
      rank() over (order by s.score desc)::integer as place,
      count(*) over (partition by s.score) as tied_count
    from public.profiles p
    join public.weekly_score_snapshots s
      on s.week_id=p_week and s.user_id=p.id
    join public.lineup_status_totals lineup
      on lineup.week_id=p_week and lineup.user_id=p.id
      and lineup.allocated_points=100
    where p.created_at <= (
      select f.scores_finalized_at from public.finalized_weeks f
      where f.week_id=p_week
    ) and not p.hide_from_leaderboards
  ) ranked
  join auth.users u on u.id=ranked.user_id and u.email_confirmed_at is not null
  on conflict(week_id,user_id) do nothing;
  return awarded;
end
$function$;
