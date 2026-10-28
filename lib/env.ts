// Read a required server-side environment variable, failing loudly when it is missing.
export function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name} (see .env.example)`);
  return value;
}

export const supabaseUrl = () => env("NEXT_PUBLIC_SUPABASE_URL");
export const supabasePublishableKey = () => env("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
