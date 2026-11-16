import { NextResponse } from "next/server";
import { serverClient } from "../../../lib/server";
import { hasScheduledPlay, STUFF_A_BUS_WEEK, validPicks } from "../../../lib/game";

export async function POST(req: Request) {
  const db = await serverClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return NextResponse.json({ error: "Log in first" }, { status: 401 });

  try {
    const { week, picks, birthday_guess } = await req.json();
    if (typeof week !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(week) || !Array.isArray(picks)) {
      throw new Error("Invalid lineup");
    }
    if (!hasScheduledPlay(week)) throw new Error("No picks are scheduled for this week");
    if (!Number.isInteger(birthday_guess) || birthday_guess < 0 || birthday_guess > 500) {
      const topic = week === STUFF_A_BUS_WEEK ? "Stuff a Bus" : "birthday-wishes";
      throw new Error(`Enter a ${topic} guess between 0 and 500`);
    }
    const { data: cats, error: categoryError } = await db.from("categories")
      .select("id").eq("active", true).eq("scoring_type", "allocation");
    if (categoryError) throw new Error("Unable to load lineup topics");
    if (!validPicks(picks, (cats || []).map((category) => category.id))) {
      throw new Error("Allocate exactly 100 points, maximum 25 per category");
    }
    const { error } = await db.rpc("submit_lineup", {
      p_week: week, p_picks: picks, p_birthday_guess: birthday_guess,
    });
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid request" }, { status: 400 });
  }
}
