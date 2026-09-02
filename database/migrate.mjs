import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Client } = pg;
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required to run migrations");
}

const here = dirname(fileURLToPath(import.meta.url));
const migrationDirectory = join(here, "migrations");
const client = new Client({ connectionString: databaseUrl, application_name: "postonce-migrator" });

await client.connect();
try {
  await client.query("SELECT pg_advisory_lock($1)", [7_210_041]);
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  const files = (await readdir(migrationDirectory))
    .filter((file) => /^\d+.*\.sql$/.test(file))
    .sort();
  const appliedRows = await client.query("SELECT version FROM schema_migrations");
  const applied = new Set(appliedRows.rows.map((row) => row.version));

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await readFile(join(migrationDirectory, file), "utf8");
    await client.query("BEGIN");
    try {
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (version) VALUES ($1)", [file]);
      await client.query("COMMIT");
      console.log(`Applied ${file}`);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }
} finally {
  await client.query("SELECT pg_advisory_unlock($1)", [7_210_041]).catch(() => undefined);
  await client.end();
}
