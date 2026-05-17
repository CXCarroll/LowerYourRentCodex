import { desc } from 'drizzle-orm';
import type { PageServerLoad } from './$types';
import { assertDb } from '$lib/server/db/client';
import { blogPosts } from '$lib/server/db/schema';

export const load: PageServerLoad = async () => {
	const db = assertDb();
	const posts = await db
		.select({
			id: blogPosts.id,
			slug: blogPosts.slug,
			title: blogPosts.title,
			status: blogPosts.status,
			publishedAt: blogPosts.publishedAt,
			updatedAt: blogPosts.updatedAt
		})
		.from(blogPosts)
		.orderBy(desc(blogPosts.updatedAt));
	return { posts };
};
