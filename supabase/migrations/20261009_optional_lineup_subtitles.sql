-- Fresh optional qualifications avoid restoring outdated hidden descriptions.
alter table public.categories
  add column lineup_subtitle text not null default ''
  check (char_length(lineup_subtitle) <= 1000);
