import { emailDatabase } from "./email-unsubscribe";
import { FIRST_SEASON_START, FIRST_SEASON_FINALE } from "./game";

export type PodiumEntry = { username: string; score: number; place: number };

export async function loadSeasonPodium(secret: string): Promise<PodiumEntry[]> {
  const finalization = await emailDatabase(
    `/rest/v1/finalized_weeks?select=week_id&week_id=eq.${FIRST_SEASON_FINALE}&scores_finalized_at=not.is.null`,
    secret,
  );
  if (!finalization.ok) throw new Error("Unable to verify Season One finalization");
  if (!(await finalization.json()).length) return [];

  const response = await emailDatabase(
    `/rest/v1/season_scores?select=username,score&season_start=eq.${FIRST_SEASON_START}&order=score.desc,username.asc&limit=1000`,
    secret,
  );
  if (!response.ok) throw new Error("Unable to load the final Season One standings");
  const rows = (await response.json()) as { username: string; score: number }[];
  let place = 0;
  return rows.flatMap((entry, index) => {
    if (index === 0 || entry.score !== rows[index - 1].score) place = index + 1;
    return place <= 3 ? [{ ...entry, place }] : [];
  });
}
