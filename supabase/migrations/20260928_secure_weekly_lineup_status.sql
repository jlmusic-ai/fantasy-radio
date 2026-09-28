-- Keep the only public lineup information in a read-only summary table.
-- Picks themselves remain hidden by their RLS policy until the lock.
create table public.lineup_status_totals (
  week_id date not null,
  user_id uuid not null,
  allocated_points integer not null,
  primary key (week_id,user_id)
);
alter table public.lineup_status_totals enable row level security;
create policy lineup_status_totals_read on public.lineup_status_totals
for select to authenticated using (true);
revoke all on public.lineup_status_totals from public,anon,authenticated;
grant select on public.lineup_status_totals to authenticated,service_role;

insert into public.lineup_status_totals(week_id,user_id,allocated_points)
select week_id,user_id,sum(points)::integer from public.picks group by week_id,user_id;

create or replace function private.refresh_weekly_lineup_status(p_week date,p_user uuid)
returns void language plpgsql security invoker set search_path='' as $$
declare total integer;
begin
  select sum(p.points)::integer into total
  from public.picks p where p.week_id=p_week and p.user_id=p_user;
  if total is null then
    delete from public.lineup_status_totals where week_id=p_week and user_id=p_user;
  else
    insert into public.lineup_status_totals(week_id,user_id,allocated_points)
    values (p_week,p_user,total)
    on conflict (week_id,user_id) do update
      set allocated_points=excluded.allocated_points;
  end if;
end $$;
revoke all on function private.refresh_weekly_lineup_status(date,uuid) from public,anon,authenticated;

create or replace function private.sync_weekly_lineup_status()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_op='INSERT' then
    perform private.refresh_weekly_lineup_status(new.week_id,new.user_id);
  elsif tg_op='UPDATE' then
    perform private.refresh_weekly_lineup_status(old.week_id,old.user_id);
    if (old.week_id,old.user_id) is distinct from (new.week_id,new.user_id) then
      perform private.refresh_weekly_lineup_status(new.week_id,new.user_id);
    end if;
  else
    perform private.refresh_weekly_lineup_status(old.week_id,old.user_id);
  end if;
  return null;
end $$;
revoke all on function private.sync_weekly_lineup_status() from public,anon,authenticated;
create trigger sync_weekly_lineup_status
after insert or update or delete on public.picks
for each row execute function private.sync_weekly_lineup_status();

create or replace view public.weekly_lineup_status
with (security_invoker=true) as
select week_id,user_id,allocated_points
from public.lineup_status_totals;
