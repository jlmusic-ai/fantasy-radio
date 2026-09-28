import Game from "./game";
import RulesContent from "./rules-content";
import PhotoReminder from "./photo-reminder";
import ConfirmationLanding from "./confirmation-landing";
import { serverClient } from "../lib/server";
import { redirect } from "next/navigation";

export default async function Home() {
  const db = await serverClient();
  const {
    data: { user },
  } = await db.auth.getUser();

  if (user?.user_metadata?.welcome_photo_pending === true) redirect("/profile");

  return user
    ? <><PhotoReminder /><Game /></>
    : <><ConfirmationLanding /><RulesContent /></>;
}
