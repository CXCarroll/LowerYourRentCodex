<script lang="ts">
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	function formatDate(ts: string | Date | null): string {
		if (!ts) return '';
		const d = typeof ts === 'string' ? new Date(ts) : ts;
		return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
	}
</script>

<svelte:head>
	<title>{data.post.title} · Lower Your Rent</title>
	{#if data.post.excerpt}
		<meta name="description" content={data.post.excerpt} />
	{/if}
</svelte:head>

<section class="lyr-enter flex flex-col gap-5">
	<a
		href="/learn"
		style="
			font-family: var(--font-sans);
			font-size: 13px;
			color: rgba(30,30,40,0.55);
			text-decoration: none;
		"
	>
		← All articles
	</a>

	<article class="glass-card" style="padding: 28px 22px;">
		{#if data.post.coverImageUrl}
			<img
				src={data.post.coverImageUrl}
				alt=""
				class="w-full"
				style="height: 180px; object-fit: cover; border-radius: 18px; margin-bottom: 18px;"
				onerror={(e) => ((e.currentTarget as HTMLImageElement).style.display = 'none')}
			/>
		{/if}

		<div
			style="
				font-family: var(--font-mono);
				font-size: 11px;
				letter-spacing: 0.6px;
				text-transform: uppercase;
				color: rgba(30,30,40,0.5);
				margin-bottom: 8px;
			"
		>
			{formatDate(data.post.publishedAt)}
		</div>

		<h1
			class="m-0"
			style="
				font-family: var(--font-serif);
				font-weight: 400;
				font-size: 34px;
				line-height: 1.1;
				letter-spacing: -0.6px;
				color: var(--ink);
				margin-bottom: 18px;
			"
		>
			{data.post.title}
		</h1>

		<div class="blog-prose">
			<!-- eslint-disable-next-line svelte/no-at-html-tags -->
			{@html data.post.html}
		</div>
	</article>
</section>

<style>
	.blog-prose {
		font-family: var(--font-sans);
		color: var(--ink);
		font-size: 16px;
		line-height: 1.65;
	}
	.blog-prose :global(h2) {
		font-family: var(--font-serif);
		font-weight: 400;
		font-size: 26px;
		line-height: 1.2;
		letter-spacing: -0.3px;
		margin: 28px 0 10px;
		color: var(--ink);
	}
	.blog-prose :global(h3) {
		font-family: var(--font-serif);
		font-weight: 400;
		font-size: 21px;
		line-height: 1.25;
		letter-spacing: -0.2px;
		margin: 22px 0 8px;
		color: var(--ink);
	}
	.blog-prose :global(h4) {
		font-family: var(--font-sans);
		font-weight: 600;
		font-size: 15px;
		letter-spacing: 0.4px;
		text-transform: uppercase;
		color: rgba(30, 30, 40, 0.7);
		margin: 18px 0 6px;
	}
	.blog-prose :global(p) {
		margin: 0 0 14px;
	}
	.blog-prose :global(a) {
		color: var(--accent-deep);
		text-decoration: underline;
		text-underline-offset: 2px;
	}
	.blog-prose :global(a:hover) {
		text-decoration-thickness: 2px;
	}
	.blog-prose :global(strong) {
		font-weight: 600;
	}
	.blog-prose :global(em) {
		font-style: italic;
	}
	.blog-prose :global(ul),
	.blog-prose :global(ol) {
		margin: 0 0 14px;
		padding-left: 22px;
	}
	.blog-prose :global(li) {
		margin: 4px 0;
	}
	.blog-prose :global(code) {
		font-family: var(--font-mono);
		font-size: 13px;
		background: rgba(30, 30, 40, 0.06);
		padding: 1px 5px;
		border-radius: 4px;
	}
	.blog-prose :global(pre) {
		font-family: var(--font-mono);
		font-size: 13px;
		background: rgba(30, 30, 40, 0.06);
		padding: 12px 14px;
		border-radius: 12px;
		overflow-x: auto;
		margin: 0 0 14px;
	}
	.blog-prose :global(pre code) {
		background: transparent;
		padding: 0;
	}
	.blog-prose :global(blockquote) {
		margin: 0 0 14px;
		padding: 4px 0 4px 14px;
		border-left: 3px solid var(--accent-soft);
		color: rgba(30, 30, 40, 0.72);
		font-style: italic;
	}
	.blog-prose :global(img) {
		max-width: 100%;
		height: auto;
		border-radius: 14px;
		display: block;
		margin: 14px 0;
	}
	.blog-prose :global(hr) {
		border: none;
		border-top: 1px solid var(--hairline);
		margin: 22px 0;
	}
</style>
