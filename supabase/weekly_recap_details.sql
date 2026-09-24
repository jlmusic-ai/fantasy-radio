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
