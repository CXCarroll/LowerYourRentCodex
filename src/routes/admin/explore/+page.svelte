<script lang="ts">
	import { enhance } from '$app/forms';
	import ZipMap, { type Marker } from '$lib/components/admin/ZipMap.svelte';
	import FmrHistoryChart from '$lib/components/admin/FmrHistoryChart.svelte';
	import VacancyHistoryChart from '$lib/components/admin/VacancyHistoryChart.svelte';
	import PermitsHistoryChart from '$lib/components/admin/PermitsHistoryChart.svelte';
	import PopulationHistoryChart from '$lib/components/admin/PopulationHistoryChart.svelte';
	import PercentChangeChart from '$lib/components/admin/PercentChangeChart.svelte';
	import { APT_TYPES } from '$lib/shared/apt-types';
	import { formatCentsAsDollars } from '$lib/shared/format';
	import type { ZipInsight } from '$lib/server/admin/zip-explorer';
	import 'leaflet/dist/leaflet.css';

	let { form } = $props();

	interface Pin {
		zip: string;
		lat: number;
		lng: number;
		label: string;
		insight: ZipInsight;
	}

	let pins = $state<Pin[]>([]);
	let submitting = $state(false);
	let lastError = $state<string | null>(null);
	let zipInput = $state('');

	// Strip non-digits whenever the bound value changes (paste, autofill, stray whitespace).
	$effect(() => {
		const cleaned = zipInput.replace(/\D/g, '').slice(0, 5);
		if (cleaned !== zipInput) zipInput = cleaned;
	});

	const markers = $derived<Marker[]>(
		pins.map((p) => ({ zip: p.zip, lat: p.lat, lng: p.lng, label: p.label }))
	);

	// React to server action responses. Guard on `form` reference to avoid a
	// reactive loop: the body reads and writes `pins`, so without this gate every
	// write re-triggers the effect and starves the microtask queue.
	let lastProcessedForm: unknown = null;

	$effect(() => {
		if (!form || form === lastProcessedForm) return;
		lastProcessedForm = form;
		if ('error' in form && form.error) {
			lastError = form.error as string;
			return;
		}
		if ('insight' in form && form.insight) {
			lastError = null;
			const ins = form.insight as ZipInsight;
			if (typeof ins.lat === 'number' && typeof ins.lng === 'number') {
				const labelBits: string[] = [];
				if (ins.submissionCount > 0) labelBits.push(`${ins.submissionCount} submissions`);
				if (ins.acsMedianGrossRentCents) {
					labelBits.push(`ACS ${formatCentsAsDollars(ins.acsMedianGrossRentCents)}`);
				}
				const label = labelBits.join(' · ') || 'No rent data';
				const existing = pins.findIndex((p) => p.zip === ins.zip);
				const pin: Pin = { zip: ins.zip, lat: ins.lat, lng: ins.lng, label, insight: ins };
				if (existing >= 0) pins = [...pins.filter((p) => p.zip !== ins.zip), pin];
				else pins = [...pins, pin];
			}
		}
	});

	function clearPins() {
		pins = [];
		lastError = null;
	}

	function permitsNarrative(yoy: number | null): { tone: string; text: string } {
		if (yoy === null) return { tone: 'text-slate-500', text: 'Limited prior-year data.' };
		if (yoy >= 15) {
			return {
				tone: 'text-emerald-700',
				text: 'Supply is rising fast — landlords here have a weaker position. Cite the permit trend when you negotiate.'
			};
		}
		if (yoy <= -15) {
			return {
				tone: 'text-rose-700',
				text: 'Pipeline is shrinking — rent pressure likely to persist.'
			};
		}
		return { tone: 'text-slate-500', text: 'Supply is roughly steady year-over-year.' };
	}

	// Compute YoY % change series from an ascending-by-year history array.
	// Drops the first entry (no prior year) and rows where the prior value is
	// 0 (undefined division).
	function yoyPctSeries<T>(
		history: T[],
		getYear: (row: T) => number,
		getValue: (row: T) => number
	): Array<{ year: number; pct: number }> {
		const out: Array<{ year: number; pct: number }> = [];
		for (let i = 1; i < history.length; i++) {
			const prev = getValue(history[i - 1]);
			const curr = getValue(history[i]);
			if (!Number.isFinite(prev) || !Number.isFinite(curr) || prev === 0) continue;
			out.push({ year: getYear(history[i]), pct: ((curr - prev) / prev) * 100 });
		}
		return out;
	}

	function fmtPopulation(n: number): string {
		if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
		if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
		return n.toLocaleString();
	}

	function supplyDemandCopy(
		v: 'supply-outpacing-demand' | 'balanced' | 'demand-outpacing-supply' | null
	): { tone: string; text: string } {
		if (v === 'supply-outpacing-demand') {
			return {
				tone: 'text-emerald-700',
				text: 'Permits are outpacing population growth — supply is expanding faster than demand. Good leverage to negotiate.'
			};
		}
		if (v === 'demand-outpacing-supply') {
			return {
				tone: 'text-rose-700',
				text: 'Population is growing faster than new supply — rent pressure likely to continue.'
			};
		}
		if (v === 'balanced') {
			return {
				tone: 'text-slate-500',
				text: 'Permits and population are roughly in step.'
			};
		}
		return { tone: 'text-slate-500', text: 'Not enough data to compare supply and demand.' };
	}

	function aptLabel(t: string): string {
		switch (t) {
			case 'studio':
				return 'Studio';
			case '1br':
				return '1 BR';
			case '2br':
				return '2 BR';
			case '3br':
				return '3 BR';
			case '4br_plus':
				return '4+ BR';
			default:
				return t;
		}
	}
</script>

<section class="space-y-6">
	<header class="flex items-baseline justify-between">
		<h1 class="text-xl font-semibold tracking-tight text-slate-900" tabindex="-1">Explore ZIP</h1>
		<div class="text-sm text-slate-500">Search a ZIP to see rent & vacancy data.</div>
	</header>

	<form
		method="POST"
		class="card flex gap-2 items-end"
		style="padding: 14px;"
		use:enhance={() => {
			submitting = true;
			return async ({ update }) => {
				try {
					await update({ reset: false });
				} finally {
					submitting = false;
				}
			};
		}}
	>
		<label class="flex-1 text-sm">
			<div class="text-xs uppercase tracking-wide text-slate-500 mb-1">ZIP code</div>
			<input
				name="zip"
				type="text"
				inputmode="numeric"
				maxlength="5"
				required
				placeholder="11201"
				class="field-input w-full"
				bind:value={zipInput}
			/>
		</label>
		<button type="submit" class="btn-primary" disabled={submitting}>
			{submitting ? 'Looking up…' : 'Look up'}
		</button>
		{#if pins.length > 0}
			<button type="button" class="btn-secondary" onclick={clearPins}>Clear pins</button>
		{/if}
	</form>

	{#if lastError}
		<div class="card text-sm text-red-700 bg-red-50 border border-red-100" style="padding: 12px;">
			{lastError}
		</div>
	{/if}

	<ZipMap {markers} />

	{#if pins.length > 0}
		<div class="flex flex-col gap-3">
			{#each pins.slice().reverse() as pin (pin.zip)}
				<div class="card" style="padding: 16px;">
					<div class="flex items-baseline justify-between mb-3">
						<div>
							<div class="text-xs uppercase tracking-wide text-slate-500">ZIP</div>
							<div class="text-2xl font-semibold text-slate-900">{pin.zip}</div>
						</div>
						<div class="text-xs text-slate-500 text-right">
							{#if pin.insight.countyFips}County FIPS: {pin.insight.countyFips}<br />{/if}
							{#if pin.insight.cbsaCode}CBSA: {pin.insight.cbsaCode}{/if}
						</div>
					</div>

					<div class="grid grid-cols-2 gap-3 text-sm">
						<div>
							<div class="text-xs uppercase tracking-wide text-slate-500">User submissions</div>
							<div class="text-lg font-medium tabular-nums text-slate-900">
								{pin.insight.submissionCount}
							</div>
						</div>
						<div>
							<div class="text-xs uppercase tracking-wide text-slate-500">ACS median rent</div>
							<div class="text-lg font-medium tabular-nums text-slate-900">
								{pin.insight.acsMedianGrossRentCents
									? formatCentsAsDollars(pin.insight.acsMedianGrossRentCents)
									: '—'}
							</div>
						</div>
						<div>
							<div class="text-xs uppercase tracking-wide text-slate-500">Vacancy rate</div>
							<div class="text-lg font-medium tabular-nums text-slate-900">
								{pin.insight.latestVacancyPct !== null
									? `${pin.insight.latestVacancyPct.toFixed(1)}%`
									: '—'}
								{#if pin.insight.latestVacancyPeriod}
									<span class="text-xs text-slate-400 font-normal"
										>Q{pin.insight.latestVacancyPeriod.quarter} {pin.insight.latestVacancyPeriod.year}</span
									>
								{/if}
							</div>
						</div>
						<div>
							<div class="text-xs uppercase tracking-wide text-slate-500">Lat / Lng</div>
							<div class="text-xs font-mono text-slate-600">
								{pin.lat.toFixed(3)}, {pin.lng.toFixed(3)}
							</div>
						</div>
					</div>

					<div class="mt-4">
						<div class="text-xs uppercase tracking-wide text-slate-500 mb-2">
							HUD FMR & user median by bedroom
						</div>
						<table class="w-full text-sm">
							<thead>
								<tr class="text-left text-xs text-slate-500 uppercase">
									<th class="py-1 font-medium">Type</th>
									<th class="py-1 font-medium text-right">HUD FMR</th>
									<th class="py-1 font-medium text-right">User median</th>
								</tr>
							</thead>
							<tbody>
								{#each APT_TYPES as t (t)}
									<tr class="border-t border-slate-100">
										<td class="py-1.5 text-slate-700">{aptLabel(t)}</td>
										<td class="py-1.5 text-right tabular-nums text-slate-900">
											{pin.insight.hudFmrCentsByAptType[t]
												? formatCentsAsDollars(pin.insight.hudFmrCentsByAptType[t]!)
												: '—'}
										</td>
										<td class="py-1.5 text-right tabular-nums text-slate-900">
											{pin.insight.medianRentCentsByAptType[t]
												? formatCentsAsDollars(pin.insight.medianRentCentsByAptType[t]!)
												: '—'}
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>

					<div class="mt-4">
						<div class="text-xs uppercase tracking-wide text-slate-500 mb-2">
							HUD FMR history
						</div>
						<FmrHistoryChart seriesByAptType={pin.insight.hudFmrHistoryByAptType} />
					</div>

					<div class="mt-4">
						<div class="text-xs uppercase tracking-wide text-slate-500 mb-2">
							Vacancy rate history
						</div>
						<VacancyHistoryChart series={pin.insight.vacancyHistory} />
					</div>

					<div class="mt-4">
						<div class="text-xs uppercase tracking-wide text-slate-500 mb-2">
							Construction pipeline
						</div>
						{#if pin.insight.permitsSummary}
							{@const s = pin.insight.permitsSummary}
							{@const narr = permitsNarrative(s.yoyPctChange)}
							<div class="card mb-2" style="padding: 16px;">
								<div class="grid grid-cols-3 gap-3 text-sm">
									<div>
										<div class="text-xs uppercase tracking-wide text-slate-500">
											5+ unit permits
										</div>
										<div class="text-lg font-medium tabular-nums text-slate-900">
											{s.latestUnits5plus.toLocaleString()}
										</div>
										<div class="text-xs text-slate-400">({s.latestYear})</div>
									</div>
									<div>
										<div class="text-xs uppercase tracking-wide text-slate-500">YoY change</div>
										<div
											class="text-lg font-medium tabular-nums"
											class:text-emerald-700={s.yoyPctChange !== null && s.yoyPctChange > 0}
											class:text-rose-700={s.yoyPctChange !== null && s.yoyPctChange < 0}
											class:text-slate-900={s.yoyPctChange === null ||
												s.yoyPctChange === 0}
										>
											{#if s.yoyPctChange === null}
												—
											{:else}
												{s.yoyPctChange > 0 ? '▲' : s.yoyPctChange < 0 ? '▼' : ''}
												{Math.abs(s.yoyPctChange).toFixed(0)}%
											{/if}
										</div>
										<div class="text-xs text-slate-400">
											{s.priorYear ? `vs ${s.priorYear}` : 'no prior year'}
										</div>
									</div>
									<div>
										<div class="text-xs uppercase tracking-wide text-slate-500">Prior year</div>
										<div class="text-lg font-medium tabular-nums text-slate-900">
											{s.priorUnits5plus !== null ? s.priorUnits5plus.toLocaleString() : '—'}
										</div>
										<div class="text-xs text-slate-400">
											{s.priorYear ? `(${s.priorYear})` : ''}
										</div>
									</div>
								</div>
								<div class="mt-3 text-xs {narr.tone}">{narr.text}</div>
							</div>
						{/if}
						<PermitsHistoryChart series={pin.insight.permitsHistory} />

						<div class="mt-3">
							<div class="text-xs uppercase tracking-wide text-slate-500 mb-2">
								5+ unit permits — YoY % change
							</div>
							<PercentChangeChart
								series={yoyPctSeries(
									pin.insight.permitsHistory,
									(r) => r.year,
									(r) => r.units5plus
								)}
								metricLabel="Permits"
							/>
						</div>

						{#if pin.insight.populationSummary}
							{@const ps = pin.insight.populationSummary}
							{@const verdict = supplyDemandCopy(ps.supplyDemandVerdict)}
							<div class="card mt-3" style="padding: 16px;">
								<div class="grid grid-cols-3 gap-3 text-sm">
									<div>
										<div class="text-xs uppercase tracking-wide text-slate-500">
											Population
										</div>
										<div class="text-lg font-medium tabular-nums text-slate-900">
											{fmtPopulation(ps.latestPopulation)}
										</div>
										<div class="text-xs text-slate-400">({ps.latestYear})</div>
									</div>
									<div>
										<div class="text-xs uppercase tracking-wide text-slate-500">YoY change</div>
										<div
											class="text-lg font-medium tabular-nums"
											class:text-emerald-700={ps.yoyPctChange !== null && ps.yoyPctChange > 0}
											class:text-rose-700={ps.yoyPctChange !== null && ps.yoyPctChange < 0}
											class:text-slate-900={ps.yoyPctChange === null ||
												ps.yoyPctChange === 0}
										>
											{#if ps.yoyPctChange === null}
												—
											{:else}
												{ps.yoyPctChange > 0 ? '▲' : ps.yoyPctChange < 0 ? '▼' : ''}
												{Math.abs(ps.yoyPctChange).toFixed(2)}%
											{/if}
										</div>
										<div class="text-xs text-slate-400">
											{ps.priorYear ? `vs ${ps.priorYear}` : 'no prior year'}
										</div>
									</div>
									<div>
										<div class="text-xs uppercase tracking-wide text-slate-500">
											Permits / 1k residents
										</div>
										<div class="text-lg font-medium tabular-nums text-slate-900">
											{ps.permitsPer1kLatest !== null
												? ps.permitsPer1kLatest.toFixed(2)
												: '—'}
										</div>
										<div class="text-xs text-slate-400">({ps.latestYear})</div>
									</div>
								</div>
								<div class="mt-3 text-xs {verdict.tone}">{verdict.text}</div>
							</div>
							<div class="mt-2">
								<PopulationHistoryChart series={pin.insight.populationHistory} />
							</div>

							<div class="mt-3">
								<div class="text-xs uppercase tracking-wide text-slate-500 mb-2">
									Population — YoY % change
								</div>
								<PercentChangeChart
									series={yoyPctSeries(
										pin.insight.populationHistory,
										(r) => r.year,
										(r) => r.population
									)}
									metricLabel="Population"
								/>
							</div>
						{/if}

						<p class="mt-2 text-xs text-slate-500">
							Sources: U.S. Census Building Permits Survey (permits) and Population Estimates
							Program (population). <em>Permits authorized</em> is a leading indicator — not
							every permitted unit is built, and typical permit-to-occupancy is 18–24 months
							for 5+ unit projects.
						</p>
					</div>
				</div>
			{/each}
		</div>
	{/if}
</section>
