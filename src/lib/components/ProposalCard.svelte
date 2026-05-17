<script lang="ts">
	import type { Proposal } from '$lib/shared/types';
	import { formatCentsAsDollars } from '$lib/shared/format';

	interface Props {
		proposal: Proposal;
	}

	let { proposal }: Props = $props();

	const confidenceCopy = {
		high: 'Based on strong neighborhood data.',
		medium: 'Based on neighborhood data.',
		low: 'Based on limited neighborhood data, blended with Census estimates.',
		very_low: 'Estimate only — we don’t have enough nearby data yet.'
	} as const;

	let savings = $derived(proposal.currentCents - proposal.lowCents);
</script>

<div class="card overflow-hidden">
	<div class="bg-brand-50 px-6 py-5">
		<p class="text-xs font-semibold tracking-wide text-brand-700 uppercase">
			Your aggressive ask
		</p>
		<p class="mt-1 text-4xl font-semibold tabular-nums text-slate-900">
			{formatCentsAsDollars(proposal.lowCents)}<span class="text-base font-medium text-slate-500">/mo</span>
		</p>
		<p class="mt-1 text-sm text-slate-600">
			That’s <span class="font-semibold text-brand-700">{formatCentsAsDollars(savings)}/mo</span>
			less than your current rent of {formatCentsAsDollars(proposal.currentCents)}.
		</p>
	</div>
	<div class="grid grid-cols-2 divide-x divide-slate-100 border-t border-slate-100">
		<div class="px-6 py-4">
			<p class="text-xs font-medium text-slate-500 uppercase">Realistic target</p>
			<p class="mt-1 text-lg font-semibold tabular-nums text-slate-900">
				{formatCentsAsDollars(proposal.targetCents)}
			</p>
		</div>
		<div class="px-6 py-4">
			<p class="text-xs font-medium text-slate-500 uppercase">Walk-away</p>
			<p class="mt-1 text-lg font-semibold tabular-nums text-slate-900">
				{formatCentsAsDollars(proposal.walkAwayCents)}
			</p>
		</div>
	</div>
	<p class="border-t border-slate-100 px-6 py-3 text-xs text-slate-500">
		{confidenceCopy[proposal.confidence]}
	</p>
</div>
