<script lang="ts">
	import '../../app.css';
	import { page } from '$app/state';

	let { data, children } = $props();

	const navItems: Array<{ href: string; label: string }> = [
		{ href: '/admin', label: 'Dashboard' },
		{ href: '/admin/blog', label: 'Blog' },
		{ href: '/admin/templates', label: 'Templates' },
		{ href: '/admin/explore', label: 'Explore ZIP' },
		{ href: '/admin/download', label: 'Download HUD' },
		{ href: '/admin/upload/vacancy', label: 'Upload vacancy' },
		{ href: '/admin/upload/fmr', label: 'Upload FMR' }
	];

	function isActive(href: string): boolean {
		// Exact match for /admin; prefix match for sub-routes.
		return href === '/admin'
			? page.url.pathname === '/admin'
			: page.url.pathname.startsWith(href);
	}
</script>

<svelte:head>
	<title>Admin · Lower Your Rent</title>
	<meta name="robots" content="noindex, nofollow" />
</svelte:head>

<div class="min-h-dvh bg-slate-50">
	<header class="mx-auto flex max-w-4xl items-center justify-between px-5 pt-6 pb-4">
		<a href="/admin" class="flex items-center gap-2">
			<span class="inline-block h-3 w-3 rounded-full bg-brand-500"></span>
			<span class="text-lg font-semibold tracking-tight text-slate-900"
				>Lower Your Rent <span class="text-slate-600">· admin</span></span
			>
		</a>
		{#if data.loggedIn}
			<div class="flex items-center gap-3">
				<span
					class="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-700"
				>
					<span class="inline-block h-1.5 w-1.5 rounded-full bg-brand-500"></span>
					Signed in
				</span>
				<form method="POST" action="/admin/logout">
					<button
						class="text-xs font-medium text-slate-500 hover:text-slate-800 hover:underline"
						type="submit">Log out</button
					>
				</form>
			</div>
		{/if}
	</header>
	{#if data.loggedIn}
		<nav class="mx-auto max-w-4xl px-5 pb-4">
			<ul class="flex flex-wrap gap-1 text-sm">
				{#each navItems as item (item.href)}
					<li>
						<a
							href={item.href}
							class="inline-flex rounded-md px-3 py-1.5 transition-colors"
							class:bg-brand-100={isActive(item.href)}
							class:text-brand-700={isActive(item.href)}
							class:text-slate-500={!isActive(item.href)}
							class:hover:bg-slate-100={!isActive(item.href)}
						>
							{item.label}
						</a>
					</li>
				{/each}
			</ul>
		</nav>
	{/if}
	<main class="mx-auto max-w-4xl px-5 pb-16">
		{@render children()}
	</main>
</div>
