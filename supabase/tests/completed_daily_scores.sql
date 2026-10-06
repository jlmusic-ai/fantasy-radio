-- Integration check against an open broadcast week with unfinished events.
-- All simulated completion, reopening, weekly finalization, and email-queue
-- changes are rolled back; no results are published by this test.
begin;
do $test$
declare
  current_week date;
  commissioner_id uuid;
  initial_scores jsonb;
  reopened_scores jsonb;
  expected_base bigint;
  expected_bonus bigint;
  actual_birthday integer;
  initial_season jsonb;
begin
  current_week := (now() at time zone 'America/New_York')::date
    - (extract(isodow from now() at time zone 'America/New_York')::integer - 1);
  select id into commissioner_id from public.profiles
    where is_commissioner order by created_at limit 1;
  if commissioner_id is null then raise exception 'Commissioner fixture required'; end if;
  if exists(select 1 from public.finalized_weeks
    where week_id=current_week and scores_finalized_at is not null) then
    raise exception 'Run against an unfinished week';
  end if;
  if exists(select 1 from public.daily_scoring_status
    where scoring_date=(now() at time zone 'America/New_York')::date) then
    raise exception 'Run before today is completed';
  end if;
  perform set_config('request.jwt.claim.sub',commissioner_id::text,true);
  select jsonb_agg(jsonb_build_array(user_id,score) order by user_id)
    into initial_season from public.season_scores;
  select jsonb_agg(jsonb_build_array(user_id,score) order by user_id)
    into initial_scores from public.calculated_weekly_scores
    where week_id=current_week;
  select coalesce(sum(p.points*e.quantity),0) into expected_base
    from public.picks p join public.events e
      on e.week_id=p.week_id and e.category_id=p.category_id
    join public.categories c on c.id=e.category_id
    where p.week_id=current_week and c.scoring_type='allocation';

  perform public.set_today_scoring_complete(true);
  if (select jsonb_agg(jsonb_build_array(user_id,score) order by user_id)
      from public.season_scores) is distinct from initial_season then
    raise exception 'Daily completion published unfinished season scores';
  end if;
  if (select coalesce(sum(score),0) from public.calculated_weekly_scores
      where week_id=current_week) <> expected_base then
    raise exception 'Completing today did not publish its points';
  end if;
  perform public.set_today_scoring_complete(false);
  select jsonb_agg(jsonb_build_array(user_id,score) order by user_id)
    into reopened_scores from public.calculated_weekly_scores
    where week_id=current_week;
  if reopened_scores is distinct from initial_scores then
    raise exception 'Reopening today did not restore the published totals';
  end if;

  select coalesce(sum(e.quantity),0)::integer into actual_birthday
    from public.events e join public.categories c on c.id=e.category_id
    where e.week_id=current_week and c.scoring_type='closest_guess';
  select coalesce(sum(greatest(5,50-abs(bp.guess-actual_birthday)*2)),0)
    into expected_bonus from public.birthday_predictions bp
    where bp.week_id=current_week and exists (
      select 1 from public.picks p join public.categories c on c.id=p.category_id
      where p.user_id=bp.user_id and p.week_id=current_week
        and c.scoring_type='allocation'
    );
  perform private.complete_week_scores(current_week);
  if (select coalesce(sum(score),0) from public.weekly_score_snapshots
      where week_id=current_week) <> expected_base+expected_bonus then
    raise exception 'Weekly finalization omitted events or birthday bonus';
  end if;
  if exists (
    select 1 from public.season_scores s full join (
      select w.user_id,sum(w.score)::bigint as score
      from public.weekly_scores w join public.finalized_weeks f
        on f.week_id=w.week_id and f.scores_finalized_at is not null
      where w.week_id between date '2026-10-05' and date '2026-11-20'
      group by w.user_id
    ) expected using(user_id) where s.score is distinct from expected.score
  ) then
    raise exception 'Finalizing the week did not update season totals';
  end if;
  if exists(select 1 from public.weekly_scores w
      where w.week_id=current_week) and
      not exists(select 1 from public.season_player_stats where weeks_played>0) then
    raise exception 'Finalized season statistics were not published';
  end if;
end
$test$;
rollback;
