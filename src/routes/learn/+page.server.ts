import { desc, eq } from 'drizzle-orm';
import type { PageServerLoad } from './$types';
import { assertDb } from '$lib/server/db/client';
import { blogPosts } from '$lib/server/db/schema';

export const load: PageServerLoad = async () => {
	const db = assertDb();
	const posts = await db
		.select({
			slug: blogPosts.slug,
			title: blogPosts.title,
			excerpt: blogPosts.excerpt,
			coverImageUrl: blogPosts.coverImageUrl,
			publishedAt: blogPosts.publishedAt
		})
		.from(blogPosts)
		.where(eq(blogPosts.status, 'published'))
		.orderBy(desc(blogPosts.publishedAt));
	return { posts };
};
