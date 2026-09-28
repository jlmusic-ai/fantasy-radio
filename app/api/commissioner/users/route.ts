import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { commissioner } from "../../../../lib/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function DELETE(request: Request) {
  const { user, allowed } = await commissioner();
  if (!user || !allowed) return NextResponse.json({ error: "Commissioner access required." }, { status: 403 });

  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  }

  let id: unknown;
  try {
    ({ id } = await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  if (typeof id !== "string" || !UUID.test(id)) {
    return NextResponse.json({ error: "Invalid user ID." }, { status: 400 });
  }
  if (id === user.id) return NextResponse.json({ error: "You cannot delete your own account here." }, { status: 403 });

  const secret = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) return NextResponse.json({ error: "User management is not configured." }, { status: 500 });

  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, secret, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: target, error: lookupError } = await admin
    .from("profiles")
    .select("id,is_commissioner")
    .eq("id", id)
    .maybeSingle();
  if (lookupError) return NextResponse.json({ error: lookupError.message }, { status: 500 });
  if (!target) return NextResponse.json({ error: "User not found." }, { status: 404 });
  if (target.is_commissioner) {
    return NextResponse.json({ error: "Commissioner accounts cannot be deleted here." }, { status: 403 });
  }

  // Supabase Storage must remove the files and their metadata together.
  // The upload UI currently stores one avatar at `${id}/avatar`; loop to cover older files too.
  for (let page = 0; page < 100; page++) {
    const { data: files, error: listError } = await admin.storage.from("avatars").list(id, { limit: 100 });
    if (listError) return NextResponse.json({ error: listError.message }, { status: 500 });
    if (!files?.length) break;
    const { error: removeError } = await admin.storage.from("avatars").remove(files.map((file) => `${id}/${file.name}`));
    if (removeError) return NextResponse.json({ error: removeError.message }, { status: 500 });
    if (page === 99) return NextResponse.json({ error: "Too many avatar files to remove." }, { status: 500 });
  }

  const { error: deleteError } = await admin.auth.admin.deleteUser(id);
  if (deleteError) return NextResponse.json({ error: deleteError.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
