<script lang="ts">
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	function formatDate(ts: string | Date | null): string {
		if (!ts) return '';
		const d = typeof ts === 'string' ? new Date(ts) : ts;
		return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
	}
</script>

<section class="lyr-enter flex flex-col gap-5">
	<div>
		<h1
			class="m-0"
			style="
				font-family: var(--font-serif);
				font-weight: 400;
				font-size: 40px;
				line-height: 1.0;
				letter-spacing: -1.0px;
				color: var(--ink);
			"
		>
			<em style="font-style: italic; color: var(--accent-deep);">Negotiate smarter.</em>
		</h1>
		<p
			class="m-0"
			style="
				font-family: var(--font-sans);
				font-size: 15px;
				line-height: 1.5;
				color: rgba(30,30,40,0.65);
				margin-top: 12px;
				max-width: 320px;
			"
		>
			Guides and articles to help you read your lease, understand local rent data, and walk into the
			conversation with leverage.
		</p>
	</div>

	{#if data.posts.length === 0}
		<div
			class="glass-card flex flex-col items-center justify-center text-center"
			style="padding: 48px 22px; gap: 8px;"
		>
			<div
				style="
					font-family: var(--font-mono);
					font-size: 11px;
					letter-spacing: 0.6px;
					text-transform: uppercase;
					color: rgba(30,30,40,0.5);
				"
			>
				Coming soon
			</div>
			<div
				style="
					font-family: var(--font-serif);
					font-size: 22px;
					font-weight: 400;
					color: var(--ink);
					letter-spacing: -0.3px;
				"
			>
				Articles are on the way.
			</div>
		</div>
	{:else}
		<div class="flex flex-col gap-4">
			{#each data.posts as post (post.slug)}
				<a
					href={`/learn/${post.slug}`}
					class="glass-card block no-underline"
					style="padding: 22px; color: inherit;"
				>
					{#if post.coverImageUrl}
						<img
							src={post.coverImageUrl}
							alt=""
							class="w-full"
							style="height: 140px; object-fit: cover; border-radius: 16px; margin-bottom: 14px;"
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
							margin-bottom: 6px;
						"
					>
						{formatDate(post.publishedAt)}
					</div>
					<div
						style="
							font-family: var(--font-serif);
							font-size: 22px;
							font-weight: 400;
							color: var(--ink);
							letter-spacing: -0.3px;
							line-height: 1.15;
						"
					>
						{post.title}
					</div>
					{#if post.excerpt}
						<p
							style="
								font-family: var(--font-sans);
								font-size: 14px;
								line-height: 1.5;
								color: rgba(30,30,40,0.65);
								margin: 8px 0 0 0;
							"
						>
							{post.excerpt}
						</p>
					{/if}
				</a>
			{/each}
		</div>
	{/if}
</section>
