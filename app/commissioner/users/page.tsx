"use client";

import { useEffect, useState } from "react";
import { browserClient } from "../../../lib/supabase";

type ManagedUser = { id: string; email: string; username: string; created_at: string; is_commissioner: boolean };

function formatSignupDate(iso: string) {
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "2-digit", day: "2-digit", year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" })
    .format(new Date(iso))
    .replace(/^(\d{2})\/(\d{2})\/(\d{4})/, "$1-$2-$3");
}

export default function CommissionerUsersPage() {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [message, setMessage] = useState("Loading users…");
  const [deleting, setDeleting] = useState<string | null>(null);

  async function loadUsers() {
    const db = browserClient();
    const { data: { user } } = await db.auth.getUser();
    setCurrentUserId(user?.id || null);
    const { data, error } = await db.rpc("admin_list_users");
    if (error) {
      setMessage("You must be an authorized commissioner to view users.");
      return;
    }
    setUsers((data || []) as ManagedUser[]);
    setMessage("");
  }

  useEffect(() => { loadUsers(); }, []);

  async function deleteUser(user: ManagedUser) {
    if (!window.confirm(`Permanently delete ${user.username} (${user.email}) and all of their picks and scores? This cannot be undone.`)) return;
    setDeleting(user.id);
    setMessage("");
    const db = browserClient();
    const { error } = await db.rpc("admin_delete_user", { target_user_id: user.id });
    setDeleting(null);
    if (error) { setMessage(error.message); return; }
    setUsers((current) => current.filter((item) => item.id !== user.id));
    setMessage(`${user.username} was deleted.`);
  }

  return (
    <>
      <h1>Registered users</h1>
      <p className="muted">View everyone who has signed up for Mooberball. Times are shown in Pittsburgh time.</p>
      <div className="panel" style={{ overflowX: "auto" }}>
        <table>
          <thead><tr><th>Username</th><th>Email</th><th>Signed up</th><th>Action</th></tr></thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id}>
                <td>{user.username}</td><td>{user.email}</td><td>{formatSignupDate(user.created_at)}</td>
                <td><button disabled={deleting === user.id || user.id === currentUserId || user.is_commissioner} onClick={() => deleteUser(user)}>{deleting === user.id ? "Deleting…" : "Delete"}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        {!users.length && !message && <p>No users have signed up yet.</p>}
        {message && <p aria-live="polite">{message}</p>}
      </div>
      <p className="muted">Commissioner accounts cannot be deleted from this page.</p>
    </>
  );
}
