-- Run in Supabase SQL Editor. Categories are illustrative; edit before launch.
create extension if not exists pgcrypto;
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
create policy categories_admin on categories for all to authenticated using(is_commissioner()) with check(is_commissioner());
create policy weeks_read on weeks for select to authenticated using(true);
create policy weeks_admin on weeks for all to authenticated using(is_commissioner()) with check(is_commissioner());
create policy picks_read on picks for select to authenticated using(true);
create policy birthday_predictions_read on birthday_predictions for select to authenticated using(true);
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
create or replace view public.weekly_lineup_status
with (security_invoker=true) as
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
