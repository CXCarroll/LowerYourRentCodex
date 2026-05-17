// Server-side slug helpers for blog posts.
//
// `slugify` lives in `$lib/shared/slugify` so it's safe to import from Svelte
// components; re-exported here for convenience in server code.
// `ensureUniqueSlug` is server-only — it queries the DB to find a free slug.

import { and, eq, ne } from 'drizzle-orm';
import { assertDb } from '$lib/server/db/client';
import { blogPosts } from '$lib/server/db/schema';
import { slugify } from '$lib/shared/slugify';

export { slugify };

/**
 * Returns a slug that does not collide with any existing post (optionally
 * excluding `excludeId`, used when editing a draft). Appends `-2`, `-3`, …
 * if the base slug is taken.
 */
export async function ensureUniqueSlug(base: string, excludeId?: string): Promise<string> {
	const db = assertDb();
	let candidate = base;
	let n = 2;
	// Safety bound — practically we'll find a free slug in 1–2 tries.
	while (n < 1000) {
		const where = excludeId
			? and(eq(blogPosts.slug, candidate), ne(blogPosts.id, excludeId))
			: eq(blogPosts.slug, candidate);
		const rows = await db.select({ id: blogPosts.id }).from(blogPosts).where(where).limit(1);
		if (rows.length === 0) return candidate;
		candidate = `${base}-${n++}`;
	}
	// Extremely unlikely fallback — append a random suffix.
	return `${base}-${Math.random().toString(36).slice(2, 8)}`;
}
