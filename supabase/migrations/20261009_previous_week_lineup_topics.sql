-- One row per historical topic, without player picks or earned points.
create or replace view public.weekly_lineup_topics
with (security_invoker=true) as
select distinct week_id,category_id,topic_name
from public.weekly_score_details;
revoke all on public.weekly_lineup_topics from public,anon;
grant select on public.weekly_lineup_topics to authenticated;
