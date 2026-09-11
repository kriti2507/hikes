import { Pool, types } from "pg";

// Return DATE as the raw 'YYYY-MM-DD' string. The default parser builds a JS
// Date at local midnight, which shifts the day by one either side of UTC.
types.setTypeParser(types.builtins.DATE, (value) => value);

declare global {
  // eslint-disable-next-line no-var
  var __hikesPool: Pool | undefined;
}

// pg lets the connection string win over the `ssl` option outright -- see
// Object.assign({}, config, parse(connectionString)) in pg's
// connection-parameters.js -- so TLS has to be pinned in the string itself.
//
// pg today treats sslmode=prefer/require/verify-ca as verify-full, but warns
// that pg v9 will give them libpq semantics: encrypted, certificate NOT
// verified. Vercel's Neon integration injects sslmode=require and we don't
// control that value, so rewrite it rather than trusting what we are handed.
// This also silences the startup warning.
const WEAKENING_SSL_MODE = /([?&]sslmode=)(prefer|require|verify-ca)\b/i;

function resolveConnection() {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("DATABASE_URL is not set");

  const connectionString = raw.replace(WEAKENING_SSL_MODE, "$1verify-full");
  const isLocal = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(connectionString);
  const declaresSslMode = /[?&]sslmode=/i.test(connectionString);

  // Local Postgres normally speaks plaintext. Anything remote that omitted an
  // sslmode still gets verified TLS instead of silently going unencrypted.
  if (isLocal || declaresSslMode) return { connectionString };
  return { connectionString, ssl: { rejectUnauthorized: true } };
}

function createPool() {
  return new Pool({
    ...resolveConnection(),
    // Neon terminates idle connections itself; keep the pool small so a burst of
    // serverless invocations doesn't exhaust the connection limit.
    max: 3,
    idleTimeoutMillis: 10_000,
  });
}

// Reused across hot reloads in dev and across warm invocations in production.
const pool = globalThis.__hikesPool ?? createPool();
if (process.env.NODE_ENV !== "production") globalThis.__hikesPool = pool;

export function query<T extends Record<string, unknown>>(text: string, values: unknown[] = []) {
  return pool.query<T>(text, values).then((result) => result.rows);
}
