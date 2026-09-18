"use client";

import { useState } from "react";
import { browserClient } from "../../lib/supabase";

function signupErrorMessage(error: { code?: string; message: string }) {
  if (error.code === "over_email_send_rate_limit" || /email rate limit/i.test(error.message)) {
    return "Too many account emails have been requested recently. Please wait about 20 minutes and try again. If you already received a confirmation email, confirm it and try logging in.";
  }
  return error.message;
}

export default function Signup() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setMessage("");
    const db = browserClient();
    const { data, error } = await db.auth.signUp({ email, password });
    if (error) {
      setSubmitting(false);
      setMessage(signupErrorMessage(error));
      return;
    }
    if (data.session && data.user) {
      const { error: profileError } = await db.from("profiles").update({ username }).eq("id", data.user.id);
      setSubmitting(false);
      setMessage(profileError ? profileError.message : "Account created!");
      if (!profileError) window.location.href = "/";
      return;
    }
    setSubmitting(false);
    setMessage("Check your email to confirm your account, then log in. Your username can be changed after confirmation.");
  }

  return (
    <div className="panel" style={{ maxWidth: 480, margin: "auto" }}>
      <h1>Create an account</h1>
      <form onSubmit={submit}>
        <label>Username<input minLength={3} maxLength={30} required value={username} onChange={(event) => setUsername(event.target.value)} /></label>
        <label>Email<input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
        <label>Password<input type="password" minLength={8} required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
        <button disabled={submitting} type="submit">{submitting ? "Creating account…" : "Create account"}</button>
      </form>
      <p aria-live="polite">{message}</p>
    </div>
  );
}
