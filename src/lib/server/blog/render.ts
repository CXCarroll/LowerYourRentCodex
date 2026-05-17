// Server-only markdown → HTML rendering for blog posts.
//
// `marked` is small, zero-dep, and escapes text inside markdown constructs by
// default. Since the only writer is the trusted admin we don't pipe through a
// DOM sanitizer — the trust boundary is admin-auth, not output sanitization.
// If we ever open authoring beyond the admin, add isomorphic-dompurify here.

import { marked } from 'marked';

marked.setOptions({
	gfm: true,
	breaks: false
});

export function renderMarkdown(md: string): string {
	return marked.parse(md ?? '', { async: false }) as string;
}
