/**
 * Apply pending Drizzle migrations, then exit. Runs as the first step of the
 * production `start` script so a fresh or upgraded deploy always has the
 * current schema before the server accepts traffic.
 *
 * Uses the programmatic postgres-js migrator (drizzle-orm + postgres — both
 * runtime dependencies) rather than the drizzle-kit CLI, so it still works if
 * devDependencies are pruned from the production image.
 *
 * Usage: bun run scripts/migrate.ts
 */

import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { log } from './_seed-helpers';

const url = process.env.DATABASE_URL;
if (!url) {
	throw new Error('DATABASE_URL is not set — cannot run migrations.');
}

// max: 1 — migrations run serially, so one connection is all that's needed.
const client = postgres(url, { max: 1 });

try {
	log('migrate', 'applying pending migrations…');
	await migrate(drizzle(client), { migrationsFolder: './drizzle' });
	log('migrate', 'schema up to date');
} finally {
	await client.end();
}
