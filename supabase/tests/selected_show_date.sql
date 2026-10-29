-- Every fixture and scoring edit is rolled back. Run against an existing project.
begin;
select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('mooberball_finalize_closed_weeks'));
select set_config('request.jwt.claim.sub',(select id::text from public.profiles where is_commissioner limit 1),true);
set local role authenticated;
-- A finalized week must reject counts, completion changes, and note changes.
do $test$
declare d date := (now() at time zone 'America/New_York')::date; c uuid;
begin
  select id into c from public.categories where active limit 1;
  if exists(select 1 from public.finalized_weeks where week_id=date_trunc('week',d)::date and scores_finalized_at is not null) then
    begin perform public.adjust_show_occurrences(d,c,1,null); raise exception 'Expected finalized count rejection';
    exception when raise_exception then if sqlerrm<>'Weekly scores are finalized' then raise; end if; end;
    begin perform public.set_show_scoring_complete(d,false); raise exception 'Expected finalized completion rejection';
    exception when raise_exception then if sqlerrm<>'Weekly scores are finalized' then raise; end if; end;
    begin perform public.save_show_scoring_note(d,'Test'); raise exception 'Expected finalized note rejection';
    exception when raise_exception then if sqlerrm<>'Weekly scores are finalized' then raise; end if; end;
  end if;
end
$test$;
reset role;
-- Open a transaction-local test fixture. Other sessions cannot see these changes.
update public.finalized_weeks set scores_finalized_at=null
where week_id=date_trunc('week',now() at time zone 'America/New_York')::date;
set local role authenticated;
do $test$
declare
  actual_today date := (now() at time zone 'America/New_York')::date;
  monday date := date_trunc('week',actual_today)::date;
  show_date date := greatest(monday,actual_today-1);
  c record; before_other jsonb; after_other jsonb; before_other_lines jsonb;
  baseline integer; result integer; done boolean;
begin
  select jsonb_agg(to_jsonb(e) order by id) into before_other from public.events e
    where week_id=monday and (occurred_at at time zone 'America/New_York')::date<>show_date;
  select jsonb_agg(to_jsonb(l) order by scoring_date,category_id) into before_other_lines
    from public.daily_scoring_lines l where week_id=monday and scoring_date<>show_date;
  perform public.set_show_scoring_complete(show_date,false);
  for c in select id,scoring_type from public.categories where active and
    id in (select distinct on (scoring_type) id from public.categories where active order by scoring_type,id)
  loop
    select coalesce(sum(quantity),0)::integer into baseline from public.events
      where week_id=monday and category_id=c.id and (occurred_at at time zone 'America/New_York')::date<>show_date;
    result:=public.adjust_show_occurrences(show_date,c.id,null,3);
    assert result=3, 'Direct entry should set the selected show count';
    result:=public.adjust_show_occurrences(show_date,c.id,1,null);
    assert result=4, 'Plus must increment selected show only';
    result:=public.adjust_show_occurrences(show_date,c.id,-1,null);
    assert result=3, 'Minus must decrement selected show only';
    assert (select sum(quantity) from public.events where week_id=monday and category_id=c.id)=baseline+3,
      'Weekly total must combine the selected show with other dates';
    perform public.save_show_scoring_note(show_date,'Catch-up scoring test',true);
    assert (select quantity from public.daily_scoring_lines where scoring_date=show_date and category_id=c.id)=3,
      'Published log must use the selected broadcast date';
    assert (select commissioner_note from public.daily_scoring_status where scoring_date=show_date)='Catch-up scoring test',
      'Commissioner note must use selected date';
    begin perform public.adjust_show_occurrences(show_date,c.id,1,null); raise exception 'Expected completed-day rejection';
    exception when raise_exception then if sqlerrm<>'Undo the selected show completion before changing counts' then raise; end if; end;
    perform public.set_show_scoring_complete(show_date,false);
    assert not exists(select 1 from public.daily_scoring_lines where scoring_date=show_date), 'Reopen must unpublish selected day';
    perform public.adjust_show_occurrences(show_date,c.id,null,0);
    assert not exists(select 1 from public.events where week_id=monday and category_id=c.id
      and (occurred_at at time zone 'America/New_York')::date=show_date), 'Zero should clear selected date only';
  end loop;
  select jsonb_agg(to_jsonb(e) order by id) into after_other from public.events e
    where week_id=monday and (occurred_at at time zone 'America/New_York')::date<>show_date;
  assert before_other is not distinct from after_other, 'Other dates events must remain unchanged';
  assert before_other_lines is not distinct from (select jsonb_agg(to_jsonb(l) order by scoring_date,category_id)
    from public.daily_scoring_lines l where week_id=monday and scoring_date<>show_date), 'Other daily snapshots must stay unchanged';
  for c in select d from (values (actual_today+1),(monday-1),(null::date)) v(d) loop
    begin perform public.adjust_show_occurrences(c.d,(select id from public.categories where active limit 1),1,null); raise exception 'Expected invalid date';
    exception when raise_exception then if sqlerrm<>'Choose today or an earlier show date in the current broadcast week' then raise; end if; end;
    begin perform public.set_show_scoring_complete(c.d,true); raise exception 'Expected invalid date';
    exception when raise_exception then if sqlerrm<>'Choose today or an earlier show date in the current broadcast week' then raise; end if; end;
    begin perform public.save_show_scoring_note(c.d,'Test',true); raise exception 'Expected invalid date';
    exception when raise_exception then if sqlerrm<>'Choose today or an earlier show date in the current broadcast week' then raise; end if; end;
  end loop;
end
$test$;
reset role;
select set_config('request.jwt.claim.sub',(select id::text from public.profiles where not is_commissioner limit 1),true);
set local role authenticated;
do $test$
declare d date := (now() at time zone 'America/New_York')::date;
begin
  begin perform public.adjust_show_occurrences(d,(select id from public.categories where active limit 1),1,null); raise exception 'Expected access rejection'; exception when insufficient_privilege then null; end;
  begin perform public.set_show_scoring_complete(d,true); raise exception 'Expected access rejection'; exception when insufficient_privilege then null; end;
  begin perform public.save_show_scoring_note(d,'Test',true); raise exception 'Expected access rejection'; exception when insufficient_privilege then null; end;
end
$test$;
reset role;
do $test$
begin
 assert not has_function_privilege('anon','public.adjust_show_occurrences(date,uuid,integer,integer)','execute');
 assert not has_function_privilege('anon','public.set_show_scoring_complete(date,boolean)','execute');
 assert not has_function_privilege('anon','public.save_show_scoring_note(date,text,boolean)','execute');
end
$test$;
rollback;
select 'PASS: catch-up counts, notes, publication, reopening, date validation, finalized weeks, and access control; all test changes rolled back' as result;
