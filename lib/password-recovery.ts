import { createClient } from "@supabase/supabase-js";

// Recovery emails must work when opened in an email app or another browser.
// This client only requests recovery emails; the reset page stores the verified
// session with the regular cookie-based browser client.
export function passwordRecoveryClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { flowType: "implicit", persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
  );
}

export function recoveryErrorMessage(code?: string) {
  return code === "bad_code_verifier" || code === "flow_state_not_found" || code === "pkce_code_verifier_not_found"
    ? "This older reset link must be opened in the browser where you requested it. Request a new reset email below for a link that also works in another browser."
    : "This reset link has already been used or has expired. Request a new reset email below and open only the newest link.";
}
