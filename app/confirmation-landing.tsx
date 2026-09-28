"use client";

import { useEffect, useRef } from "react";
import { browserClient } from "../lib/supabase";

export default function ConfirmationLanding() {
  const navigating = useRef(false);
  useEffect(() => {
    // Supabase may establish the browser session after the server rendered
    // the public landing page following the email confirmation redirect.
    const db = browserClient();
    const { data: { subscription } } = db.auth.onAuthStateChange((event, session) => {
      if (!navigating.current && (event === "SIGNED_IN" || event === "INITIAL_SESSION") && session?.user) {
        navigating.current = true;
        window.location.replace(session.user.user_metadata?.welcome_photo_pending === true ? "/profile" : "/");
      }
    });
    return () => subscription.unsubscribe();
  }, []);
  return null;
}
