import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { db } from '$lib/server/db/client';
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
	const ok = dbStatus !== 'down';
	return json({ ok, db: dbStatus }, { status: ok ? 200 : 503 });
};
