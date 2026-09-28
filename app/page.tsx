import Game from "./game";
import RulesContent from "./rules-content";
import PhotoReminder from "./photo-reminder";
import { serverClient } from "../lib/server";

export default async function Home() {
  const db = await serverClient();
  const {
    data: { user },
  } = await db.auth.getUser();

  return user ? <><PhotoReminder /><Game /></> : <RulesContent />;
}
