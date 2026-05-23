import { fail, redirect, type Actions } from '@sveltejs/kit';
import { assertDb } from '$lib/server/db/client';
import { blogPosts } from '$lib/server/db/schema';
import { ensureUniqueSlug, slugify } from '$lib/server/blog/slug';
import { validateOptionalPublicImageUrl } from '$lib/server/blog/url';
import { validateBlogMarkdownAccessibility } from '$lib/shared/blog-markdown-a11y';

function trimOrNull(v: FormDataEntryValue | null, max: number): string | null {
	if (typeof v !== 'string') return null;
	const t = v.trim();
	return t.length === 0 ? null : t.slice(0, max);
}

function trim(v: FormDataEntryValue | null, max: number): string {
	if (typeof v !== 'string') return '';
	return v.trim().slice(0, max);
}

export const actions: Actions = {
	default: async ({ request, locals }) => {
		if (!locals.admin)
			return fail(401, {
				message: 'Not signed in.',
				title: '',
				slugInput: '',
				excerpt: null as string | null,
				coverImageUrl: null as string | null,
				content: ''
			});

		const data = await request.formData();
		const title = trim(data.get('title'), 200);
		const slugInput = trim(data.get('slug'), 120);
		const excerpt = trimOrNull(data.get('excerpt'), 300);
		const coverImageUrlInput = trimOrNull(data.get('coverImageUrl'), 1000);
		const coverImageUrl = validateOptionalPublicImageUrl(coverImageUrlInput);
		const content = trim(data.get('content'), 100_000);
		const markdownIssues = validateBlogMarkdownAccessibility(content);

		if (!title)
			return fail(400, {
				message: 'Title is required.',
				title,
				slugInput,
				excerpt,
				coverImageUrl: coverImageUrlInput,
				content,
				markdownIssues
			});
		if (!content)
			return fail(400, {
				message: 'Content is required.',
				title,
				slugInput,
				excerpt,
				coverImageUrl: coverImageUrlInput,
				content,
				markdownIssues
			});
		if (coverImageUrlInput && !coverImageUrl)
			return fail(400, {
				message: 'Cover image URL must be relative, http, or https.',
				title,
				slugInput,
				excerpt,
				coverImageUrl: coverImageUrlInput,
				content,
				markdownIssues
			});

		const base = slugify(slugInput || title);
		const slug = await ensureUniqueSlug(base);

		const db = assertDb();
		const [row] = await db
			.insert(blogPosts)
			.values({
				slug,
				title,
				excerpt,
				coverImageUrl,
				content,
				status: 'draft'
			})
			.returning({ id: blogPosts.id });

		throw redirect(303, `/admin/blog/${row.id}/edit`);
	}
};
