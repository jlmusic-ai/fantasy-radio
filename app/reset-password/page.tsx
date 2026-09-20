"use client";

import { FormEvent, useEffect, useState } from "react";
import { browserClient } from "../../lib/supabase";

export default function ResetPasswordPage() {
  const [db] = useState(browserClient);
  const [ready, setReady] = useState(false);
  const [checking, setChecking] = useState(true);
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [complete, setComplete] = useState(false);

  useEffect(() => {
    let active = true;

    db.auth.getSession().then(({ data }) => {
      if (!active) return;
      setReady(Boolean(data.session));
      setChecking(false);
    });

    const {
      data: { subscription },
    } = db.auth.onAuthStateChange((event, session) => {
      if (!active) return;
      if ((event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") && session) {
        setReady(true);
        setChecking(false);
      }
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [db]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setMessage("");

    if (!ready) {
      setMessage("This reset link is invalid or has expired. Request a new one.");
      return;
    }
    if (password.length < 8) {
      setMessage("Your new password must contain at least 8 characters.");
      return;
    }
    if (password !== passwordConfirmation) {
      setMessage("The new passwords do not match.");
      return;
    }

    setSubmitting(true);
    const { error } = await db.auth.updateUser({ password });

    if (error) {
      setSubmitting(false);
      setMessage(error.message);
      return;
    }

    await db.auth.signOut({ scope: "global" });
    setSubmitting(false);
    setComplete(true);
    setPassword("");
    setPasswordConfirmation("");
    setMessage("Your password has been updated. You can now log in.");
  }

  if (checking) {
    return (
      <div className="panel" style={{ maxWidth: 480, margin: "auto" }}>
        <h1>Choose a new password</h1>
        <p>Checking your password reset link…</p>
      </div>
    );
  }

  return (
    <div className="panel" style={{ maxWidth: 480, margin: "auto" }}>
      <h1>Choose a new password</h1>
      {!ready && !complete ? (
        <>
          <p>
            This reset link is invalid or has expired. Request a new password
            reset email to continue.
          </p>
          <a href="/forgot-password">Request a new reset link</a>
        </>
      ) : (
        <>
          {!complete && (
            <form onSubmit={submit}>
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
                  onChange={(event) => setPasswordConfirmation(event.target.value)}
                />
              </label>
              <button disabled={submitting} type="submit">
                {submitting ? "Updating password…" : "Update password"}
              </button>
            </form>
          )}
          <p aria-live="polite">{message}</p>
          {complete && <a href="/login">Log in with your new password</a>}
        </>
      )}
    </div>
  );
}
