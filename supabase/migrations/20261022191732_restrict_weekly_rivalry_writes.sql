-- Only the internal scheduler may change the saved matchups.
-- Revoke default grants as RLS does not protect TRUNCATE.
revoke all on public.weekly_rivalries from public, anon, authenticated;
grant select on public.weekly_rivalries to authenticated;

alter table private.rivalry_assignment_weeks enable row level security;
revoke all on private.rivalry_assignment_weeks from public, anon, authenticated;
