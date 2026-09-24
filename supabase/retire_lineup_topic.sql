-- Remove an ordinary topic from future lineups without deleting score history.
create or replace function public.retire_lineup_topic(p_topic_id uuid)
returns void language plpgsql security definer set search_path=''
as $function$
declare
  topic public.categories%rowtype;
  current_monday date;
begin
  if (select auth.uid()) is null or not public.is_commissioner() then
    raise exception 'Commissioner access required' using errcode='42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('mooberball_finalize_closed_weeks')
  );
  select * into topic from public.categories
  where id=p_topic_id and active for update;
  if not found then
    raise exception 'This topic is already removed or does not exist';
  end if;
  if topic.scoring_type<>'allocation' then
    raise exception 'The birthday bonus is a built-in game rule and cannot be removed here';
  end if;
  if (select count(*) from public.categories
      where active and scoring_type='allocation')<=4 then
    raise exception 'Keep at least four point topics so players can allocate 100 points';
  end if;

  current_monday:=(now() at time zone 'America/New_York')::date
    -(extract(isodow from now() at time zone 'America/New_York')::integer-1);
  if exists (
    select 1 from public.picks p
    where p.category_id=p_topic_id and p.week_id>=current_monday
      and not exists (
        select 1 from public.finalized_weeks f
        where f.week_id=p.week_id and f.scores_finalized_at is not null
      )
  ) or exists (
    select 1 from public.events e
    where e.category_id=p_topic_id and e.week_id>=current_monday
      and not exists (
        select 1 from public.finalized_weeks f
        where f.week_id=e.week_id and f.scores_finalized_at is not null
      )
  ) then
    raise exception 'Finish scoring this week or wait until submitted picks are complete before removing this topic';
  end if;

  -- The existing category-change trigger freezes closed weeks first.
  update public.categories set active=false where id=p_topic_id;
end
$function$;
revoke all on function public.retire_lineup_topic(uuid)
  from public,anon;
grant execute on function public.retire_lineup_topic(uuid)
  to authenticated;
