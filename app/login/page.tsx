import Link from "next/link";
import { redirect } from "next/navigation";
import { getUser, safeNext } from "@/lib/auth";
import { LoginCard } from "./login-card";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  if (await getUser()) redirect(safeNext(next));
  return (
    <main className="auth-page">
      <div className="auth-stack">
        <LoginCard next={safeNext(next)} />
        <nav className="auth-legal" aria-label="Legal">
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
        </nav>
      </div>
    </main>
  );
}
