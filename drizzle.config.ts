import { defineConfig } from 'drizzle-kit';

// No hardcoded fallback: a missing DATABASE_URL must fail loudly rather than
// silently point drizzle-kit at some default database.
const url = process.env.DATABASE_URL;
if (!url) {
	throw new Error('DATABASE_URL is not set — define it in .env (see .env.example).');
}

export default defineConfig({
	schema: './src/lib/server/db/schema.ts',
	out: './drizzle',
	dialect: 'postgresql',
	dbCredentials: { url },
	strict: true,
	verbose: true
});
