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
              width={220}
              height={110}
              priority
            />
          </a>
          <nav>
            {user && <a href="/">Play</a>}
            <a href="/rules">Rules</a>
            {isCommissioner && (
              <details style={{ position: "relative" }}>
                <summary style={{ color: "var(--gold)", cursor: "pointer" }}>
                  Commissioner
                </summary>
                <div className="panel" style={{ position: "absolute", zIndex: 10, right: 0, minWidth: 170, marginTop: 8, padding: 14, display: "grid", gap: 12 }}>
                  <a href="/commissioner">Dashboard</a>
                  <a href="/commissioner/score">Score this week</a>
                  <a href="/commissioner/users">Users</a>
                </div>
              </details>
            )}
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
