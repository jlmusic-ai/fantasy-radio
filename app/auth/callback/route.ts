import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextRequest, NextResponse } from "next/server";

type CookieToSet = { name: string; value: string; options?: CookieOptions };

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  if (!code) {
    const reason = url.searchParams.has("error") ? "cancelled" : "failed";
    return NextResponse.redirect(new URL(`/login?facebook_error=${reason}`, request.url));
  }

  const response = NextResponse.redirect(new URL("/", request.url), { status: 303 });
  const db = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll(); },
        setAll(items: CookieToSet[]) {
          items.forEach(({ name, value, options }) => {
            request.cookies.set(name, value);
            response.cookies.set(name, value, options);
          });
        },
      },
    },
  );

  const { data, error } = await db.auth.exchangeCodeForSession(code);
  if (error || !data.user) {
    return NextResponse.redirect(new URL("/login?facebook_error=failed", request.url));
  }

  // The profile trigger creates a temporary username for OAuth users. Ask them
  // to choose their own before they reach the game. Returning players keep theirs.
  const { data: profile } = await db.from("profiles")
    .select("username,avatar_url").eq("id", data.user.id).single();
  const temporaryName = `player_${data.user.id.replace(/-/g, "").slice(0, 20)}`;
  if (profile?.username === temporaryName) {
    const { error: onboardingError } = await db.auth.updateUser({
      data: { facebook_username_pending: true, welcome_photo_pending: !profile.avatar_url },
    });
    if (onboardingError) {
      // The profile page still lets this player choose a name if metadata fails.
      response.headers.set("Location", new URL("/profile?facebook=welcome", request.url).toString());
    } else {
      response.headers.set("Location", new URL("/profile", request.url).toString());
    }
  } else if (data.user.user_metadata?.facebook_username_pending === true) {
    response.headers.set("Location", new URL("/profile", request.url).toString());
  }

  return response;
}
