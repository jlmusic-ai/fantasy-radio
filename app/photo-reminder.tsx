"use client";

import { useEffect, useState } from "react";
import { browserClient } from "../lib/supabase";

const laterKey = (id: string) => `mooberball-photo-reminder-later:${id}`;

export default function PhotoReminder() {
  const [userId, setUserId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    async function checkPhoto() {
      const db = browserClient();
      const { data: { user }, error: userError } = await db.auth.getUser();
      if (!active || userError || !user || user.user_metadata?.photo_reminder_disabled === true) return;
      if (sessionStorage.getItem(laterKey(user.id))) return;
      const { data: profile, error: profileError } = await db
        .from("profiles")
        .select("avatar_url")
        .eq("id", user.id)
        .single();
      if (active && !profileError && profile && !profile.avatar_url) setUserId(user.id);
    }
    checkPhoto();
    return () => { active = false; };
  }, []);

  if (!userId) return null;

  async function neverRemind() {
    setSaving(true);
    setMessage("");
    const { error } = await browserClient().auth.updateUser({
      data: { photo_reminder_disabled: true },
    });
    setSaving(false);
    if (error) setMessage("Could not save your preference. Please try again.");
    else setUserId(null);
  }

  return (
    <section className="panel photo-reminder" aria-label="Add a profile photo">
      <div>
        <h2>Add a profile photo</h2>
        <p>Adding a photo to your profile makes things much more fun! Your fellow Moobers will see it next to your name on the leaderboards.</p>
      </div>
      <div className="photo-reminder-actions">
        <a className="button" href="/profile#profile-photo">Upload one now</a>
        <button type="button" className="secondary-action" onClick={() => {
          sessionStorage.setItem(laterKey(userId), "1");
          setUserId(null);
        }}>Remind me later</button>
        <button type="button" className="secondary-action" disabled={saving} onClick={neverRemind}>
          {saving ? "Saving…" : "Don’t remind me again"}
        </button>
      </div>
      {message && <p className="error" role="alert">{message}</p>}
    </section>
  );
}
