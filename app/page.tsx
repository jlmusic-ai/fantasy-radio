import Game from "./game";
import RulesContent from "./rules-content";
import { serverClient } from "../lib/server";

export default async function Home() {
  const db = await serverClient();
  const {
    data: { user },
  } = await db.auth.getUser();

  return user ? <Game /> : <RulesContent />;
}
