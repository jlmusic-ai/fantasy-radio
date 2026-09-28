"use client";

import { useEffect } from "react";
import { browserClient } from "../lib/supabase";

export default function ConfirmationLanding() {
  useEffect(() => {
    // Supabase may establish the browser session after the server rendered
    // the public landing page following the email confirmation redirect.
    const db = browserClient();
    const { data: { subscription } } = db.auth.onAuthStateChange((event, session) => {
      if ((event === "SIGNED_IN" || event === "INITIAL_SESSION") && session?.user) {
        window.location.replace("/");
      }
    });
    return () => subscription.unsubscribe();
  }, []);
  return null;
}
