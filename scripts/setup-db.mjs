// Creates the tables and loads the 100 mountains. Safe to re-run: the schema
// uses `if not exists` and the seed upserts on fukada_number.
//
//   npm run db:setup
//
// Reads DATABASE_URL from .env.local, or from the environment if already set.
import { readFileSync } from "node:fs";
import pg from "pg";

try {
  process.loadEnvFile(".env.local");
} catch {
  // No .env.local -- fall back to whatever is already in the environment.
}

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set. Put it in .env.local or export it.");
  process.exit(1);
}

// Pin sslmode to verify-full for the same reason lib/db.ts does: pg currently
// aliases require -> verify-full but pg v9 will downgrade it to unverified TLS.
const connectionString = process.env.DATABASE_URL.replace(
  /([?&]sslmode=)(prefer|require|verify-ca)\b/i,
  "$1verify-full",
);
const isLocal = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(connectionString);

const client = new pg.Client({
  connectionString,
  ssl: isLocal || /[?&]sslmode=/i.test(connectionString) ? undefined : { rejectUnauthorized: true },
});

const read = (name) => readFileSync(new URL(`../db/${name}`, import.meta.url), "utf8");

await client.connect();
try {
  await client.query(read("schema.sql"));
  console.log("schema applied");
  await client.query(read("seed.sql"));
  console.log("seed applied");

  const { rows } = await client.query(
    `select (select count(*) from mountains) as mountains,
            (select count(*) from people)    as people,
            (select count(*) from ascents)   as ascents`,
  );
  console.log(rows[0]);
} finally {
  await client.end();
}
