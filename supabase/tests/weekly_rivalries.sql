-- Run with an owner connection. All fixture data and helper functions roll back.
begin;
create temporary table rivalry_test_results (check_name text, passed boolean);

do $test$
declare
  source_sql text;
  before_fingerprint text;
  after_fingerprint text;
  participant_count integer;
  pair_count integer;
  trio_count integer;
  n integer;
  sample_week date;
begin
  -- Use the installed production function, replacing only its clock in a
  -- session-local helper so tests cannot activate future matchups early.
  source_sql := pg_get_functiondef('private.assign_due_rivalries()'::regprocedure);
  source_sql := replace(source_sql, 'private.assign_due_rivalries()',
    'pg_temp.test_assign_due_rivalries(test_now timestamptz)');
  source_sql := replace(source_sql, 'now()', 'test_now');
  execute source_sql;

  if exists (select 1 from public.weeks where id = date '2026-10-26') then
    raise exception 'Run this prelaunch test before October 26 fixtures exist';
  end if;
  select max(id) into sample_week from public.weeks where id < date '2026-10-26';
  insert into public.weeks(id,lock_at,season_start)
    values ('2026-10-26','2026-10-26 10:00:00+00','2026-10-05');
  insert into public.lineup_status_totals(week_id,user_id,allocated_points)
    select '2026-10-26',user_id,allocated_points
    from public.lineup_status_totals where week_id=sample_week;

  perform pg_temp.test_assign_due_rivalries('2026-10-19 10:00:00+00');
  if exists(select 1 from private.rivalry_assignment_weeks where week_id='2026-10-19') then
    raise exception 'Assigned before launch week';
  end if;
  perform pg_temp.test_assign_due_rivalries('2026-10-26 09:59:59+00');
  if exists(select 1 from private.rivalry_assignment_weeks where week_id='2026-10-26') then
    raise exception 'Assigned before Monday 6 a.m. Eastern';
  end if;
  insert into rivalry_test_results values ('launch and prelock gates',true);

  perform pg_temp.test_assign_due_rivalries('2026-10-26 10:00:00+00');
  select count(*) into participant_count from public.lineup_status_totals l
    join public.profiles p on p.id=l.user_id
    where l.week_id='2026-10-26' and l.allocated_points=100 and not p.hide_from_leaderboards;
  if participant_count <> (select count(*) from public.weekly_rivalries where week_id='2026-10-26') then
    raise exception 'Active player count mismatch';
  end if;
  if exists(select 1 from public.weekly_rivalries r
    join public.profiles p on p.id=r.user_id
    join public.lineup_status_totals l on l.week_id=r.week_id and l.user_id=r.user_id
    where r.week_id='2026-10-26' and (p.hide_from_leaderboards or l.allocated_points<>100)) then
    raise exception 'Hidden or incomplete player included';
  end if;
  select count(*) filter(where size=2),count(*) filter(where size=3)
    into pair_count,trio_count
    from (select count(*) size from public.weekly_rivalries where week_id='2026-10-26' group by rivalry_number)g;
  if pair_count <> (participant_count - (participant_count % 2)*3)/2
    or trio_count <> participant_count % 2 then
    raise exception 'Pair/trio shape mismatch';
  end if;
  insert into rivalry_test_results values
    (format('%s active players: %s pairs and %s trio; hidden/incomplete excluded',participant_count,pair_count,trio_count),true);

  select md5(string_agg(user_id::text || ':' || rivalry_number,',' order by user_id))
    into before_fingerprint from public.weekly_rivalries where week_id='2026-10-26';
  perform pg_temp.test_assign_due_rivalries('2026-10-26 10:01:00+00');
  select md5(string_agg(user_id::text || ':' || rivalry_number,',' order by user_id))
    into after_fingerprint from public.weekly_rivalries where week_id='2026-10-26';
  if before_fingerprint is distinct from after_fingerprint then
    raise exception 'Repeated scheduler changed saved pairings';
  end if;
  insert into rivalry_test_results values ('repeat scheduler preserves matchups',true);

  -- Re-run the installed grouping path for empty, singleton, odd and even fields.
  for n in 0..6 loop
    delete from public.weekly_rivalries where week_id='2026-10-26';
    delete from private.rivalry_assignment_weeks where week_id='2026-10-26';
    delete from public.lineup_status_totals where week_id='2026-10-26';
    insert into public.lineup_status_totals(week_id,user_id,allocated_points)
      select '2026-10-26',id,100 from public.profiles
      where not hide_from_leaderboards order by id limit n;
    perform pg_temp.test_assign_due_rivalries('2026-10-26 10:00:00+00');
    if (select count(*) from public.weekly_rivalries where week_id='2026-10-26') <> (case when n<2 then 0 else n end) then
      raise exception 'Wrong participant count for %',n;
    end if;
    if exists(select 1 from public.weekly_rivalries where week_id='2026-10-26'
      group by rivalry_number having count(*) not in (2,3)) then
      raise exception 'Invalid group size for %',n;
    end if;
    if (select count(*) from (select rivalry_number from public.weekly_rivalries
      where week_id='2026-10-26' group by rivalry_number having count(*)=3)g)
      <> (case when n>=3 then n%2 else 0 end) then
      raise exception 'Wrong number of trios for %',n;
    end if;
  end loop;
  insert into rivalry_test_results values ('0 through 6 players: no singleton and at most one trio',true);
end;
$test$;
select * from rivalry_test_results;
rollback;
