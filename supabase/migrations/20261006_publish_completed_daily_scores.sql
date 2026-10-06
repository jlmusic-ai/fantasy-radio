-- Publish points from completed daily snapshots. Draft commissioner events
-- remain private to the scoring workflow until the day is marked complete.
create or replace view public.calculated_weekly_scores
with (security_invoker=true) as
with base as (
  select p.week_id,p.user_id,pr.username,pr.avatar_url,
    coalesce(sum(p.points*coalesce(e.quantity,0)),0)::bigint as base_score
  from public.picks p
  join public.profiles pr on pr.id=p.user_id
  join public.categories pc
    on pc.id=p.category_id and pc.scoring_type='allocation'
  left join (
    select week_id,category_id,sum(quantity) as quantity
    from public.daily_scoring_lines
    where scoring_type='allocation'
    group by week_id,category_id
  ) e on e.week_id=p.week_id and e.category_id=p.category_id
  group by p.week_id,p.user_id,pr.username,pr.avatar_url
), birthday_actual as (
  select week_id,sum(quantity)::integer as actual
  from public.daily_scoring_lines
  where scoring_type='closest_guess'
  group by week_id
)
select b.week_id,b.user_id,b.username,
  (b.base_score+
    case when bp.guess is null or not exists (
      select 1 from public.finalized_weeks f
      where f.week_id=b.week_id and f.scores_finalized_at is not null
    ) then 0
    else greatest(5,50-abs(bp.guess-coalesce(ba.actual,0))*2)
    end
  )::bigint as score,
  b.avatar_url
from base b
left join public.birthday_predictions bp
  on bp.week_id=b.week_id and bp.user_id=b.user_id
left join birthday_actual ba on ba.week_id=b.week_id;
