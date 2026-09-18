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
        id="cloudflare-turnstile-login"
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

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [captchaToken, setCaptchaToken] = useState("");
  const [captchaResetKey, setCaptchaResetKey] = useState(0);
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!captchaToken) {
      setMessage("Please complete the bot verification before logging in.");
      return;
    }

    setSubmitting(true);
    setMessage("");
    const { error } = await browserClient().auth.signInWithPassword({
      email,
      password,
      options: { captchaToken },
    });
    setCaptchaResetKey((current) => current + 1);

    if (error) {
      setSubmitting(false);
      setMessage(
        /captcha/i.test(error.message)
          ? "Bot verification failed or expired. Please complete it again."
          : error.message,
      );
      return;
    }

    window.location.href = "/";
  }

  return (
    <div className="panel" style={{ maxWidth: 480, margin: "auto" }}>
      <h1>Log in</h1>
      <form onSubmit={submit}>
        <label>Email<input type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
        <label>Password<input type="password" required autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
        <TurnstileChallenge onToken={setCaptchaToken} resetKey={captchaResetKey} />
        <button disabled={submitting || !captchaToken} type="submit">{submitting ? "Logging in…" : "Log in"}</button>
      </form>
      <p className="error" aria-live="polite">{message}</p>
      <a href="/signup">Create an account</a>
    </div>
  );
}
