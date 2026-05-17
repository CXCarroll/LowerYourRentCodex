<script lang="ts">
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	function formatRelative(ts: string | Date | null): string {
		if (!ts) return '—';
		const d = typeof ts === 'string' ? new Date(ts) : ts;
		const diffMs = Date.now() - d.getTime();
		const minutes = Math.floor(diffMs / 60000);
		if (minutes < 1) return 'just now';
		if (minutes < 60) return `${minutes}m ago`;
		const hours = Math.floor(minutes / 60);
		if (hours < 24) return `${hours}h ago`;
		const days = Math.floor(hours / 24);
		if (days < 30) return `${days}d ago`;
		return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
	}
</script>

<section class="space-y-6">
	<header class="flex items-baseline justify-between">
		<div>
			<h1 class="text-xl font-semibold tracking-tight text-slate-900">Blog posts</h1>
			<p class="mt-1 text-sm text-slate-500">
				Drafts stay private. Published posts appear on
				<a href="/learn" class="text-brand-700 hover:underline" target="_blank" rel="noopener">/learn</a>.
			</p>
		</div>
		<a href="/admin/blog/new" class="btn-primary text-sm">+ New post</a>
	</header>

	<div class="card overflow-hidden">
		{#if data.posts.length === 0}
			<div class="px-6 py-12 text-center">
				<p class="text-sm text-slate-500">No posts yet.</p>
				<a href="/admin/blog/new" class="mt-3 inline-block text-sm font-medium text-brand-700 hover:underline">
					Write your first post →
				</a>
			</div>
		{:else}
			<table class="w-full text-sm">
				<thead class="bg-slate-50 text-xs text-slate-500 uppercase">
					<tr>
						<th class="px-6 py-2 text-left font-medium">Title</th>
						<th class="px-6 py-2 text-left font-medium">Status</th>
						<th class="px-6 py-2 text-left font-medium">Updated</th>
						<th class="px-6 py-2 text-right font-medium"></th>
					</tr>
				</thead>
				<tbody>
					{#each data.posts as post (post.id)}
						<tr class="border-t border-slate-100">
							<td class="px-6 py-3">
								<a
									href={`/admin/blog/${post.id}/edit`}
									class="font-medium text-slate-900 hover:text-brand-700 hover:underline"
								>
									{post.title || '(untitled)'}
								</a>
								<p class="mt-0.5 font-mono text-[11px] text-slate-400">/learn/{post.slug}</p>
							</td>
							<td class="px-6 py-3">
								{#if post.status === 'published'}
									<span
										class="inline-flex items-center gap-1 rounded-full bg-brand-100 px-2 py-0.5 text-xs font-medium text-brand-700"
									>
										<span class="inline-block h-1.5 w-1.5 rounded-full bg-brand-500"></span>
										Published
									</span>
								{:else}
									<span
										class="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600"
									>
										<span class="inline-block h-1.5 w-1.5 rounded-full bg-slate-400"></span>
										Draft
									</span>
								{/if}
							</td>
							<td class="px-6 py-3 text-slate-500">{formatRelative(post.updatedAt)}</td>
							<td class="px-6 py-3 text-right">
								{#if post.status === 'published'}
									<a
										href={`/learn/${post.slug}`}
										target="_blank"
										rel="noopener"
										class="text-xs text-slate-500 hover:underline"
									>
										View ↗
									</a>
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		{/if}
	</div>
</section>
