-- Existing player accounts are the founding cohort, regardless of picks.
-- Future profiles default to false. The hidden test account is not a player.
alter table public.profiles
  add column founding_member boolean not null default false;

update public.profiles
set founding_member = true
where not hide_from_leaderboards;
