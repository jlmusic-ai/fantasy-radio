import './style.css';
export const metadata={title:'Fantasy Radio',description:'A fan-made morning radio fantasy league'};
export default function Layout({children}:{children:React.ReactNode}){return <html lang="en"><body><header><a href="/" className="brand">📻 FANTASY RADIO</a><nav><a href="/">Play</a><a href="/commissioner">Commissioner</a><a href="/login">Log in</a></nav></header><main>{children}</main><footer>Independent fan-made game. Not affiliated with or endorsed by the show or station.</footer></body></html>}
