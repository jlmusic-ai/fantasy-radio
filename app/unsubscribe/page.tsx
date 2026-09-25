export default async function UnsubscribePage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const token = (await searchParams).token || "";
  return <main className="container" style={{ maxWidth: 680, paddingTop: 60 }}>
    <h1>Mooberball email preferences</h1>
    <p>Stop all Mooberball reminder and results emails. Your account and picks will stay available.</p>
    <form action="/api/unsubscribe" method="post">
      <input type="hidden" name="token" value={token} />
      <button type="submit">Unsubscribe from all emails</button>
    </form>
  </main>;
}
