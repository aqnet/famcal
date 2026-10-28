import "server-only";
import { createClient } from "@supabase/supabase-js";
import { env, supabaseUrl } from "@/lib/env";

// Auth admin client (secret key) for invites. Server only; never imported by client code.
export function createAdminClient() {
  return createClient(supabaseUrl(), env("SUPABASE_SECRET_KEY"), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
