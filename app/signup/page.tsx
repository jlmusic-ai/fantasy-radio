"use client";

import Script from "next/script";
import { useCallback, useEffect, useRef, useState } from "react";
import { browserClient } from "../../lib/supabase";

const TURNSTILE_SITE_KEY = "0x4AAAAAAE71CdgCBE-ygwBe";

type TurnstileApi = {
  render: (
    container: HTMLElement,
    options: {
      sitekey: string;
      theme?: "light" | "dark" | "auto";
      callback: (token: string) => void;
      "expired-callback": () => void;
      "error-callback": () => void;
    },
  ) => string;
  remove: (widgetId: string) => void;
  reset: (widgetId: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

function signupErrorMessage(error: { code?: string; message: string }) {
  if (error.code === "over_email_send_rate_limit" || /email rate limit/i.test(error.message)) {
    return "Too many account emails have been requested recently. Please wait about 20 minutes and try again. If you already received a confirmation email, confirm it and try logging in.";
  }
  if (/captcha/i.test(error.message)) {
    return "Bot verification failed or expired. Please complete the verification again.";
  }
  return error.message;
}

function TurnstileChallenge({
  onToken,
  resetKey,
}: {
  onToken: (token: string) => void;
  resetKey: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const [scriptReady, setScriptReady] = useState(false);

  const renderChallenge = useCallback(() => {
    if (!scriptReady || !containerRef.current || !window.turnstile || widgetIdRef.current) {
      return;
    }

    widgetIdRef.current = window.turnstile.render(containerRef.current, {
      sitekey: TURNSTILE_SITE_KEY,
      theme: "dark",
      callback: onToken,
      "expired-callback": () => onToken(""),
      "error-callback": () => onToken(""),
    });
  }, [onToken, scriptReady]);

  useEffect(() => {
    renderChallenge();
  }, [renderChallenge]);

  useEffect(() => {
    if (resetKey > 0 && widgetIdRef.current && window.turnstile) {
      window.turnstile.reset(widgetIdRef.current);
      onToken("");
    }
  }, [onToken, resetKey]);

  useEffect(() => {
    return () => {
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.remove(widgetIdRef.current);
        widgetIdRef.current = null;
      }
    };
  }, []);

  return (
    <>
      <Script
        id="cloudflare-turnstile"
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        strategy="afterInteractive"
        onReady={() => setScriptReady(true)}
      />
      <div
        ref={containerRef}
        aria-label="Bot verification"
        style={{ minHeight: 65, display: "flex", justifyContent: "center" }}
      />
    </>
  );
}

export default function Signup() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [captchaToken, setCaptchaToken] = useState("");
  const [captchaResetKey, setCaptchaResetKey] = useState(0);
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!captchaToken) {
      setMessage("Please complete the bot verification before creating your account.");
      return;
    }

    setSubmitting(true);
    setMessage("");
    const db = browserClient();
    const cleanUsername = username.trim();
    const { data: usernameAvailable, error: availabilityError } = await db.rpc(
      "username_available",
      { requested_username: cleanUsername },
    );
    if (availabilityError || !usernameAvailable) {
      setSubmitting(false);
      setMessage(
        availabilityError
          ? "We could not check that username. Please try again."
          : "That username is already taken. Please choose another one.",
      );
      return;
    }

    const { data, error } = await db.auth.signUp({
      email,
      password,
      options: {
        captchaToken,
        data: { username: cleanUsername },
      },
    });
    setCaptchaResetKey((current) => current + 1);

    if (error) {
      setSubmitting(false);
      setMessage(signupErrorMessage(error));
      return;
    }
    if (data.session && data.user) {
      setSubmitting(false);
      setMessage("Account created!");
      window.location.href = "/";
      return;
    }
    setSubmitting(false);
    setMessage("Check your email to confirm your account, then log in. Your username can be changed after confirmation.");
  }

  return (
    <div className="panel" style={{ maxWidth: 480, margin: "auto" }}>
      <h1>Create an account</h1>
      <form onSubmit={submit}>
        <label>Username<input minLength={3} maxLength={30} required autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} /></label>
        <label>Email<input type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
        <label>Password<input type="password" minLength={8} required autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
        <TurnstileChallenge onToken={setCaptchaToken} resetKey={captchaResetKey} />
        <button disabled={submitting || !captchaToken} type="submit">{submitting ? "Creating account…" : "Create account"}</button>
      </form>
      <p aria-live="polite">{message}</p>
    </div>
  );
}
