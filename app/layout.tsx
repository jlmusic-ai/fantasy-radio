import "./style.css";
import Image from "next/image";
import { commissioner } from "../lib/server";
import { logOut } from "./auth/actions";
export const metadata = {
  title: "Mooberball",
  description: "A fan-made Mikey and Bob fantasy game",
};
export default async function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, allowed: isCommissioner } = await commissioner();

  return (
    <html lang="en">
      <body>
        <header>
          <a href="/" className="brand" aria-label="Mooberball home">
            <Image
              src="/mooberball-logo.png"
              alt="Mooberball"
              width={180}
              height={162}
              priority
            />
          </a>
          <nav>
            {user && <a href="/">Play</a>}
            <a href="/rules">Rules</a>
            {isCommissioner && <a href="/commissioner">Commissioner</a>}
            {user ? (
              <>
                <a href="/profile">Profile</a>
                <form action={logOut}>
                  <button className="nav-link" type="submit">
                    Log out
                  </button>
                </form>
              </>
            ) : (
              <a href="/login">Log in</a>
            )}
          </nav>
        </header>
        <main>{children}</main>
        <footer>
          Mooberball is an independent fan-made game. Not affiliated with or
          endorsed by the show or station.
        </footer>
      </body>
    </html>
  );
}
