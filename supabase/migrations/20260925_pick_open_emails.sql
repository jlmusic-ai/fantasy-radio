-- Private preferences apply to every Mooberball email type.
create table if not exists public.email_opt_outs (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  unsubscribed_at timestamptz not null default now()
);
alter table public.email_opt_outs enable row level security;
revoke all on public.email_opt_outs from public, anon, authenticated;
grant select, insert on public.email_opt_outs to service_role;

create table if not exists public.pick_open_email_sends (
  week_id date not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','sent')),
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  primary key (week_id,user_id)
);
alter table public.pick_open_email_sends enable row level security;
revoke all on public.pick_open_email_sends from public, anon, authenticated;
grant select, insert, update, delete on public.pick_open_email_sends to service_role;

create or replace function public.unsubscribe_player_emails(p_user_id uuid)
returns void language plpgsql security definer set search_path=''
as $function$
begin
  insert into public.email_opt_outs(user_id) values(p_user_id)
    on conflict(user_id) do nothing;
  update public.pick_reminder_sends set status='sent'
    where user_id=p_user_id and status='pending';
  update public.pick_open_email_sends set status='sent'
    where user_id=p_user_id and status='pending';
  update public.week_result_email_sends set status='sent', claimed_at=null
    where user_id=p_user_id and status in ('pending','processing');
end
$function$;
revoke all on function public.unsubscribe_player_emails(uuid) from public, anon, authenticated;
grant execute on function public.unsubscribe_player_emails(uuid) to service_role;

-- Existing finalized weeks can still be retried, but opted-out players cannot be claimed.
create or replace function public.claim_week_result_emails(p_week date, p_limit integer default 100)
returns table(user_id uuid,email text,username text,score bigint,place integer,tied boolean)
language plpgsql security definer set search_path=''
as $function$
begin
  if p_limit not between 1 and 100 then raise exception 'Invalid batch size'; end if;
  return query
  with selected as (
    select e.week_id,e.user_id from public.week_result_email_sends e
    where e.week_id=p_week
      and not exists(select 1 from public.email_opt_outs o where o.user_id=e.user_id)
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
  from claimed c join auth.users u on u.id=c.user_id
  join public.profiles p on p.id=c.user_id
  order by c.place,c.user_id;
end
$function$;
revoke all on function public.claim_week_result_emails(date,integer) from public,anon,authenticated;
grant execute on function public.claim_week_result_emails(date,integer) to service_role;
