import { emailDatabase, unsubscribeUser } from "../../../lib/email-unsubscribe";

export async function POST(request: Request) {
  const form = await request.formData();
  const token = form.get("token");
  const userId = unsubscribeUser(typeof token === "string" ? token : null);
  if (!userId) return new Response("Invalid unsubscribe link", { status: 400 });
  const secret = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const response = await emailDatabase("/rest/v1/rpc/unsubscribe_player_emails", secret, {
    method: "POST", body: JSON.stringify({ p_user_id: userId }),
  });
  if (!response.ok) return new Response("Could not update email preferences. Please try again.", { status: 502 });
  return new Response("You have unsubscribed from all Mooberball emails. Your account and picks are unchanged.", {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
