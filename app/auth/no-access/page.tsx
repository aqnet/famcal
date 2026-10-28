import { redirect } from "next/navigation";
import { getUser, isMember } from "@/lib/auth";
import { signOut } from "@/app/auth/sign-out";

export default async function NoAccessPage() {
  const user = await getUser();
  if (!user) redirect("/login");
  if (await isMember(user.id)) redirect("/");
  return (
    <main className="auth-page">
      <form className="auth-card" action={signOut}>
        <h1 className="auth-title">No access</h1>
        <p className="auth-subtitle">This account doesn&rsquo;t have access to the family calendar.</p>
        <p className="auth-note">{user.email}</p>
        <button className="btn btn-primary btn-block">Sign out</button>
      </form>
    </main>
  );
}
