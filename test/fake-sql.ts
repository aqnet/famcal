// A stand-in for the `postgres` client (lib/db), so server modules can be tested without a database.
// Every query is recorded with its SQL (whitespace collapsed, parameters as `$`) and its values; the
// handler decides which rows to return.

export type Query = { text: string; values: unknown[] };
type Handler = (q: Query) => unknown[] | undefined;

export type FakeSql = {
  (strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown[]>;
  json: (v: unknown) => unknown;
  begin: <T>(fn: (sql: FakeSql) => Promise<T>) => Promise<T>;
  queries: Query[];
  // Queries whose SQL contains every fragment.
  find: (...fragments: string[]) => Query[];
};

export function fakeSql(handler: Handler = () => []): FakeSql {
  const queries: Query[] = [];
  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    const q = { text: strings.join("$").replace(/\s+/g, " ").trim(), values };
    queries.push(q);
    return Promise.resolve(handler(q) ?? []);
  }) as FakeSql;
  sql.json = (v) => v;
  sql.begin = (fn) => fn(sql);
  sql.queries = queries;
  sql.find = (...fragments) => queries.filter((q) => fragments.every((f) => q.text.includes(f)));
  return sql;
}
