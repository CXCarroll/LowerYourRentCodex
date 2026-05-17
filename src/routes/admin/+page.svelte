<script lang="ts">
	import StatCard from '$lib/components/admin/StatCard.svelte';
	import BarChart from '$lib/components/admin/BarChart.svelte';
	import LineChart from '$lib/components/admin/LineChart.svelte';

	let { data } = $props();

	const labels: Record<keyof typeof data.counts, string> = {
		submissions: 'Submissions',
		hud_fmr: 'HUD FMR',
		acs_rent: 'ACS rent',
		vacancy_rates: 'Vacancy',
		zip_county: 'ZIP → county'
	};

	function fmtDate(d: Date | string): string {
		const dt = typeof d === 'string' ? new Date(d) : d;
		return dt.toLocaleString('en-US', {
			month: 'short',
			day: 'numeric',
			hour: 'numeric',
			minute: '2-digit'
		});
	}

	const hourlyBuckets = $derived(
		data.metrics.hourly.map((b) => ({
			x: new Date(b.hour).toLocaleTimeString('en-US', { hour: 'numeric' }),
			y: b.count
		}))
	);
	const dailyPoints = $derived(
		data.metrics.daily.map((b) => ({
			x: b.date.slice(5), // MM-DD
			y: b.count
		}))
	);
	const weeklyBuckets = $derived(
		data.metrics.daily.slice(-7).map((b) => ({
			x: b.date.slice(5),
			y: b.count
		}))
	);

	const totalSeries = $derived.by(() => {
		// Running cumulative of daily counts as a sparkline hint.
		let acc = data.metrics.total - data.metrics.daily.reduce((s, b) => s + b.count, 0);
		return data.metrics.daily.map((b) => {
			acc += b.count;
			return acc;
		});
	});
	const last24hSeries = $derived(data.metrics.hourly.map((b) => b.count));
	const last7dSeries = $derived(data.metrics.daily.slice(-7).map((b) => b.count));
</script>

<section class="space-y-6">
	<header class="flex items-baseline justify-between">
		<h1 class="text-xl font-semibold tracking-tight text-slate-900">Dashboard</h1>
		<a href="/admin/upload/vacancy" class="btn-primary text-sm">Upload vacancy CSV</a>
	</header>

	<!-- Submission metrics: 3 stat cards + 3 charts. -->
	<div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
		<StatCard label="Total submissions" value={data.metrics.total} series={totalSeries} />
		<StatCard label="Last 24 hours" value={data.metrics.last24h} series={last24hSeries} />
		<StatCard label="Last 7 days" value={data.metrics.last7d} series={last7dSeries} />
	</div>

	<div class="grid grid-cols-1 gap-3 lg:grid-cols-3">
		<LineChart title="Submissions — last 30 days" points={dailyPoints} />
		<BarChart title="Last 7 days (daily)" buckets={weeklyBuckets} />
		<BarChart title="Last 24 hours (hourly)" buckets={hourlyBuckets} />
	</div>

	<!-- Seed table row counts kept as a sub-grid beneath the primary metrics. -->
	<div class="grid grid-cols-2 gap-3 sm:grid-cols-5">
		{#each Object.entries(data.counts) as [key, value] (key)}
			<div class="card px-4 py-3">
				<p class="text-xs font-medium tracking-wide text-slate-500 uppercase">
					{labels[key as keyof typeof data.counts]}
				</p>
				<p class="mt-1 text-2xl font-semibold tabular-nums text-slate-900">
					{value.toLocaleString('en-US')}
				</p>
			</div>
		{/each}
	</div>

	{#if data.latestVacancy}
		<p class="text-sm text-slate-500">
			Latest vacancy data:
			<span class="font-medium text-slate-900"
				>Q{data.latestVacancy.quarter} {data.latestVacancy.year}</span
			>
		</p>
	{/if}

	<div class="card overflow-hidden">
		<div class="border-b border-slate-100 px-6 py-3 text-sm font-semibold text-slate-900">
			Recent uploads
		</div>
		{#if data.recentUploads.length === 0}
			<div class="px-6 py-6 text-sm text-slate-500">No uploads yet.</div>
		{:else}
			<table class="w-full text-sm">
				<thead class="bg-slate-50 text-xs text-slate-500 uppercase">
					<tr>
						<th class="px-6 py-2 text-left font-medium">When</th>
						<th class="px-6 py-2 text-left font-medium">Kind</th>
						<th class="px-6 py-2 text-left font-medium">File</th>
						<th class="px-6 py-2 text-right font-medium">Rows</th>
						<th class="px-6 py-2 text-right font-medium">Inserts</th>
						<th class="px-6 py-2 text-right font-medium">Updates</th>
					</tr>
				</thead>
				<tbody>
					{#each data.recentUploads as u (u.id)}
						<tr class="border-t border-slate-100">
							<td class="px-6 py-2 text-slate-600">{fmtDate(u.createdAt)}</td>
							<td class="px-6 py-2 text-slate-900">{u.kind}</td>
							<td class="px-6 py-2 text-slate-500">{u.filename}</td>
							<td class="px-6 py-2 text-right tabular-nums text-slate-900">{u.rowCount}</td>
							<td class="px-6 py-2 text-right tabular-nums text-brand-700">{u.insertCount}</td>
							<td class="px-6 py-2 text-right tabular-nums text-slate-600">{u.updateCount}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		{/if}
	</div>
</section>
