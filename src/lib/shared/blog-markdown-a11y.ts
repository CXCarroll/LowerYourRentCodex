import { marked, type Tokens } from 'marked';

export interface BlogMarkdownA11yIssue {
	code: 'image-alt-empty' | 'image-alt-generic' | 'image-alt-filename' | 'image-alt-too-long';
	message: string;
	altText: string;
	imageUrl: string;
}

const markdownOptions = {
	gfm: true,
	breaks: false
};

const genericAltText = new Set([
	'diagram',
	'graphic',
	'image',
	'photo',
	'picture',
	'screenshot'
]);

const filenameLikePattern = /(?:^|[/\\])[^/\\]+\.(?:avif|gif|jpe?g|png|svg|webp)$/i;
const urlLikePattern = /^(?:https?:\/\/|\.{0,2}\/|\/|www\.)\S+$/i;

function normalizedAltText(text: string): string {
	return text.replace(/\s+/g, ' ').trim();
}

function issueForImage(token: Tokens.Image): BlogMarkdownA11yIssue | null {
	const altText = normalizedAltText(token.text);
	const imageUrl = token.href;
	const lowerAlt = altText.toLowerCase();

	if (!altText) {
		return {
			code: 'image-alt-empty',
			message: 'Markdown images need descriptive alt text.',
			altText,
			imageUrl
		};
	}

	if (altText.length > 150) {
		return {
			code: 'image-alt-too-long',
			message: 'Image alt text should be 150 characters or less.',
			altText,
			imageUrl
		};
	}

	if (genericAltText.has(lowerAlt)) {
		return {
			code: 'image-alt-generic',
			message: 'Image alt text should describe the specific image, not just its type.',
			altText,
			imageUrl
		};
	}

	if (filenameLikePattern.test(altText) || urlLikePattern.test(altText)) {
		return {
			code: 'image-alt-filename',
			message: 'Image alt text should be human-readable, not a filename or URL.',
			altText,
			imageUrl
		};
	}

	return null;
}

function isImageToken(token: Parameters<typeof marked.walkTokens>[0][number]): token is Tokens.Image {
	return token.type === 'image' && 'href' in token && 'text' in token;
}

export function validateBlogMarkdownAccessibility(markdown: string): BlogMarkdownA11yIssue[] {
	const tokens = marked.lexer(markdown ?? '', markdownOptions);
	const issues: BlogMarkdownA11yIssue[] = [];

	marked.walkTokens(tokens, (token) => {
		if (!isImageToken(token)) return;
		const issue = issueForImage(token);
		if (issue) issues.push(issue);
	});

	return issues;
}
