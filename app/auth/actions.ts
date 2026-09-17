"use server";

import { redirect } from "next/navigation";
import { serverClient } from "../../lib/server";

export async function logOut() {
  const db = await serverClient();
  await db.auth.signOut();
  redirect("/");
}
