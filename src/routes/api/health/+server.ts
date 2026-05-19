import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { db } from '$lib/server/db/client';
import { env } from '$lib/server/env';
import { sql } from 'drizzle-orm';

export const GET: RequestHandler = async () => {
	let dbStatus: 'up' | 'down' | 'not_configured' = 'not_configured';
	if (db) {
		try {
			await db.execute(sql`select 1`);
			dbStatus = 'up';
		} catch {
			dbStatus = 'down';
		}
	}
	// In production a DB is mandatory (load() refuses to boot without
	// DATABASE_URL), so `not_configured` there means a misconfigured deploy —
	// report unhealthy rather than letting the platform healthcheck pass.
	const ok =
		dbStatus === 'up' || (dbStatus === 'not_configured' && env.NODE_ENV !== 'production');
	return json({ ok, db: dbStatus }, { status: ok ? 200 : 503 });
};
