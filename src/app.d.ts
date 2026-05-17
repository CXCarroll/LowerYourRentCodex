// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces

import type { LoadedAdminSession } from '$lib/server/admin/auth';

declare global {
	namespace App {
		interface Locals {
			admin: LoadedAdminSession | null;
		}
		// interface Error {}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}

	// Cloudflare Turnstile widget API, attached by the injected api.js script.
	interface Window {
		turnstile?: {
			render(el: HTMLElement, opts: Record<string, unknown>): string;
			remove(id: string): void;
			reset(id?: string): void;
		};
	}
}

export {};
