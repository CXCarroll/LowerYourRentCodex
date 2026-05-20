// Server-only Markdown -> sanitized HTML rendering for blog posts.
//
// Blog content is admin-authored, but the rendered HTML is public and injected
// with Svelte's {@html}. Treat this renderer as the output trust boundary so a
// compromised admin session cannot persist arbitrary script on public pages.

import DOMPurify, { type Config, type UponSanitizeAttributeHook } from 'isomorphic-dompurify';
import { marked } from 'marked';
import { isSafePublicUrl } from './url';

marked.setOptions({
	gfm: true,
	breaks: false
});

const allowedTags = [
	'a',
	'b',
	'blockquote',
	'br',
	'code',
	'del',
	'em',
	'h1',
	'h2',
	'h3',
	'h4',
	'h5',
	'h6',
	'hr',
	'i',
	'img',
	'li',
	'ol',
	'p',
	'pre',
	's',
	'strong',
	'table',
	'tbody',
	'td',
	'th',
	'thead',
	'tr',
	'ul'
];

const sanitizeConfig: Config = {
	ALLOWED_TAGS: allowedTags,
	ALLOWED_ATTR: ['alt', 'href', 'src', 'start', 'title'],
	ALLOWED_NAMESPACES: ['http://www.w3.org/1999/xhtml'],
	ALLOW_ARIA_ATTR: false,
	ALLOW_DATA_ATTR: false,
	ALLOW_UNKNOWN_PROTOCOLS: false
};

const restrictUrlAttributes: UponSanitizeAttributeHook = (_node, data) => {
	if (data.attrName !== 'href' && data.attrName !== 'src') return;
	if (!isSafePublicUrl(data.attrValue)) {
		data.keepAttr = false;
	}
};

DOMPurify.addHook('uponSanitizeAttribute', restrictUrlAttributes);

export function renderMarkdown(md: string): string {
	const html = marked.parse(md ?? '', { async: false }) as string;
	return DOMPurify.sanitize(html, sanitizeConfig);
}
