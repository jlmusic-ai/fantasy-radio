-- Season totals and statistics include only commissioner-finalized weeks.
create or replace view public.season_scores
with (security_invoker=true) as
select date '2026-10-05' as season_start,
  s.user_id,s.username,sum(s.score)::bigint as score,s.avatar_url
from public.weekly_scores s
join public.finalized_weeks f
  on f.week_id=s.week_id and f.scores_finalized_at is not null
where s.week_id between date '2026-10-05' and date '2026-11-20'
group by s.user_id,s.username,s.avatar_url;

create or replace view public.season_player_stats
with (security_invoker=true) as
with season_weeks as (
  select s.week_id,s.user_id,s.score
  from public.weekly_scores s
  join public.finalized_weeks f
    on f.week_id=s.week_id and f.scores_finalized_at is not null
  where s.week_id between date '2026-10-05' and date '2026-11-20'
), numbered as (
  select week_id,user_id,score,
    week_id-(row_number() over(partition by user_id order by week_id))::integer*7 as streak_group
  from season_weeks
), streaks as (
  select user_id,count(*)::integer as streak_length
  from numbered group by user_id,streak_group
), longest_streaks as (
  select user_id,max(streak_length)::integer as longest_streak
  from streaks group by user_id
), summaries as (
  select user_id,count(*)::integer as weeks_played,
    max(score)::bigint as highest_weekly_score,
    round(avg(score))::bigint as average_weekly_score,
    (array_agg(week_id order by score desc,week_id))[1] as best_week,
    count(*) filter(where score>=100)::integer as hundred_point_weeks
  from season_weeks group by user_id
)
select summaries.user_id,summaries.weeks_played,longest_streaks.longest_streak,
  summaries.highest_weekly_score,summaries.average_weekly_score,
  summaries.best_week,summaries.hundred_point_weeks
from summaries join longest_streaks using(user_id);
