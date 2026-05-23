import { eq } from 'drizzle-orm';
import { error, fail, redirect, type Actions } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { assertDb } from '$lib/server/db/client';
import { blogPosts } from '$lib/server/db/schema';
import { ensureUniqueSlug, slugify } from '$lib/server/blog/slug';
import { validateOptionalPublicImageUrl } from '$lib/server/blog/url';
import {
	validateBlogMarkdownAccessibility,
	type BlogMarkdownA11yIssue
} from '$lib/shared/blog-markdown-a11y';

function trim(v: FormDataEntryValue | null, max: number): string {
	if (typeof v !== 'string') return '';
	return v.trim().slice(0, max);
}

function trimOrNull(v: FormDataEntryValue | null, max: number): string | null {
	if (typeof v !== 'string') return null;
	const t = v.trim();
	return t.length === 0 ? null : t.slice(0, max);
}

async function loadPost(id: string) {
	const db = assertDb();
	const rows = await db.select().from(blogPosts).where(eq(blogPosts.id, id)).limit(1);
	if (rows.length === 0) throw error(404, 'Post not found');
	return rows[0];
}

function invalidForm(
	message: string,
	input: {
		title: string;
		slugInput: string;
		excerpt: string | null;
		coverImageUrl: string | null;
		content: string;
		markdownIssues?: BlogMarkdownA11yIssue[];
	}
) {
	return {
		message,
		...input,
		markdownIssues: input.markdownIssues ?? validateBlogMarkdownAccessibility(input.content)
	};
}

export const load: PageServerLoad = async ({ params }) => {
	const post = await loadPost(params.id);
	return { post };
};

export const actions: Actions = {
	save: async ({ request, params, locals }) => {
		if (!locals.admin) return fail(401, { message: 'Not signed in.' });
		const existing = await loadPost(params.id!);
		const data = await request.formData();

		const title = trim(data.get('title'), 200);
		const slugInput =
			existing.status === 'draft' ? trim(data.get('slug'), 120) : existing.slug;
		const excerpt = trimOrNull(data.get('excerpt'), 300);
		const coverImageUrlInput = trimOrNull(data.get('coverImageUrl'), 1000);
		const coverImageUrl = validateOptionalPublicImageUrl(coverImageUrlInput);
		const content = trim(data.get('content'), 100_000);
		const markdownIssues = validateBlogMarkdownAccessibility(content);
		const formInput = {
			title,
			slugInput,
			excerpt,
			coverImageUrl: coverImageUrlInput,
			content,
			markdownIssues
		};

		if (!title) return fail(400, invalidForm('Title is required.', formInput));
		if (!content) return fail(400, invalidForm('Content is required.', formInput));
		if (coverImageUrlInput && !coverImageUrl)
			return fail(
				400,
				invalidForm('Cover image URL must be relative, http, or https.', formInput)
			);
		if (existing.status === 'published' && markdownIssues.length > 0)
			return fail(
				400,
				invalidForm(
					'Fix Markdown image alt text before saving changes to a published post.',
					formInput
				)
			);

		// Slug is only writable while the post is a draft.
		let nextSlug = existing.slug;
		if (existing.status === 'draft') {
			const base = slugify(slugInput || title);
			if (base !== existing.slug) {
				nextSlug = await ensureUniqueSlug(base, existing.id);
			}
		}

		const db = assertDb();
		await db
			.update(blogPosts)
			.set({
				title,
				slug: nextSlug,
				excerpt,
				coverImageUrl,
				content,
				updatedAt: new Date()
			})
			.where(eq(blogPosts.id, existing.id));

		return { saved: true };
	},

	publish: async ({ request, params, locals }) => {
		if (!locals.admin) return fail(401, { message: 'Not signed in.' });
		const existing = await loadPost(params.id!);
		const data = await request.formData();

		const title = trim(data.get('title'), 200);
		const slugInput =
			existing.status === 'draft' ? trim(data.get('slug'), 120) : existing.slug;
		const excerpt = trimOrNull(data.get('excerpt'), 300);
		const coverImageUrlInput = trimOrNull(data.get('coverImageUrl'), 1000);
		const coverImageUrl = validateOptionalPublicImageUrl(coverImageUrlInput);
		const content = trim(data.get('content'), 100_000);
		const markdownIssues = validateBlogMarkdownAccessibility(content);
		const formInput = {
			title,
			slugInput,
			excerpt,
			coverImageUrl: coverImageUrlInput,
			content,
			markdownIssues
		};

		if (!title) return fail(400, invalidForm('Title is required.', formInput));
		if (!content) return fail(400, invalidForm('Content is required.', formInput));
		if (coverImageUrlInput && !coverImageUrl)
			return fail(
				400,
				invalidForm('Cover image URL must be relative, http, or https.', formInput)
			);
		if (markdownIssues.length > 0)
			return fail(
				400,
				invalidForm('Fix Markdown image alt text before publishing.', formInput)
			);

		// Allow last slug edit on the publish transition (post is still a draft
		// at this point), then lock thereafter.
		let nextSlug = existing.slug;
		if (existing.status === 'draft') {
			const base = slugify(slugInput || title);
			if (base !== existing.slug) {
				nextSlug = await ensureUniqueSlug(base, existing.id);
			}
		}

		const db = assertDb();
		const now = new Date();
		await db
			.update(blogPosts)
			.set({
				title,
				slug: nextSlug,
				excerpt,
				coverImageUrl,
				content,
				status: 'published',
				// Preserve the original publish time on republish.
				publishedAt: existing.publishedAt ?? now,
				updatedAt: now
			})
			.where(eq(blogPosts.id, existing.id));

		return { saved: true, published: true };
	},

	unpublish: async ({ params, locals }) => {
		if (!locals.admin) return fail(401, { message: 'Not signed in.' });
		const existing = await loadPost(params.id!);
		const db = assertDb();
		await db
			.update(blogPosts)
			.set({
				status: 'draft',
				updatedAt: new Date()
				// publishedAt intentionally left in place so a republish preserves the original date.
			})
			.where(eq(blogPosts.id, existing.id));
		return { saved: true, unpublished: true };
	},

	delete: async ({ params, locals }) => {
		if (!locals.admin) return fail(401, { message: 'Not signed in.' });
		const existing = await loadPost(params.id!);
		const db = assertDb();
		await db.delete(blogPosts).where(eq(blogPosts.id, existing.id));
		throw redirect(303, '/admin/blog');
	}
};
