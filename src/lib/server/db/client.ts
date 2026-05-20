import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from './schema';
import { env } from '../env';

// postgres-js singleton. Lazy: only connects when first used.
const url = env.DATABASE_URL;
const queryClient = url ? postgres(url, { max: 10, idle_timeout: 30 }) : null;

export const db = queryClient ? drizzle(queryClient, { schema }) : null;

export function assertDb(): NonNullable<typeof db> {
	if (!db) {
		throw new Error('DATABASE_URL is not configured.');
	}
	return db;
}

export async function closeDb(): Promise<void> {
	await queryClient?.end({ timeout: 1 });
}
