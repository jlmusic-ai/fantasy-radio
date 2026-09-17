import "./style.css";
import Image from "next/image";
export const metadata = {
  title: "Mooberball",
  description: "A fan-made Mikey and Bob fantasy game",
};
export default function Layout({ children }: { children: React.ReactNode }) {
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
            <a href="/">Play</a>
            <a href="/commissioner">Commissioner</a>
            <a href="/login">Log in</a>
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
