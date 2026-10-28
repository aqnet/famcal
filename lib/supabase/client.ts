import { createBrowserClient } from "@supabase/ssr";

// Browser client. Only used to pick up tokens from invite links that arrive in the URL fragment;
// everything else goes through the server so sessions are refreshed by server-set cookies.
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
}
