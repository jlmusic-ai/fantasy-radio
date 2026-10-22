"use client";

import { useState } from "react";
import { browserClient } from "../lib/supabase";

export default function FacebookSignIn({ signup = false }: { signup?: boolean }) {
  const [starting, setStarting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  // Show this only after the Facebook app and Supabase provider are configured.
  if (process.env.NEXT_PUBLIC_FACEBOOK_LOGIN_ENABLED !== "true") return null;

  async function signIn() {
    setStarting(true);
    setErrorMessage("");
    try {
      const { error } = await browserClient().auth.signInWithOAuth({
        provider: "facebook",
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
          scopes: "email",
        },
      });
      if (error) {
        setErrorMessage("Facebook sign-in could not start. Please try again.");
        setStarting(false);
      }
    } catch {
      setErrorMessage("Facebook sign-in could not start. Please try again.");
      setStarting(false);
    }
  }

  return <div className="facebook-sign-in">
    <p className="muted">or</p>
    <button type="button" className="secondary-action" onClick={signIn} disabled={starting}>
      {starting ? "Opening Facebook…" : "Continue with Facebook"}
    </button>
    {signup && <p className="muted">You’ll choose your Mooberball username after signing in.</p>}
    {errorMessage && <p className="error" role="alert">{errorMessage}</p>}
  </div>;
}
