import adapter from '@sveltejs/adapter-node';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	compilerOptions: {
		runes: ({ filename }) => (filename.split(/[/\\]/).includes('node_modules') ? undefined : true)
	},
	kit: {
		adapter: adapter(),
		// Content-Security-Policy. SvelteKit nonces its own inline hydration
		// script automatically. External hosts: Cloudflare Turnstile (bot-check
		// widget) and Google Fonts. 'unsafe-inline' is kept only for styles —
		// the app uses inline style attributes throughout; script injection
		// stays blocked, which is the defense-in-depth that matters.
		csp: {
			directives: {
				'default-src': ['self'],
				'script-src': ['self', 'https://challenges.cloudflare.com'],
				'style-src': ['self', 'unsafe-inline', 'https://fonts.googleapis.com'],
				'font-src': ['self', 'https://fonts.gstatic.com'],
				'img-src': ['self', 'data:', 'blob:', 'https:'],
				'connect-src': ['self', 'https://challenges.cloudflare.com'],
				'frame-src': ['https://challenges.cloudflare.com'],
				'object-src': ['none'],
				'base-uri': ['self'],
				'form-action': ['self'],
				'frame-ancestors': ['none']
			}
		}
	}
};

export default config;
