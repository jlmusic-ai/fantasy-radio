import { createHmac, timingSafeEqual } from "node:crypto";

const SITE_URL = "https://mooberball.com";

function signingKey() {
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("Email unsubscribe signing key is unavailable");
  return key;
}

export function unsubscribeUrl(userId: string) {
  const signature = createHmac("sha256", signingKey()).update(`unsubscribe:${userId}`).digest("hex");
  return `${SITE_URL}/unsubscribe?token=${userId}.${signature}`;
}

export function unsubscribeUser(token: string | null) {
  const match = token?.match(/^([0-9a-f-]{36})\.([0-9a-f]{64})$/i);
  if (!match) return null;
  const expected = createHmac("sha256", signingKey()).update(`unsubscribe:${match[1]}`).digest();
  const provided = Buffer.from(match[2], "hex");
  return provided.length === expected.length && timingSafeEqual(provided, expected) ? match[1] : null;
}

export function unsubscribeFooter(url: string) {
  return `<p style="margin:24px 0 0;color:#999999;font-size:12px;line-height:1.5;">You can <a href="${url}" style="color:#ffca05;">unsubscribe from all Mooberball emails</a>.</p>`;
}

export async function emailDatabase(path: string, secret: string, init: RequestInit = {}) {
  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!baseUrl) throw new Error("Missing Supabase URL");
  const headers = new Headers(init.headers);
  headers.set("apikey", secret);
  headers.set("Authorization", `Bearer ${secret}`);
  headers.set("Content-Type", "application/json");
  return fetch(`${baseUrl}${path}`, { ...init, headers, cache: "no-store" });
}

export async function optedOutUsers(secret: string) {
  const response = await emailDatabase("/rest/v1/email_opt_outs?select=user_id", secret);
  if (!response.ok) throw new Error(`Unable to load email preferences (HTTP ${response.status})`);
  const rows = (await response.json()) as { user_id: string }[];
  return new Set(rows.map((row) => row.user_id));
}
