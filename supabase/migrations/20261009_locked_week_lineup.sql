-- Preserve finalized topic titles and use submitted topic IDs for locked,
-- unfinished weeks. No player's allocation is exposed by this view.
create or replace view public.weekly_lineup_topics
with (security_invoker=true) as
select distinct week_id,category_id,topic_name,scoring_type
from public.weekly_score_details
union
select distinct p.week_id,p.category_id,c.name,c.scoring_type
from public.picks p join public.categories c on c.id=p.category_id
where not exists (
  select 1 from public.weekly_score_details d where d.week_id=p.week_id
)
union
select distinct bp.week_id,c.id,c.name,c.scoring_type
from public.birthday_predictions bp
join public.categories c on c.scoring_type='closest_guess'
where not exists (
  select 1 from public.weekly_score_details d where d.week_id=bp.week_id
);
