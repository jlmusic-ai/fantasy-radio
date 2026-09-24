-- Run in Supabase SQL Editor. Categories are illustrative; edit before launch.
create extension if not exists pgcrypto;
create schema if not exists private;
revoke all on schema private from public,anon,authenticated;
create table public.profiles (id uuid primary key references auth.users(id) on delete cascade, username text not null unique check(length(username) between 3 and 30), avatar_url text, is_commissioner boolean not null default false, created_at timestamptz not null default now());
create table public.categories (id uuid primary key default gen_random_uuid(), name text not null unique, description text not null default '', active boolean not null default true, scoring_type text not null default 'allocation' check(scoring_type in ('allocation','closest_guess')), display_order integer not null default 0);
create table public.weeks (id date primary key, lock_at timestamptz not null, season_start date not null);
create table public.picks (user_id uuid not null references public.profiles(id) on delete cascade, week_id date not null references public.weeks(id), category_id uuid not null references public.categories(id), points integer not null check(points between 0 and 25), primary key(user_id,week_id,category_id));
create table public.birthday_predictions (user_id uuid not null references public.profiles(id) on delete cascade, week_id date not null references public.weeks(id) on delete cascade, guess integer not null check(guess between 0 and 500), primary key(user_id,week_id));
create table public.events (id uuid primary key default gen_random_uuid(), week_id date not null references public.weeks(id), category_id uuid not null references public.categories(id), occurred_at timestamptz not null, quantity integer not null check(quantity between 1 and 100), note text not null default '', created_by uuid not null references public.profiles(id), created_at timestamptz not null default now());
create index events_week_category on public.events(week_id,category_id);
create index events_category_id on public.events(category_id);
create index events_created_by on public.events(created_by);
create index picks_week_user on public.picks(week_id,user_id);
create index picks_category_id on public.picks(category_id);
create index birthday_predictions_week_user on public.birthday_predictions(week_id,user_id);
create unique index profiles_username_lower_unique on public.profiles(lower(username));
create or replace function public.new_profile() returns trigger language plpgsql security definer set search_path='' as $$
declare chosen_username text;
begin
  chosen_username:=trim(new.raw_user_meta_data->>'username');
  if chosen_username is null or length(chosen_username) not between 3 and 30 then
    chosen_username:='player_'||left(replace(new.id::text,'-',''),20);
  end if;
  insert into public.profiles(id,username) values(new.id,chosen_username);
  return new;
end $$;
revoke all on function public.new_profile() from public,anon,authenticated;
create trigger create_profile after insert on auth.users for each row execute function public.new_profile();
create or replace function public.username_available(requested_username text)
returns boolean language sql stable security definer set search_path=''
as $$
  select length(trim(requested_username)) between 3 and 30
    and not exists(select 1 from public.profiles where lower(username)=lower(trim(requested_username)));
$$;
revoke all on function public.username_available(text) from public;
grant execute on function public.username_available(text) to anon,authenticated;
create or replace function public.is_commissioner() returns boolean language sql stable security definer set search_path=public as $$select exists(select 1 from profiles where id=auth.uid() and is_commissioner)$$;
revoke all on function public.is_commissioner() from public,anon;
grant execute on function public.is_commissioner() to authenticated;
-- Lineup validation is performed atomically by the submit_lineup function below.
create or replace function public.submit_lineup(p_week date,p_picks jsonb,p_birthday_guess integer) returns void language plpgsql security definer set search_path='' as $$
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
  if jsonb_typeof(p_picks)<>'array' or p_birthday_guess not between 0 and 500 then raise exception 'Invalid lineup'; end if;
  select count(*) into active_n from public.categories where active and scoring_type='allocation';
  select count(*),coalesce(sum((x->>'points')::integer),0) into input_n,total from jsonb_array_elements(p_picks) x;
  if input_n<>active_n or total<>100 or exists(select 1 from jsonb_array_elements(p_picks) x where (x->>'points')::integer not between 0 and 25) or (select count(distinct x->>'category_id') from jsonb_array_elements(p_picks) x)<>active_n or exists(select 1 from jsonb_array_elements(p_picks) x left join public.categories c on c.id=(x->>'category_id')::uuid and c.active and c.scoring_type='allocation' where c.id is null) then raise exception 'Invalid 100-point lineup'; end if;
  delete from public.picks where user_id=auth.uid() and week_id=p_week;
  insert into public.picks(user_id,week_id,category_id,points) select auth.uid(),p_week,(x->>'category_id')::uuid,(x->>'points')::integer from jsonb_array_elements(p_picks) x;
  insert into public.birthday_predictions(user_id,week_id,guess) values(auth.uid(),p_week,p_birthday_guess) on conflict(user_id,week_id) do update set guess=excluded.guess;
end $$;
create or replace view public.weekly_scores with (security_invoker=true) as with base as (select p.week_id,p.user_id,pr.username,pr.avatar_url,coalesce(sum(p.points*coalesce(e.quantity,0)),0)::bigint as base_score from picks p join profiles pr on pr.id=p.user_id join categories pc on pc.id=p.category_id and pc.scoring_type='allocation' left join (select week_id,category_id,sum(quantity) quantity from events group by week_id,category_id)e on e.week_id=p.week_id and e.category_id=p.category_id group by p.week_id,p.user_id,pr.username,pr.avatar_url), birthday_actual as (select e.week_id,coalesce(sum(e.quantity),0)::integer actual from events e join categories c on c.id=e.category_id where c.scoring_type='closest_guess' group by e.week_id) select b.week_id,b.user_id,b.username,(b.base_score+case when bp.guess is null or ba.actual is null then 0 else greatest(0,50-abs(bp.guess-ba.actual)*5) end)::bigint score,b.avatar_url from base b left join birthday_predictions bp on bp.week_id=b.week_id and bp.user_id=b.user_id left join birthday_actual ba on ba.week_id=b.week_id;
create or replace view public.season_scores with (security_invoker=true) as
select date '2026-10-05' as season_start,s.user_id,s.username,sum(s.score)::bigint score,s.avatar_url
from weekly_scores s
where s.week_id between date '2026-10-05' and date '2026-11-20'
group by s.user_id,s.username,s.avatar_url;
alter table profiles enable row level security; alter table categories enable row level security; alter table weeks enable row level security; alter table picks enable row level security; alter table birthday_predictions enable row level security; alter table events enable row level security;
create policy profiles_read on profiles for select to authenticated using(true);
create policy profiles_update on profiles for update to authenticated using(id=(select auth.uid())) with check(id=(select auth.uid()));
revoke update on public.profiles from authenticated;
grant update(username,avatar_url) on public.profiles to authenticated;
-- Commissioner profiles are granted manually in SQL; no client can grant itself commissioner status.
create policy categories_read on categories for select to authenticated using(true);
create policy categories_public_active_read on categories for select to anon using(active = true);
create policy categories_admin on categories for all to authenticated using(is_commissioner()) with check(is_commissioner());
create policy weeks_read on weeks for select to authenticated using(true);
create policy weeks_admin on weeks for all to authenticated using(is_commissioner()) with check(is_commissioner());
create policy picks_read on picks for select to authenticated using(user_id=(select auth.uid()) or exists(select 1 from public.weeks w where w.id=week_id and now()>=w.lock_at));
create policy birthday_predictions_read on birthday_predictions for select to authenticated using(user_id=(select auth.uid()) or exists(select 1 from public.weeks w where w.id=week_id and now()>=w.lock_at));
create policy events_read on events for select to authenticated using(true);
create policy events_admin on events for all to authenticated using(is_commissioner()) with check(is_commissioner());
revoke all on function public.submit_lineup(date,jsonb,integer) from public,anon;
grant execute on function public.submit_lineup(date,jsonb,integer) to authenticated;

create or replace function public.active_pick_window()
returns table(active_week date, closes_at timestamptz, is_locked boolean)
language sql
stable
security invoker
set search_path=''
as $function$
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
  select week_id, lock_at, now() >= lock_at
  from pick_window;
$function$;
revoke all on function public.active_pick_window() from public,anon;
grant execute on function public.active_pick_window() to authenticated;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('avatars','avatars',false,2097152,array['image/jpeg','image/png','image/webp']) on conflict(id) do update set public=excluded.public,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
create policy avatars_select_authenticated on storage.objects for select to authenticated using(bucket_id='avatars');
create policy avatars_insert_own on storage.objects for insert to authenticated with check(bucket_id='avatars' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy avatars_update_own on storage.objects for update to authenticated using(bucket_id='avatars' and (storage.foldername(name))[1]=(select auth.uid())::text) with check(bucket_id='avatars' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy avatars_delete_own on storage.objects for delete to authenticated using(bucket_id='avatars' and (storage.foldername(name))[1]=(select auth.uid())::text);

create or replace function public.admin_list_users()
returns table(id uuid,email text,username text,created_at timestamptz,is_commissioner boolean)
language plpgsql security definer set search_path=''
as $$
begin
  if not exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.is_commissioner) then
    raise exception 'Commissioner access required' using errcode='42501';
  end if;
  return query select u.id,u.email::text,p.username,u.created_at,p.is_commissioner
    from auth.users u join public.profiles p on p.id=u.id order by u.created_at desc;
end;
$$;
revoke all on function public.admin_list_users() from public,anon;
grant execute on function public.admin_list_users() to authenticated;

create or replace function public.admin_delete_user(target_user_id uuid)
returns void language plpgsql security definer set search_path=''
as $$
begin
  if not exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.is_commissioner) then
    raise exception 'Commissioner access required' using errcode='42501';
  end if;
  if target_user_id=(select auth.uid()) then raise exception 'You cannot delete your own account here'; end if;
  if exists(select 1 from public.profiles p where p.id=target_user_id and p.is_commissioner) then
    raise exception 'Commissioner accounts cannot be deleted here';
  end if;
  delete from storage.objects where bucket_id='avatars' and name like target_user_id::text||'/%';
  delete from auth.users where id=target_user_id;
  if not found then raise exception 'User not found'; end if;
end;
$$;
revoke all on function public.admin_delete_user(uuid) from public,anon;
grant execute on function public.admin_delete_user(uuid) to authenticated;


create or replace function public.adjust_weekly_occurrences(
  p_week date,
  p_category_id uuid,
  p_delta integer default null,
  p_target integer default null
)
returns integer
language plpgsql
security invoker
set search_path=''
as $function$
declare
  current_monday date;
  current_total integer;
  new_total integer;
begin
  if auth.uid() is null or not public.is_commissioner() then
    raise exception 'Commissioner access required' using errcode='42501';
  end if;
  if (p_delta is null) = (p_target is null) then
    raise exception 'Provide either a change or a total';
  end if;
  current_monday := (now() at time zone 'America/New_York')::date
    - (extract(isodow from now() at time zone 'America/New_York')::integer - 1);
  if p_week <> current_monday then
    raise exception 'Only the current broadcast week can be scored';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('mooberball_finalize_closed_weeks')
  );
  if exists (
    select 1 from public.finalized_weeks
    where week_id=p_week and scores_finalized_at is not null
  ) then
    raise exception 'Weekly scores are finalized';
  end if;
  if not exists (
    select 1 from public.categories
    where id=p_category_id and active
  ) then
    raise exception 'Unknown or inactive lineup topic';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_week::text || ':' || p_category_id::text, 0)
  );

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

  select coalesce(sum(quantity),0)::integer into current_total
  from public.events
  where week_id=p_week and category_id=p_category_id;

  new_total := case
    when p_target is not null then p_target
    else greatest(0,current_total+p_delta)
  end;
  if new_total not between 0 and 5000 then
    raise exception 'Occurrence total must be between 0 and 5000';
  end if;

  delete from public.events
  where week_id=p_week and category_id=p_category_id;

  if new_total>0 then
    insert into public.events(
      week_id,category_id,occurred_at,quantity,note,created_by
    )
    select
      p_week,
      p_category_id,
      now(),
      least(100,new_total-((part-1)*100)),
      'Set from Score this week',
      auth.uid()
    from generate_series(1,ceil(new_total/100.0)::integer) as part;
  end if;

  return new_total;
end;
$function$;
revoke all on function public.adjust_weekly_occurrences(date,uuid,integer,integer)
from public,anon;
grant execute on function public.adjust_weekly_occurrences(date,uuid,integer,integer)
to authenticated;

insert into categories(name,description,scoring_type,display_order) values ('Pittsburgh Scanner','A distinct qualifying scanner story','allocation',10),('A Florida story involving nudity','A distinct Florida story involving nudity','allocation',20),('Over 15 Mike McCarthy Meows in One Interview Clip','A qualifying interview clip containing more than 15 Mike McCarthy meows','allocation',30),('Something or someone sent to Tha’ Crossroads','A distinct instance of something or someone being sent to Tha’ Crossroads','allocation',40),('Listener Talkback','A distinct listener talkback played on air','allocation',50),('🎂 Bob’s Birthday Wishes 🎂','Guess how many times Bob will be wished a Happy Birthday this week.','closest_guess',60) on conflict(name) do nothing;


-- Compact summaries keep leaderboard payloads below the Data API row cap
-- when Mooberball grows to hundreds of players.
-- Only the total allocation status is visible while lineups are open.
create or replace view public.weekly_lineup_status
with (security_invoker=false) as
select week_id,user_id,sum(points)::integer allocated_points
from public.picks
group by week_id,user_id;

create or replace view public.season_player_stats
with (security_invoker=true) as
with season_weeks as (
  select week_id,user_id,score
  from public.weekly_scores
  where week_id between date '2026-10-05' and date '2026-11-20'
), numbered as (
  select
    week_id,
    user_id,
    score,
    week_id-((row_number() over(partition by user_id order by week_id))::integer*7) streak_group
  from season_weeks
), streaks as (
  select user_id,count(*)::integer streak_length
  from numbered
  group by user_id,streak_group
), longest_streaks as (
  select user_id,max(streak_length)::integer longest_streak
  from streaks
  group by user_id
), summaries as (
  select
    user_id,
    count(*)::integer weeks_played,
    max(score)::bigint highest_weekly_score,
    round(avg(score))::bigint average_weekly_score,
    (array_agg(week_id order by score desc,week_id asc))[1] best_week,
    count(*) filter(where score>=100)::integer hundred_point_weeks
  from season_weeks
  group by user_id
)
select
  summaries.user_id,
  summaries.weeks_played,
  longest_streaks.longest_streak,
  summaries.highest_weekly_score,
  summaries.average_weekly_score,
  summaries.best_week,
  summaries.hundred_point_weeks
from summaries
join longest_streaks using(user_id);

revoke all on public.weekly_lineup_status from anon;
revoke all on public.season_player_stats from anon;
grant select on public.weekly_lineup_status to authenticated;
grant select on public.season_player_stats to authenticated;


-- Freeze completed weeks so future topic edits cannot recalculate old scores.
create extension if not exists pg_cron;
create schema if not exists private;
revoke all on schema private from public,anon,authenticated;

create table public.finalized_weeks (
  week_id date primary key references public.weeks(id) on delete cascade,
  finalized_at timestamptz not null default now(),
  scores_finalized_at timestamptz
);

create table public.weekly_score_snapshots (
  week_id date not null references public.weeks(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  score bigint not null,
  finalized_at timestamptz not null default now(),
  primary key(week_id,user_id)
);
create index weekly_score_snapshots_user_week
  on public.weekly_score_snapshots(user_id,week_id);

alter table public.finalized_weeks enable row level security;
alter table public.weekly_score_snapshots enable row level security;
create policy finalized_weeks_read on public.finalized_weeks
  for select to authenticated using(true);
create policy weekly_score_snapshots_read on public.weekly_score_snapshots
  for select to authenticated using(true);
revoke insert,update,delete,truncate
  on public.finalized_weeks,public.weekly_score_snapshots
  from anon,authenticated;

create or replace view public.calculated_weekly_scores
with (security_invoker=true) as
with base as (
  select
    p.week_id,p.user_id,pr.username,pr.avatar_url,
    coalesce(sum(p.points*coalesce(e.quantity,0)),0)::bigint base_score
  from public.picks p
  join public.profiles pr on pr.id=p.user_id
  join public.categories pc
    on pc.id=p.category_id and pc.scoring_type='allocation'
  left join (
    select week_id,category_id,sum(quantity) quantity
    from public.events
    group by week_id,category_id
  ) e on e.week_id=p.week_id and e.category_id=p.category_id
  group by p.week_id,p.user_id,pr.username,pr.avatar_url
), birthday_actual as (
  select e.week_id,coalesce(sum(e.quantity),0)::integer actual
  from public.events e
  join public.categories c on c.id=e.category_id
  where c.scoring_type='closest_guess'
  group by e.week_id
)
select
  b.week_id,b.user_id,b.username,
  (
    b.base_score+
    case
      when bp.guess is null or not exists (
        select 1 from public.finalized_weeks f
        where f.week_id=b.week_id and f.scores_finalized_at is not null
      ) then 0
      else greatest(5,50-abs(bp.guess-coalesce(ba.actual,0))*2)
    end
  )::bigint score,
  b.avatar_url
from base b
left join public.birthday_predictions bp
  on bp.week_id=b.week_id and bp.user_id=b.user_id
left join birthday_actual ba on ba.week_id=b.week_id;

create or replace view public.weekly_scores
with (security_invoker=true) as
select c.week_id,c.user_id,c.username,c.score,c.avatar_url
from public.calculated_weekly_scores c
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
join public.profiles p on p.id=s.user_id
join public.finalized_weeks f on f.week_id=s.week_id
where f.scores_finalized_at is not null
  or s.week_id<>(now() at time zone 'America/New_York')::date
    -(extract(isodow from now() at time zone 'America/New_York')::integer-1);

grant select on public.calculated_weekly_scores to authenticated;
grant select on public.weekly_scores to authenticated;

create or replace function private.finalize_closed_weeks()
returns void
language plpgsql
security definer
set search_path=''
as $function$
declare
  local_now timestamp;
  current_monday date;
  active_week date;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('mooberball_finalize_closed_weeks')
  );
  local_now:=now() at time zone 'America/New_York';
  current_monday:=
    local_now::date-(extract(isodow from local_now)::integer-1);
  active_week:=
    current_monday+
    case
      when extract(isodow from local_now)>5
        or (
          extract(isodow from local_now)=5
          and local_now::time>=time '17:00'
        )
      then 7 else 0
    end;

  insert into public.weekly_score_snapshots(week_id,user_id,score)
  select c.week_id,c.user_id,c.score
  from public.calculated_weekly_scores c
  join public.weeks w on w.id=c.week_id
  where c.week_id<active_week
    and not exists (
      select 1 from public.finalized_weeks f where f.week_id=c.week_id
    )
  on conflict(week_id,user_id) do nothing;

  insert into public.finalized_weeks(week_id)
  select w.id from public.weeks w where w.id<active_week
  on conflict(week_id) do nothing;
end
$function$;
revoke all on function private.finalize_closed_weeks()
  from public,anon,authenticated;

create or replace function private.finalize_before_category_change()
returns trigger
language plpgsql
security definer
set search_path=''
as $function$
begin
  perform private.finalize_closed_weeks();
  return null;
end
$function$;
revoke all on function private.finalize_before_category_change()
  from public,anon,authenticated;

create trigger finalize_weeks_before_category_change
before update or delete on public.categories
for each statement
execute function private.finalize_before_category_change();

select cron.schedule(
  'mooberball-finalize-closed-weeks',
  '* * * * *',
  'select private.finalize_closed_weeks();'
);


-- Deleting a lineup topic retires it instead of removing historical data.
create or replace function private.archive_category_instead_of_delete()
returns trigger
language plpgsql
security definer
set search_path=''
as $function$
begin
  update public.categories set active=false where id=old.id;
  return null;
end
$function$;
revoke all on function private.archive_category_instead_of_delete()
  from public,anon,authenticated;

create trigger archive_category_instead_of_delete
before delete on public.categories
for each row
execute function private.archive_category_instead_of_delete();

-- Commissioner finalizes scores normally or uses the early override after picks lock.
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

create or replace function private.prevent_finalized_event_edits()
returns trigger language plpgsql security definer set search_path=''
as $function$
declare target_week date;
begin
  target_week:=case when tg_op='INSERT' then new.week_id else old.week_id end;
  if exists (
    select 1 from public.finalized_weeks
    where week_id=target_week
      and scores_finalized_at is not null
  ) then
    raise exception 'Weekly scores are finalized';
  end if;
  if tg_op='UPDATE' and new.week_id<>old.week_id and exists (
    select 1 from public.finalized_weeks
    where week_id=new.week_id and scores_finalized_at is not null
  ) then
    raise exception 'Weekly scores are finalized';
  end if;
  return case when tg_op='DELETE' then old else new end;
end
$function$;
revoke all on function private.prevent_finalized_event_edits()
from public,anon,authenticated;
create trigger prevent_finalized_event_edits
before insert or update or delete on public.events
for each row execute function private.prevent_finalized_event_edits();


-- Track whether the commissioner has finished scoring each Pittsburgh day.
-- A new Pittsburgh calendar date has no row and therefore starts incomplete.
create table public.daily_scoring_status (
  scoring_date date primary key,
  week_id date not null references public.weeks(id) on delete cascade,
  completed_at timestamptz not null default now(),
  completed_by uuid not null references public.profiles(id)
);
create index daily_scoring_status_week
  on public.daily_scoring_status(week_id,scoring_date);
alter table public.daily_scoring_status enable row level security;
create policy daily_scoring_status_read
  on public.daily_scoring_status
  for select to authenticated using(true);
revoke insert,update,delete,truncate
  on public.daily_scoring_status from anon,authenticated;

create or replace function public.today_scoring_status()
returns table(
  scoring_date date,
  week_id date,
  completed boolean,
  completed_at timestamptz
)
language sql stable security invoker set search_path=''
as $function$
  with today as (
    select (now() at time zone 'America/New_York')::date as scoring_date
  ), current_week as (
    select
      scoring_date,
      scoring_date
        -(extract(isodow from scoring_date)::integer-1) as week_id
    from today
  )
  select
    current_week.scoring_date,
    current_week.week_id,
    status.scoring_date is not null,
    status.completed_at
  from current_week
  left join public.daily_scoring_status status
    on status.scoring_date=current_week.scoring_date;
$function$;
revoke all on function public.today_scoring_status() from public,anon;
grant execute on function public.today_scoring_status() to authenticated;

create or replace function public.set_today_scoring_complete(p_complete boolean)
returns boolean
language plpgsql security definer set search_path=''
as $function$
declare
  today date;
  current_week date;
begin
  if (select auth.uid()) is null or not public.is_commissioner() then
    raise exception 'Commissioner access required' using errcode='42501';
  end if;
  today:=(now() at time zone 'America/New_York')::date;
  current_week:=today-(extract(isodow from today)::integer-1);
  if p_complete then
    if not exists(select 1 from public.weeks where id=current_week) then
      insert into public.weeks(id,lock_at,season_start)
      values(
        current_week,
        (current_week::timestamp+time '06:00') at time zone 'America/New_York',
        case
          when current_week between date '2026-10-05' and date '2026-11-20'
            then date '2026-10-05'
          else current_week
        end
      );
    end if;
    insert into public.daily_scoring_status(
      scoring_date,week_id,completed_at,completed_by
    )
    values(today,current_week,now(),(select auth.uid()))
    on conflict(scoring_date) do update
      set completed_at=excluded.completed_at,
          completed_by=excluded.completed_by;
  else
    delete from public.daily_scoring_status where scoring_date=today;
  end if;
  return p_complete;
end
$function$;
revoke all on function public.set_today_scoring_complete(boolean)
  from public,anon;
grant execute on function public.set_today_scoring_complete(boolean)
  to authenticated;


-- Keep Sunday pick reminders idempotent across cron retries and deployments.
create table public.pick_reminder_sends (
  week_id date not null references public.weeks(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending'
    check(status in ('pending','sent')),
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  primary key(week_id,user_id)
);
create index pick_reminder_sends_created_at
  on public.pick_reminder_sends(created_at);
alter table public.pick_reminder_sends enable row level security;
revoke all on public.pick_reminder_sends from anon,authenticated;
-- Preserve the exact topic labels and arithmetic shown in finalized score breakdowns.
create table if not exists public.weekly_score_details (
  week_id date not null references public.weeks(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  category_id uuid not null,
  topic_name text not null,
  scoring_type text not null check (scoring_type in ('allocation', 'closest_guess')),
  allocated_points integer not null default 0,
  occurrences integer not null default 0,
  earned bigint not null default 0,
  guess integer,
  primary key (week_id, user_id, category_id)
);

create index if not exists weekly_score_details_week_earned
  on public.weekly_score_details (week_id, scoring_type, earned desc);

alter table public.weekly_score_details enable row level security;
create policy weekly_score_details_read on public.weekly_score_details
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or exists (
      select 1 from public.weeks w
      where w.id = week_id and now() >= w.lock_at
    )
  );
revoke all on public.weekly_score_details from anon, authenticated;
grant select on public.weekly_score_details to authenticated;

create or replace function private.capture_weekly_score_details(p_week date)
returns void language plpgsql security definer set search_path = '' as $function$
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
  select bp.week_id, bp.user_id, c.id, c.name, 'closest_guess',
    coalesce(e.occurrences, 0)::integer,
    case when f.scores_finalized_at is null then 0
      else greatest(5, 50 - abs(bp.guess - coalesce(e.occurrences, 0)) * 2)
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
  where bp.week_id = p_week;
end
$function$;
revoke all on function private.capture_weekly_score_details(date)
  from public, anon, authenticated;

create or replace function private.capture_weekly_score_details_on_finalize()
returns trigger language plpgsql security definer set search_path = '' as $function$
begin
  perform private.capture_weekly_score_details(new.week_id);
  return new;
end
$function$;
revoke all on function private.capture_weekly_score_details_on_finalize()
  from public, anon, authenticated;

create trigger capture_weekly_score_details
after insert or update of scores_finalized_at on public.finalized_weeks
for each row execute function private.capture_weekly_score_details_on_finalize();

-- Existing weeks are reconstructed from the current event and topic data once.
do $backfill$
declare previous_week record;
begin
  for previous_week in select week_id from public.finalized_weeks loop
    perform private.capture_weekly_score_details(previous_week.week_id);
  end loop;
end
$backfill$;
-- Freeze each registered player's result at finalization and queue one email.
create table if not exists public.week_result_email_sends (
  week_id date not null references public.weeks(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  score bigint not null,
  place integer not null,
  tied boolean not null default false,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'sent')),
  claimed_at timestamptz,
  sent_at timestamptz,
  primary key (week_id,user_id)
);
create index if not exists week_result_email_sends_pending
  on public.week_result_email_sends (week_id,status,claimed_at);
alter table public.week_result_email_sends enable row level security;
revoke all on public.week_result_email_sends from public,anon,authenticated;
grant select,update on public.week_result_email_sends to service_role;

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
    )
  ) ranked
  join auth.users u on u.id=ranked.user_id and u.email_confirmed_at is not null
  on conflict(week_id,user_id) do nothing;
  return awarded;
end
$function$;
revoke all on function private.complete_week_scores(date)
  from public,anon,authenticated;

-- Only the server's service role may claim and acknowledge notification rows.
create or replace function public.claim_week_result_emails(p_week date, p_limit integer default 100)
returns table(user_id uuid,email text,username text,score bigint,place integer,tied boolean)
language plpgsql security definer set search_path=''
as $function$
begin
  if p_limit not between 1 and 100 then
    raise exception 'Invalid batch size';
  end if;
  return query
  with selected as (
    select e.week_id,e.user_id from public.week_result_email_sends e
    where e.week_id=p_week
      and (e.status='pending' or
        (e.status='processing' and e.claimed_at<now()-interval '30 minutes'))
    order by e.place,e.user_id
    limit p_limit for update skip locked
  ), claimed as (
    update public.week_result_email_sends e
    set status='processing',claimed_at=now()
    from selected s where e.week_id=s.week_id and e.user_id=s.user_id
    returning e.user_id,e.score,e.place,e.tied
  )
  select c.user_id,u.email::text,p.username,c.score,c.place,c.tied
  from claimed c
  join auth.users u on u.id=c.user_id
  join public.profiles p on p.id=c.user_id
  order by c.place,c.user_id;
end
$function$;
revoke all on function public.claim_week_result_emails(date,integer)
  from public,anon,authenticated;
grant execute on function public.claim_week_result_emails(date,integer)
  to service_role;

create or replace function public.complete_week_result_emails(
  p_week date,p_user_ids uuid[],p_sent boolean
)
returns integer language plpgsql security definer set search_path=''
as $function$
declare updated integer;
begin
  update public.week_result_email_sends e
  set status=case when p_sent then 'sent' else 'pending' end,
      sent_at=case when p_sent then now() else null end,
      claimed_at=null
  where e.week_id=p_week and e.user_id=any(p_user_ids)
    and e.status='processing';
  get diagnostics updated=row_count;
  return updated;
end
$function$;
revoke all on function public.complete_week_result_emails(date,uuid[],boolean)
  from public,anon,authenticated;
grant execute on function public.complete_week_result_emails(date,uuid[],boolean)
  to service_role;
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
