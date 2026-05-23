import { and, eq } from 'drizzle-orm';
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { assertDb } from '$lib/server/db/client';
import { blogPosts } from '$lib/server/db/schema';
import { renderCachedMarkdown } from '$lib/server/blog/render';

export const load: PageServerLoad = async ({ params }) => {
	const db = assertDb();
	const rows = await db
		.select()
		.from(blogPosts)
		.where(and(eq(blogPosts.slug, params.slug), eq(blogPosts.status, 'published')))
		.limit(1);
	if (rows.length === 0) throw error(404, 'Post not found');
	const post = rows[0];
	return {
		post: {
			slug: post.slug,
			title: post.title,
			excerpt: post.excerpt,
			coverImageUrl: post.coverImageUrl,
			publishedAt: post.publishedAt,
			html: renderCachedMarkdown(post.id, post.updatedAt, post.content)
		}
	};
};
