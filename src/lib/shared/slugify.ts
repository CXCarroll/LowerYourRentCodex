// Pure URL-slug helper. Lives outside `$lib/server` so it can be imported
// from both server load functions and Svelte components.

export function slugify(input: string): string {
	const base = (input || '')
		.toLowerCase()
		.normalize('NFKD')
		// Strip combining diacritics (Unicode category for accents).
		.replace(/[̀-ͯ]/g, '')
		.replace(/[^a-z0-9\s-]/g, '')
		.trim()
		.replace(/\s+/g, '-')
		.replace(/-+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 80);
	return base || 'untitled';
}
