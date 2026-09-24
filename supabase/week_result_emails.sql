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
