import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth";
import { ResetCard } from "./reset-card";

export default async function ResetPage() {
  const user = await getUser();
  if (!user) redirect("/login?next=/auth/reset");
  return (
    <main className="auth-page">
      <ResetCard email={user.email ?? ""} />
    </main>
  );
}
