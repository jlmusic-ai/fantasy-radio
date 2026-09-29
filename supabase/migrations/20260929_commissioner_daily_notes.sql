-- Notes belong to the completed Pittsburgh day, independently of score totals.
alter table public.daily_scoring_status
  add column if not exists commissioner_note text not null default '';

create or replace function public.save_today_scoring_note(
  p_note text,
  p_mark_complete boolean default false
)
returns void
language plpgsql security definer set search_path = ''
as $function$
declare
  today date := (now() at time zone 'America/New_York')::date;
  current_week date;
  clean_note text := pg_catalog.btrim(p_note);
begin
  if (select auth.uid()) is null or not public.is_commissioner() then
    raise exception 'Commissioner access required' using errcode = '42501';
  end if;
  if clean_note is null or pg_catalog.char_length(clean_note) > 2000 then
    raise exception 'Note must contain no more than 2000 characters';
  end if;
  current_week := today - (extract(isodow from today)::integer - 1);
  if p_mark_complete then
    -- Both operations share one transaction: a completed day always has its note.
    perform public.set_today_scoring_complete(true);
  end if;
  update public.daily_scoring_status
     set commissioner_note = clean_note
   where scoring_date = today and week_id = current_week;
  if not found then
    raise exception 'Mark today''s scoring complete before saving the note';
  end if;
end
$function$;

revoke all on function public.save_today_scoring_note(text, boolean)
  from public, anon;
grant execute on function public.save_today_scoring_note(text, boolean)
  to authenticated;
