import { redirect } from "next/navigation";
import { getUser, safeNext } from "@/lib/auth";
import { LoginCard } from "./login-card";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  if (await getUser()) redirect(safeNext(next));
  return (
    <main className="auth-page">
      <LoginCard next={safeNext(next)} />
    </main>
  );
}
