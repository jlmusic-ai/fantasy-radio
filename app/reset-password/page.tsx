"use client";

import { FormEvent, useEffect, useState } from "react";
import { browserClient } from "../../lib/supabase";
import { recoveryErrorMessage } from "../../lib/password-recovery";

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
    async function establishRecovery() {
      const url = new URL(window.location.href);
      const hash = new URLSearchParams(url.hash.slice(1));
      const errorCode = hash.get("error_code") || url.searchParams.get("error_code");
      const cleanUrl = () => window.history.replaceState(null, "", window.location.pathname);
      try {
        if (errorCode || hash.has("error") || url.searchParams.has("error")) {
          cleanUrl();
          if (active) setMessage(recoveryErrorMessage(errorCode || undefined));
          return;
        }
        const accessToken = hash.get("access_token");
        const refreshToken = hash.get("refresh_token");
        if (accessToken && refreshToken && hash.get("type") === "recovery") {
          // Explicitly establish recovery from the email's tokens. This does
          // not require a PKCE verifier from the browser that sent the email.
          const { error } = await db.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
          cleanUrl();
          if (error) { if (active) setMessage(recoveryErrorMessage(error.code)); return; }
        }
        let { data, error } = await db.auth.getSession();
        if (!data.session && url.searchParams.has("code")) {
          // Continue supporting recovery emails sent before this change.
          const result = await db.auth.exchangeCodeForSession(url.searchParams.get("code")!);
          data = result.data;
          error = result.error;
          cleanUrl();
        }
        if (active) {
          setReady(Boolean(data.session));
          if (!data.session) setMessage(recoveryErrorMessage(error?.code));
        }
      } catch {
        if (active) setMessage("We could not verify your reset link. Please request a new reset email and try again.");
      } finally {
        if (active) setChecking(false);
      }
    }
    void establishRecovery();
    return () => { active = false; };
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
            {message || "Request a new password reset email to continue."}
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
