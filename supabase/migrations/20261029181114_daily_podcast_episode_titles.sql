-- Episode titles are display metadata; occurrence counts and historical scores stay frozen.
alter table public.daily_scoring_status
  add column if not exists podcast_episode_title text
  check (podcast_episode_title is null or char_length(podcast_episode_title) between 1 and 500);

-- Commissioners may change only this display column through the invoker RPC.
grant update(podcast_episode_title) on public.daily_scoring_status to authenticated;
create policy daily_scoring_episode_title_commissioner
  on public.daily_scoring_status for update to authenticated
  using (public.is_commissioner()) with check (public.is_commissioner());

create or replace function public.complete_show_with_episode(
  p_scoring_date date,p_note text,p_episode_title text default null
)
returns void language plpgsql security invoker set search_path=''
as $function$
begin
  if auth.uid() is null or not public.is_commissioner() then
    raise exception 'Commissioner access required' using errcode='42501';
  end if;
  -- Completion, counts, note, and title are committed together. Existing RPC
  -- enforces the selected week/date and shares the weekly finalization lock.
  perform public.save_show_scoring_note(p_scoring_date,p_note,true);
  update public.daily_scoring_status
    set podcast_episode_title=coalesce(nullif(pg_catalog.btrim(p_episode_title),''),podcast_episode_title)
    where scoring_date=p_scoring_date;
end
$function$;
revoke all on function public.complete_show_with_episode(date,text,text) from public,anon;
grant execute on function public.complete_show_with_episode(date,text,text) to authenticated;

-- Titles matched by Eastern publication date from the supplied Mikey and Bob RSS feed, 2026-10-29.
-- Fill display metadata only for completed days in Season 1.
update public.daily_scoring_status s
set podcast_episode_title=episodes.title
from (values
  (date '2026-10-05','Wiz Khalifa Whisper Nipples'),
  (date '2026-10-06','Big Meat Butt Buster'),
  (date '2026-10-07','36 Pound Catfish With Electric Butt Cheeks'),
  (date '2026-10-08','Adult Wee Wee Carnival'),
  (date '2026-10-09','RoboBob with Sugar Bewbs'),
  (date '2026-10-12','Pat FreierMOOSE Riding On The Roof Rack'),
  (date '2026-10-13','High Potential of Cranking It Pretty Hard'),
  (date '2026-10-14','Zoo Poopamisu'),
  (date '2026-10-15','Love Is Erotic Pokemon'),
  (date '2026-10-19','Steelers Bingo with Jamel Dean The Sex Machine'),
  (date '2026-10-20','Naked Natty Daddy Stick Battle'),
  (date '2026-10-21','Poke Poke Touch'),
  (date '2026-10-22','Two Week River Rash On My Bob Butt Lift'),
  (date '2026-10-23','Steely McBoobs at The Texas Roadhouse'),
  (date '2026-10-26','Greenfield Granny Gummed The Lombardi'),
  (date '2026-10-28','Sexy Noah and Minion Cam with The KIA Boyz'),
  (date '2026-10-29','Candy Corn Where The Sun Dont Shine')
) as episodes(show_date,title)
where s.scoring_date=episodes.show_date
  and s.week_id between date '2026-10-05' and date '2026-11-20'
  and s.podcast_episode_title is null;
