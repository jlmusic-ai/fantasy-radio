begin;
select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('mooberball_finalize_closed_weeks'));
select set_config('request.jwt.claim.sub',(select id::text from public.profiles where is_commissioner limit 1),true);
-- Set up an unfinalized fixture visible only inside this transaction.
update public.finalized_weeks set scores_finalized_at=null
where week_id=date_trunc('week',now() at time zone 'America/New_York')::date;
set local role authenticated;
do $test$
declare
  d date := (now() at time zone 'America/New_York')::date;
  previous_status jsonb;
  original_scores jsonb;
begin
  select jsonb_agg(to_jsonb(s) order by week_id,user_id) into original_scores from public.weekly_score_snapshots s;
  perform public.complete_show_with_episode(d,'Catch-up note','Tuesday & Bob');
  assert exists(select 1 from public.daily_scoring_status where scoring_date=d
    and podcast_episode_title='Tuesday & Bob' and commissioner_note='Catch-up note' and completed_at is not null),
    'Title, note and completion should be saved together';
  perform public.complete_show_with_episode(d,'Updated note',null);
  assert (select podcast_episode_title from public.daily_scoring_status where scoring_date=d)='Tuesday & Bob',
    'A missing feed result must not erase a saved title';
  select to_jsonb(s) into previous_status from public.daily_scoring_status s where scoring_date=d;
  begin
    perform public.complete_show_with_episode(d,'Must roll back',repeat('x',501));
    raise exception 'Expected overlong title rejection';
  exception when check_violation then null;
  end;
  assert (select to_jsonb(s) from public.daily_scoring_status s where scoring_date=d)=previous_status,
    'Invalid titles must roll back completion and note edits atomically';
  assert (select jsonb_agg(to_jsonb(s) order by week_id,user_id) from public.weekly_score_snapshots s)=original_scores,
    'Title metadata must not change historical scores';
end
$test$;
reset role;
select set_config('request.jwt.claim.sub',(select id::text from public.profiles where not is_commissioner limit 1),true);
set local role authenticated;
do $test$
declare changed integer; d date := (now() at time zone 'America/New_York')::date;
begin
  begin
    perform public.complete_show_with_episode(d,'Unauthorized','Wrong title');
    raise exception 'Expected commissioner access rejection';
  exception when insufficient_privilege then null;
  end;
  update public.daily_scoring_status set podcast_episode_title='Unauthorized' where scoring_date=d;
  get diagnostics changed=row_count;
  assert changed=0, 'RLS must reject non-commissioner metadata edits';
end
$test$;
reset role;
do $test$
begin
  assert not has_function_privilege('anon','public.complete_show_with_episode(date,text,text)','execute');
  assert not has_column_privilege('authenticated','public.daily_scoring_status','commissioner_note','update'),
    'New metadata grant must not allow direct edits to completion notes';
end
$test$;
rollback;
select 'PASS: atomic title/note/completion, metadata preservation, score integrity, and access control; all test edits rolled back' as result;
