<script lang="ts">
	// Cloudflare Turnstile — invisible bot check.
	//
	// Environment-gated: with no PUBLIC_TURNSTILE_SITE_KEY the component is inert
	// (renders nothing, never calls onToken) so local dev is unaffected. Set the
	// key to activate. The widget type (Invisible) is configured on the
	// Cloudflare dashboard; the render() call is identical regardless, so the
	// widget has no visible footprint here.

	import { onMount } from 'svelte';
	import { env as publicEnv } from '$env/dynamic/public';

	let { onToken }: { onToken: (token: string | null) => void } = $props();

	const siteKey = publicEnv.PUBLIC_TURNSTILE_SITE_KEY ?? '';
	const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js';

	let container: HTMLDivElement | undefined = $state();

	/** Inject the Turnstile script once and resolve when `window.turnstile` exists. */
	function loadTurnstile(): Promise<void> {
		return new Promise((resolve, reject) => {
			if (window.turnstile) {
				resolve();
				return;
			}
			if (!document.querySelector(`script[src="${SCRIPT_SRC}"]`)) {
				const script = document.createElement('script');
				script.src = SCRIPT_SRC;
				script.async = true;
				script.defer = true;
				document.head.appendChild(script);
			}
			// The script defines window.turnstile asynchronously — poll for it.
			const start = Date.now();
			const timer = setInterval(() => {
				if (window.turnstile) {
					clearInterval(timer);
					resolve();
				} else if (Date.now() - start > 10_000) {
					clearInterval(timer);
					reject(new Error('Turnstile failed to load'));
				}
			}, 50);
		});
	}

	onMount(() => {
		if (!siteKey || !container) return;
		let widgetId: string | undefined;
		let cancelled = false;

		loadTurnstile()
			.then(() => {
				if (cancelled || !window.turnstile || !container) return;
				widgetId = window.turnstile.render(container, {
					sitekey: siteKey,
					callback: (token: string) => onToken(token),
					'error-callback': () => onToken(null),
					'expired-callback': () => onToken(null),
					'refresh-expired': 'auto'
				});
			})
			.catch(() => onToken(null));

		return () => {
			cancelled = true;
			if (widgetId && window.turnstile) {
				try {
					window.turnstile.remove(widgetId);
				} catch {
					// widget already removed — ignore
				}
			}
		};
	});
</script>

{#if siteKey}
	<div bind:this={container}></div>
{/if}
