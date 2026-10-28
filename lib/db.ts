import "server-only";
import postgres from "postgres";
import { env } from "@/lib/env";

// famcal is not exposed to the Data API, so the server talks to Postgres directly.
// One small pool per server instance, through Supabase's session pooler (port 5432). The transaction
// pooler (6543) left pooled connections waiting forever for replies, hanging every request behind them.
// Queries always name the famcal schema explicitly.
const globalForDb = globalThis as unknown as { famcalSql?: postgres.Sql };

export function db(): postgres.Sql {
  if (!globalForDb.famcalSql) {
    globalForDb.famcalSql = postgres(env("DATABASE_URL"), {
      max: 3,
      idle_timeout: 20,
      connect_timeout: 10,
    });
  }
  return globalForDb.famcalSql;
}
