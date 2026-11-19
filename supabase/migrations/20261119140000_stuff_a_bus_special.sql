-- Preserve the regular lineup and use the existing closest-guess slot for the
-- one-week Stuff a Bus special. Keep its official total outside daily scoring.
alter table public.weeks add constraint mooberball_november_season_break
  check (id <> date '2026-11-23') not valid;

insert into public.weeks (id, lock_at, season_start)
values (date '2026-11-30', timestamptz '2026-11-30 06:00 America/New_York', date '2026-11-30')
on conflict (id) do nothing;

create table public.stuff_a_bus_totals (
  week_id date primary key references public.weeks(id) check (week_id = date '2026-11-30'),
  buses integer not null check (buses between 0 and 500)
);
alter table public.stuff_a_bus_totals enable row level security;
revoke all on public.stuff_a_bus_totals from public, anon, authenticated;
grant select on public.stuff_a_bus_totals to authenticated, service_role;
create policy read_stuff_a_bus_total on public.stuff_a_bus_totals
  for select to authenticated using (
    (select public.is_commissioner()) or exists (
      select 1 from public.finalized_weeks f
      where f.week_id = stuff_a_bus_totals.week_id and f.scores_finalized_at is not null
    )
  );

create or replace function public.save_stuff_a_bus_total(p_buses integer)
returns void language plpgsql security definer set search_path=''
as $function$
begin
  if (select auth.uid()) is null or not (select public.is_commissioner()) then
    raise exception 'Commissioner access required' using errcode='42501';
  end if;
  if p_buses is null or p_buses not between 0 and 500 then
    raise exception 'Enter a whole number between 0 and 500';
  end if;
  if (now() at time zone 'America/New_York')::date < date '2026-12-04' then
    raise exception 'Enter the official total on December 4';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('mooberball_finalize_closed_weeks')
  );
  if exists (
    select 1 from public.finalized_weeks
    where week_id = date '2026-11-30' and scores_finalized_at is not null
  ) then
    raise exception 'Weekly scores are finalized';
  end if;
  insert into public.stuff_a_bus_totals(week_id, buses)
  values (date '2026-11-30', p_buses)
  on conflict (week_id) do update set buses = excluded.buses;
end
$function$;
revoke all on function public.save_stuff_a_bus_total(integer) from public, anon, authenticated;
grant execute on function public.save_stuff_a_bus_total(integer) to authenticated;

CREATE OR REPLACE FUNCTION public.active_pick_window()
 RETURNS TABLE(active_week date, closes_at timestamp with time zone, is_locked boolean)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  with local_clock as (
    select now() at time zone 'America/New_York' as local_now
  ),
  active as (
    select
      local_now::date
        - (extract(isodow from local_now)::integer - 1)
        + case
            when extract(isodow from local_now) > 5
              or (
                extract(isodow from local_now) = 5
                and local_now::time >= time '17:00'
              )
            then 7
            else 0
          end as week_id
    from local_clock
  ),
  pick_window as (
    select
      a.week_id,
      coalesce(
        w.lock_at,
        (a.week_id::timestamp + time '06:00')
          at time zone 'America/New_York'
      ) as lock_at
    from active a
    left join public.weeks w on w.id = a.week_id
  )
  select
    week_id,
    lock_at,
    (week_id >= date '2026-11-23' and week_id <> date '2026-11-30') or now() >= lock_at
  from pick_window;
$function$;
CREATE OR REPLACE FUNCTION public.submit_lineup(p_week date, p_picks jsonb, p_birthday_guess integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  lock_time timestamptz;
  local_now timestamp;
  current_monday date;
  active_week date;
  active_n integer;
  input_n integer;
  total integer;
begin
  if auth.uid() is null then raise exception 'Login required'; end if;
  if p_week is null or (p_week >= date '2026-11-23' and p_week <> date '2026-11-30') then
    raise exception 'Mooberball is on a season break';
  end if;
  perform private.finalize_closed_weeks();
  local_now := now() at time zone 'America/New_York';
  current_monday := local_now::date-(extract(isodow from local_now)::integer-1);
  active_week := current_monday+case when extract(isodow from local_now)>5 or (extract(isodow from local_now)=5 and local_now::time>=time '17:00') then 7 else 0 end;
  if p_week<>active_week then raise exception 'This is not the active picking week'; end if;
  insert into public.weeks(id,lock_at,season_start)
  values(
    p_week,
    (p_week::timestamp+time '06:00') at time zone 'America/New_York',
    case
      when p_week between date '2026-10-05' and date '2026-11-20'
        then date '2026-10-05'
      else p_week
    end
  )
  on conflict(id) do nothing;
  select lock_at into lock_time from public.weeks where id=p_week for update;
  if lock_time is null or now()>=lock_time then raise exception 'Lineup is locked'; end if;
  if jsonb_typeof(p_picks)<>'array' or p_birthday_guess is null or p_birthday_guess not between 0 and 500 then raise exception 'Invalid lineup'; end if;
  select count(*) into active_n from public.categories where active and scoring_type='allocation';
  select count(*),coalesce(sum((x->>'points')::integer),0) into input_n,total from jsonb_array_elements(p_picks) x;
  if input_n<>active_n or total<>100 or exists(select 1 from jsonb_array_elements(p_picks) x where (x->>'points')::integer not between 0 and 25) or (select count(distinct x->>'category_id') from jsonb_array_elements(p_picks) x)<>active_n or exists(select 1 from jsonb_array_elements(p_picks) x left join public.categories c on c.id=(x->>'category_id')::uuid and c.active and c.scoring_type='allocation' where c.id is null) then raise exception 'Invalid 100-point lineup'; end if;
  delete from public.picks where user_id=auth.uid() and week_id=p_week;
  insert into public.picks(user_id,week_id,category_id,points) select auth.uid(),p_week,(x->>'category_id')::uuid,(x->>'points')::integer from jsonb_array_elements(p_picks) x;
  insert into public.birthday_predictions(user_id,week_id,guess) values(auth.uid(),p_week,p_birthday_guess) on conflict(user_id,week_id) do update set guess=excluded.guess;
end $function$;

create or replace view public.calculated_weekly_scores
with (security_invoker=true) as
with base as (
  select p.week_id,p.user_id,pr.username,pr.avatar_url,
    coalesce(sum(p.points*coalesce(e.quantity,0)),0)::bigint as base_score
  from public.picks p
  join public.profiles pr on pr.id=p.user_id
  join public.categories pc
    on pc.id=p.category_id and pc.scoring_type='allocation'
  left join (
    select week_id,category_id,sum(quantity) as quantity
    from public.daily_scoring_lines
    where scoring_type='allocation'
    group by week_id,category_id
  ) e on e.week_id=p.week_id and e.category_id=p.category_id
  group by p.week_id,p.user_id,pr.username,pr.avatar_url
), birthday_actual as (
  select week_id,sum(quantity)::integer as actual
  from public.daily_scoring_lines
  where scoring_type='closest_guess'
  group by week_id
)
select b.week_id,b.user_id,b.username,
  (b.base_score+
    case when bp.guess is null or not exists (
      select 1 from public.finalized_weeks f
      where f.week_id=b.week_id and f.scores_finalized_at is not null
    ) then 0
    else greatest(5,50-abs(bp.guess-coalesce(bus.buses,ba.actual,0))*2)
    end
  )::bigint as score,
  b.avatar_url
from base b
left join public.birthday_predictions bp
  on bp.week_id=b.week_id and bp.user_id=b.user_id
left join birthday_actual ba on ba.week_id=b.week_id
left join public.stuff_a_bus_totals bus on bus.week_id=b.week_id;

create or replace view public.weekly_lineup_topics with (security_invoker=true) as
select distinct week_id,category_id,topic_name,scoring_type
from public.weekly_score_details
union
select distinct p.week_id,p.category_id,c.name,c.scoring_type
from public.picks p
join public.categories c on c.id=p.category_id
where not exists(select 1 from public.weekly_score_details d where d.week_id=p.week_id)
union
select distinct bp.week_id,c.id,
  case when bp.week_id=date '2026-11-30' then 'Stuff a Bus: Buses Stuffed' else c.name end,
  c.scoring_type
from public.birthday_predictions bp
join public.categories c on c.scoring_type='closest_guess'
where not exists(select 1 from public.weekly_score_details d where d.week_id=bp.week_id);

CREATE OR REPLACE FUNCTION private.capture_weekly_score_details(p_week date)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  delete from public.weekly_score_details where week_id = p_week;

  insert into public.weekly_score_details
    (week_id, user_id, category_id, topic_name, scoring_type,
     allocated_points, occurrences, earned)
  select p.week_id, p.user_id, p.category_id, c.name, 'allocation',
    p.points, coalesce(e.occurrences, 0)::integer,
    (p.points * coalesce(e.occurrences, 0))::bigint
  from public.picks p
  join public.categories c on c.id = p.category_id
  left join (
    select week_id, category_id, sum(quantity) occurrences
    from public.events where week_id = p_week group by week_id, category_id
  ) e on e.week_id = p.week_id and e.category_id = p.category_id
  where p.week_id = p_week;

  insert into public.weekly_score_details
    (week_id, user_id, category_id, topic_name, scoring_type,
     occurrences, earned, guess)
  select bp.week_id, bp.user_id, c.id,
    case when bp.week_id = date '2026-11-30' then 'Stuff a Bus: Buses Stuffed' else c.name end,
    'closest_guess', actual.total,
    case when f.scores_finalized_at is null then 0
      else greatest(5, 50 - abs(bp.guess - actual.total) * 2)
    end::bigint,
    bp.guess
  from public.birthday_predictions bp
  join public.categories c on c.scoring_type = 'closest_guess'
  join public.finalized_weeks f on f.week_id = bp.week_id
  left join (
    select ev.week_id, ev.category_id, sum(ev.quantity) occurrences
    from public.events ev where ev.week_id = p_week
    group by ev.week_id, ev.category_id
  ) e on e.week_id = bp.week_id and e.category_id = c.id
  left join public.stuff_a_bus_totals bus on bus.week_id = bp.week_id
  cross join lateral (select coalesce(bus.buses, e.occurrences, 0)::integer as total) actual
  where bp.week_id = p_week;
end
$function$;
CREATE OR REPLACE FUNCTION private.complete_week_scores(p_week date)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  awarded integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('mooberball_finalize_closed_weeks')
  );
  if not exists (select 1 from public.weeks where id=p_week) then
    raise exception 'This week has no scores to finalize';
  end if;
  if p_week = date '2026-11-30' and not exists (
    select 1 from public.stuff_a_bus_totals where week_id = p_week
  ) then
    raise exception 'Save the official Stuff a Bus total before finalizing';
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

create view public.stuff_a_bus_results with (security_invoker=true) as
select p.id as user_id,p.username,d.guess,b.buses,abs(d.guess-b.buses) as distance
from public.stuff_a_bus_totals b
join public.finalized_weeks f on f.week_id=b.week_id and f.scores_finalized_at is not null
join public.weekly_score_details d on d.week_id=b.week_id and d.scoring_type='closest_guess'
join public.profiles p on p.id=d.user_id and not p.hide_from_leaderboards
join public.weekly_lineup_status l on l.week_id=d.week_id and l.user_id=d.user_id and l.allocated_points=100
where d.guess is not null;
revoke all on public.stuff_a_bus_results from public, anon, authenticated;
grant select on public.stuff_a_bus_results to authenticated, service_role;
