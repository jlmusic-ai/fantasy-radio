-- Keep the test account's data for testing while excluding it from public rankings.
-- The flag belongs to a profile ID, so later username changes cannot undo it.
alter table public.profiles
  add column hide_from_leaderboards boolean not null default false;
update public.profiles set hide_from_leaderboards=true
where username='testaccount';

create or replace view public.weekly_scores
with (security_invoker=true) as
select c.week_id,c.user_id,c.username,c.score,c.avatar_url
from public.calculated_weekly_scores c
join public.profiles leaderboard_profile
  on leaderboard_profile.id=c.user_id and not leaderboard_profile.hide_from_leaderboards
where not exists (
  select 1 from public.finalized_weeks f where f.week_id=c.week_id
) or exists (
  select 1 from public.finalized_weeks f
  where f.week_id=c.week_id and f.scores_finalized_at is null
    and c.week_id=(now() at time zone 'America/New_York')::date
      -(extract(isodow from now() at time zone 'America/New_York')::integer-1)
)
union all
select s.week_id,s.user_id,p.username,s.score,p.avatar_url
from public.weekly_score_snapshots s
join public.profiles p on p.id=s.user_id and not p.hide_from_leaderboards
join public.finalized_weeks f on f.week_id=s.week_id
where f.scores_finalized_at is not null
  or s.week_id<>(now() at time zone 'America/New_York')::date
    -(extract(isodow from now() at time zone 'America/New_York')::integer-1);


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
    select p.id as user_id, coalesce(s.score,0)::bigint as score,
      rank() over (order by coalesce(s.score,0) desc)::integer as place,
      count(*) over (partition by coalesce(s.score,0)) as tied_count
    from public.profiles p
    left join public.weekly_score_snapshots s
      on s.week_id=p_week and s.user_id=p.id
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
