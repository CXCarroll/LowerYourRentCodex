<script lang="ts">
	import type { PageProps } from './$types';
	import { AUDIENCE_LABELS, AGGRESSIVENESS_LABELS } from '$lib/shared/email-template';

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
			<h1 class="text-xl font-semibold tracking-tight text-slate-900" tabindex="-1">Email templates</h1>
			<p class="mt-1 text-sm text-slate-500">
				{#if data.activeCount === 0}
					No active templates — users get the built-in default until you activate one.
				{:else}
					{data.activeCount} active template{data.activeCount === 1 ? '' : 's'} — one is picked
					at random per aggressiveness tier for each user.
				{/if}
			</p>
		</div>
		<a href="/admin/templates/new" class="btn-primary text-sm">+ New template</a>
	</header>

	<div class="card overflow-hidden">
		{#if data.templates.length === 0}
			<div class="px-6 py-12 text-center">
				<p class="text-sm text-slate-500">No templates yet.</p>
				<a
					href="/admin/templates/new"
					class="mt-3 inline-block text-sm font-medium text-brand-700 hover:underline"
				>
					Create your first template →
				</a>
			</div>
		{:else}
			<table class="w-full text-sm">
				<thead class="bg-slate-50 text-xs text-slate-500 uppercase">
					<tr>
						<th class="px-6 py-2 text-left font-medium">Name</th>
						<th class="px-6 py-2 text-left font-medium">Status</th>
						<th class="px-6 py-2 text-left font-medium">Audience</th>
						<th class="px-6 py-2 text-left font-medium">Aggressiveness</th>
						<th class="px-6 py-2 text-left font-medium">Updated</th>
					</tr>
				</thead>
				<tbody>
					{#each data.templates as tpl (tpl.id)}
						<tr class="border-t border-slate-100">
							<td class="px-6 py-3">
								<a
									href={`/admin/templates/${tpl.id}/edit`}
									class="font-medium text-slate-900 hover:text-brand-700 hover:underline"
								>
									{tpl.name || '(untitled)'}
								</a>
							</td>
							<td class="px-6 py-3">
								{#if tpl.status === 'active'}
									<span
										class="inline-flex items-center gap-1 rounded-full bg-brand-100 px-2 py-0.5 text-xs font-medium text-brand-700"
									>
										<span class="inline-block h-1.5 w-1.5 rounded-full bg-brand-500"></span>
										Active
									</span>
								{:else}
									<span
										class="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600"
									>
										<span class="inline-block h-1.5 w-1.5 rounded-full bg-slate-400"></span>
										Inactive
									</span>
								{/if}
							</td>
							<td class="px-6 py-3">
								<span
									class="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600"
								>
									{AUDIENCE_LABELS[tpl.audience]}
								</span>
							</td>
							<td class="px-6 py-3">
								<span
									class="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600"
								>
									{AGGRESSIVENESS_LABELS[tpl.aggressiveness]}
								</span>
							</td>
							<td class="px-6 py-3 text-slate-500">{formatRelative(tpl.updatedAt)}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		{/if}
	</div>
</section>
