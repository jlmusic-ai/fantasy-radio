import { emailDatabase, unsubscribeUser } from "../../../lib/email-unsubscribe";

// A GET may be a link scanner. Only show the existing confirmation page.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const confirmation = new URL("https://mooberball.com/unsubscribe");
  confirmation.searchParams.set("token", url.searchParams.get("token") || "");
  return Response.redirect(confirmation, 303);
}

export async function POST(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return new Response("Invalid unsubscribe request", { status: 400 });
  }
  const queryToken = new URL(request.url).searchParams.get("token");
  const oneClick = queryToken !== null;
  if (oneClick && form.get("List-Unsubscribe") !== "One-Click") {
    return new Response("Invalid unsubscribe request", { status: 400 });
  }
  const token = oneClick ? queryToken : form.get("token");
  const userId = unsubscribeUser(typeof token === "string" ? token : null);
  if (!userId) return new Response("Invalid unsubscribe link", { status: 400 });
  const secret = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const response = await emailDatabase("/rest/v1/rpc/unsubscribe_player_emails", secret, {
    method: "POST", body: JSON.stringify({ p_user_id: userId }),
  });
  if (!response.ok) return new Response("Could not update email preferences. Please try again.", { status: 502 });
  if (oneClick) return new Response(null, { status: 200, headers: { "Cache-Control": "no-store" } });
  return new Response("You have unsubscribed from all Mooberball emails. Your account and picks are unchanged.", {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
