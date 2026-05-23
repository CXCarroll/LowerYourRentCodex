import { describe, expect, test } from 'bun:test';
import { __test as renderTest, renderCachedMarkdown, renderMarkdown } from '../../src/lib/server/blog/render';
import { isSafePublicUrl, validateOptionalPublicImageUrl } from '../../src/lib/server/blog/url';
import { validateBlogMarkdownAccessibility } from '../../src/lib/shared/blog-markdown-a11y';

describe('renderMarkdown', () => {
	test('renders common Markdown used by blog posts', () => {
		const html = renderMarkdown(`
# Renewal basics

Read the [guide](/learn/renewal-guide).

![Apartment building](https://example.com/building.jpg)

- Compare nearby rents
- Ask for the same term

\`\`\`
rent = 2400
\`\`\`
`);

		expect(html).toContain('<h2>Renewal basics</h2>');
		expect(html).toContain('<a href="/learn/renewal-guide">guide</a>');
		expect(html).toContain('<img src="https://example.com/building.jpg" alt="Apartment building">');
		expect(html).toContain('<li>Compare nearby rents</li>');
		expect(html).toContain('<pre><code>rent = 2400');
	});

	test('normalizes article body headings to start below the page h1', () => {
		const html = renderMarkdown(`
# Body heading
## Section heading
##### Deep heading
###### Capped heading
`);

		expect(html).toContain('<h2>Body heading</h2>');
		expect(html).toContain('<h3>Section heading</h3>');
		expect(html).toContain('<h6>Deep heading</h6>');
		expect(html).toContain('<h6>Capped heading</h6>');
		expect(html).not.toContain('<h1>');
		expect(html).not.toContain('<h7>');
	});

	test('removes raw h1 HTML from article body content', () => {
		const html = renderMarkdown(`
Before

<h1>Raw heading</h1>

After
`);

		expect(html).toContain('Before');
		expect(html).toContain('Raw heading');
		expect(html).toContain('After');
		expect(html).not.toContain('<h1');
		expect(html).not.toContain('</h1>');
	});

	test('removes scriptable raw HTML', () => {
		const html = renderMarkdown(`
Before

<script>alert(1)</script>
<iframe src="https://example.com/embed"></iframe>
<svg><animate onbegin="alert(1)" /></svg>

After
`);

		expect(html).toContain('Before');
		expect(html).toContain('After');
		expect(html).not.toContain('<script');
		expect(html).not.toContain('<iframe');
		expect(html).not.toContain('<svg');
		expect(html).not.toContain('alert(1)');
	});

	test('removes dangerous attributes from otherwise allowed tags', () => {
		const html = renderMarkdown(`
<p style="position:fixed" onclick="alert(1)">Paragraph</p>
<img src="/images/rent.jpg" alt="Rent" onerror="alert(1)">
`);

		expect(html).toContain('<p>Paragraph</p>');
		expect(html).toContain('<img src="/images/rent.jpg" alt="Rent">');
		expect(html).not.toContain('style=');
		expect(html).not.toContain('onclick=');
		expect(html).not.toContain('onerror=');
	});

	test('restricts link and image protocols', () => {
		const html = renderMarkdown(`
[Safe relative](/learn)
[Safe absolute](https://example.com)
[Unsafe script](javascript:alert(1))
[Unsafe data](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)

![Safe image](./rent.jpg)
![Unsafe data image](data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+)
![Unsafe protocol-relative](//example.com/rent.jpg)
`);

		expect(html).toContain('<a href="/learn">Safe relative</a>');
		expect(html).toContain('<a href="https://example.com">Safe absolute</a>');
		expect(html).toContain('<img src="./rent.jpg" alt="Safe image">');

		expect(html).toContain('<a>Unsafe script</a>');
		expect(html).toContain('<a>Unsafe data</a>');
		expect(html).toContain('<img alt="Unsafe data image">');
		expect(html).toContain('<img alt="Unsafe protocol-relative">');
		expect(html).not.toContain('javascript:');
		expect(html).not.toContain('data:');
		expect(html).not.toContain('src="//');
	});
});

describe('renderCachedMarkdown', () => {
	test('returns equivalent sanitized HTML and caches by post version', () => {
		renderTest.clearCache();
		const updatedAt = new Date('2026-01-01T00:00:00Z');
		const md = '[Safe](/learn) <script>alert(1)</script>';

		const direct = renderMarkdown(md);
		const first = renderCachedMarkdown('post-1', updatedAt, md);
		const second = renderCachedMarkdown('post-1', updatedAt, md);

		expect(first).toBe(direct);
		expect(second).toBe(first);
		expect(first).not.toContain('<script');
		expect(renderTest.cacheSize()).toBe(1);
	});

	test('evicts oldest entries after 100 cached post versions', () => {
		renderTest.clearCache();
		for (let i = 0; i < 101; i++) {
			renderCachedMarkdown(`post-${i}`, new Date(Date.UTC(2026, 0, 1, 0, 0, i)), `# ${i}`);
		}

		expect(renderTest.cacheSize()).toBe(100);
	});
});

describe('blog Markdown accessibility validation', () => {
	test('allows Markdown images with descriptive alt text', () => {
		const issues = validateBlogMarkdownAccessibility(`
![Tenant reviewing a renewal offer at a kitchen table](/images/renewal.jpg)
`);

		expect(issues).toEqual([]);
	});

	test('rejects empty or whitespace-only image alt text', () => {
		const issues = validateBlogMarkdownAccessibility(`
![](/images/empty.jpg)
![   ](/images/space.jpg)
`);

		expect(issues.map((issue) => issue.code)).toEqual([
			'image-alt-empty',
			'image-alt-empty'
		]);
	});

	test('rejects generic, filename-like, URL-like, and overlong image alt text', () => {
		const issues = validateBlogMarkdownAccessibility(`
![image](/images/generic.jpg)
![rent-chart.png](/images/file.jpg)
![https://example.com/rent.jpg](/images/url.jpg)
![${'A'.repeat(151)}](/images/long.jpg)
`);

		expect(issues.map((issue) => issue.code)).toEqual([
			'image-alt-generic',
			'image-alt-filename',
			'image-alt-filename',
			'image-alt-too-long'
		]);
	});
});

describe('blog public URL validation', () => {
	test('allows relative, http, and https URLs', () => {
		expect(isSafePublicUrl('/images/rent.jpg')).toBe(true);
		expect(isSafePublicUrl('./rent.jpg')).toBe(true);
		expect(isSafePublicUrl('https://example.com/rent.jpg')).toBe(true);
		expect(isSafePublicUrl('http://example.com/rent.jpg')).toBe(true);
	});

	test('rejects unsafe or ambiguous public URLs', () => {
		expect(isSafePublicUrl('javascript:alert(1)')).toBe(false);
		expect(isSafePublicUrl('java\nscript:alert(1)')).toBe(false);
		expect(isSafePublicUrl('data:image/svg+xml;base64,PHN2Zz4=')).toBe(false);
		expect(isSafePublicUrl('//example.com/rent.jpg')).toBe(false);
		expect(isSafePublicUrl('mailto:admin@example.com')).toBe(false);
	});

	test('validates optional cover image URLs without rewriting safe values', () => {
		expect(validateOptionalPublicImageUrl(null)).toBeNull();
		expect(validateOptionalPublicImageUrl('/cover.jpg')).toBe('/cover.jpg');
		expect(validateOptionalPublicImageUrl('javascript:alert(1)')).toBeNull();
	});
});
