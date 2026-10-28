import { requireMemberPage } from "@/lib/auth";
import { Settings } from "./settings";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  await requireMemberPage();
  return <Settings />;
}
