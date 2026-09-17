"use client";

import { FormEvent, useEffect, useState } from "react";
import Avatar from "../avatar";
import { browserClient } from "../../lib/supabase";

export default function ProfilePage() {
  const db = browserClient();
  const [userId, setUserId] = useState("");
  const [username, setUsername] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [profileMessage, setProfileMessage] = useState("");
  const [accountMessage, setAccountMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    async function loadProfile() {
      const {
        data: { user },
      } = await db.auth.getUser();
      if (!user) {
        window.location.href = "/login";
        return;
      }
      setUserId(user.id);
      setEmail(user.email || "");
      const { data, error } = await db
        .from("profiles")
        .select("username,avatar_url")
        .eq("id", user.id)
        .single();
      if (error) setProfileMessage(error.message);
      else {
        setUsername(data.username);
        if (data.avatar_url) {
          const { data: signed } = await db.storage
            .from("avatars")
            .createSignedUrl(data.avatar_url, 3600);
          setAvatarUrl(signed?.signedUrl || null);
        }
      }
      setLoading(false);
    }
    loadProfile();
  }, []);

  async function saveProfile(event: FormEvent) {
    event.preventDefault();
    const cleanUsername = username.trim();
    if (cleanUsername.length < 3) {
      setProfileMessage("Username must contain at least three characters.");
      return;
    }
    const { error } = await db
      .from("profiles")
      .update({ username: cleanUsername })
      .eq("id", userId);
    setProfileMessage(error ? error.message : "Profile saved.");
  }

  async function uploadPhoto(file?: File) {
    if (!file || !userId) return;
    if (!file.type.match(/^image\/(jpeg|png|webp)$/)) {
      setProfileMessage("Choose a JPG, PNG, or WebP image.");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setProfileMessage("Profile photos must be 2 MB or smaller.");
      return;
    }
    setUploading(true);
    setProfileMessage("");
    const path = `${userId}/avatar`;
    const { error: uploadError } = await db.storage
      .from("avatars")
      .upload(path, file, {
        upsert: true,
        contentType: file.type,
        cacheControl: "3600",
      });
    if (uploadError) {
      setUploading(false);
      setProfileMessage(uploadError.message);
      return;
    }
    const { error: profileError } = await db
      .from("profiles")
      .update({ avatar_url: path })
      .eq("id", userId);
    setUploading(false);
    if (profileError) setProfileMessage(profileError.message);
    else {
      const { data: signed } = await db.storage
        .from("avatars")
        .createSignedUrl(path, 3600);
      setAvatarUrl(signed?.signedUrl || null);
      setProfileMessage("Profile photo updated.");
    }
  }

  async function updateEmail(event: FormEvent) {
    event.preventDefault();
    setAccountMessage("");
    const { error } = await db.auth.updateUser({ email: email.trim() });
    setAccountMessage(
      error
        ? error.message
        : "Email update requested. Check your email for a confirmation link.",
    );
  }

  async function updatePassword(event: FormEvent) {
    event.preventDefault();
    setAccountMessage("");
    if (password.length < 8) {
      setAccountMessage(
        "Your new password must contain at least 8 characters.",
      );
      return;
    }
    if (password !== passwordConfirmation) {
      setAccountMessage("The new passwords do not match.");
      return;
    }
    const { error } = await db.auth.updateUser({ password });
    setAccountMessage(error ? error.message : "Password updated.");
    if (!error) {
      setPassword("");
      setPasswordConfirmation("");
    }
  }

  async function sendPasswordReset() {
    setAccountMessage("");
    const { error } = await db.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/profile`,
    });
    setAccountMessage(
      error
        ? error.message
        : "Password reset email sent. Follow its link to choose a new password.",
    );
  }

  if (loading) return <p>Loading profile…</p>;

  return (
    <>
      <div className="profile-heading">
        <Avatar name={username} url={avatarUrl} size={72} />
        <div>
          <h1>Profile</h1>
          <p className="muted">Manage your Mooberball account.</p>
        </div>
      </div>
      <div className="profile-grid">
        <section className="panel">
          <h2>Public profile</h2>
          <form onSubmit={saveProfile}>
            <label>
              Username
              <input
                required
                minLength={3}
                maxLength={30}
                value={username}
                onChange={(event) => setUsername(event.target.value)}
              />
            </label>
            <button type="submit">Save username</button>
          </form>
          <label>
            Profile photo
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              disabled={uploading}
              onChange={(event) => uploadPhoto(event.target.files?.[0])}
            />
          </label>
          <p className="muted">JPG, PNG, or WebP. Maximum size: 2 MB.</p>
          {uploading && <p>Uploading photo…</p>}
          {profileMessage && <p>{profileMessage}</p>}
        </section>

        <section className="panel">
          <h2>Account security</h2>
          <form onSubmit={updateEmail}>
            <label>
              Email address
              <input
                type="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
            <button type="submit">Update email</button>
          </form>
          <hr />
          <form onSubmit={updatePassword}>
            <label>
              New password
              <input
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            <label>
              Confirm new password
              <input
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                value={passwordConfirmation}
                onChange={(event) =>
                  setPasswordConfirmation(event.target.value)
                }
              />
            </label>
            <button type="submit">Update password</button>
            <button
              className="secondary-action"
              type="button"
              onClick={sendPasswordReset}
            >
              Send password reset email
            </button>
          </form>
          {accountMessage && <p>{accountMessage}</p>}
        </section>
      </div>
    </>
  );
}
