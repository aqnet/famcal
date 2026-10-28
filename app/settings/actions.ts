"use server";

import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth";
import { lockPin, pinUnlocked } from "@/lib/pin";
import { createClient } from "@/lib/supabase/server";

// Sign out lives behind the PIN (FR-2), so someone at the display can't log it out by accident.
export async function signOutFromSettings() {
  const user = await getUser();
  if (!user || !(await pinUnlocked(user.id))) redirect("/settings");
  await lockPin();
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: "local" });
  redirect("/login");
}
