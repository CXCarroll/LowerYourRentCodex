// Server-only Markdown -> sanitized HTML rendering for blog posts.
//
// Blog content is admin-authored, but the rendered HTML is public and injected
// with Svelte's {@html}. Treat this renderer as the output trust boundary so a
// compromised admin session cannot persist arbitrary script on public pages.

import DOMPurify, { type Config, type UponSanitizeAttributeHook } from 'isomorphic-dompurify';
import { marked } from 'marked';
import { isSafePublicUrl } from './url';

const markdownOptions = {
	gfm: true,
	breaks: false
};

marked.setOptions(markdownOptions);

const renderer = new marked.Renderer();

renderer.heading = function ({ tokens, depth }) {
	const normalizedDepth = Math.min(depth + 1, 6);
	return `<h${normalizedDepth}>${this.parser.parseInline(tokens)}</h${normalizedDepth}>\n`;
};

const allowedTags = [
	'a',
	'b',
	'blockquote',
	'br',
	'code',
	'del',
	'em',
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

const RENDER_CACHE_LIMIT = 100;
const renderCache = new Map<string, string>();

export function renderMarkdown(md: string): string {
	const html = marked.parse(md ?? '', { ...markdownOptions, async: false, renderer }) as string;
	return DOMPurify.sanitize(html, sanitizeConfig);
}

export function renderCachedMarkdown(id: string, updatedAt: Date, md: string): string {
	const key = `${id}:${updatedAt.getTime()}`;
	const cached = renderCache.get(key);
	if (cached !== undefined) {
		renderCache.delete(key);
		renderCache.set(key, cached);
		return cached;
	}

	const html = renderMarkdown(md);
	renderCache.set(key, html);
	if (renderCache.size > RENDER_CACHE_LIMIT) {
		const oldest = renderCache.keys().next().value;
		if (oldest !== undefined) renderCache.delete(oldest);
	}
	return html;
}

export const __test = {
	cacheSize: () => renderCache.size,
	clearCache: () => renderCache.clear()
};
