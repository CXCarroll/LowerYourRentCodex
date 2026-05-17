<script lang="ts">
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let selectedSlug = $state('');
	let selectedYear = $state<number>(new Date().getUTCFullYear());

	$effect(() => {
		if (!selectedSlug && data.cities.length > 0) {
			selectedSlug = data.cities[0].slug;
		}
		if (
			data.availableYears.length > 0 &&
			!(data.availableYears as readonly number[]).includes(selectedYear)
		) {
			selectedYear = data.availableYears[data.availableYears.length - 1];
		}
	});

	const selectedCity = $derived(data.cities.find((c) => c.slug === selectedSlug));

	const fmrHref = $derived(
		selectedCity
			? `/admin/download/fmr?city=${encodeURIComponent(selectedCity.slug)}&year=${selectedYear}`
			: '#'
	);
	const safmrHref = $derived(
		selectedCity
			? `/admin/download/safmr?city=${encodeURIComponent(selectedCity.slug)}&year=${selectedYear}`
			: '#'
	);
	const vacancyHref = $derived(
		selectedCity
			? `/admin/download/vacancy?city=${encodeURIComponent(selectedCity.slug)}&year=${selectedYear}`
			: '#'
	);
	const vacancyAllHref = $derived(
		selectedCity
			? `/admin/download/vacancy?city=${encodeURIComponent(selectedCity.slug)}`
			: '#'
	);

	const downloadsDisabled = $derived(!selectedCity);
</script>

<section class="space-y-6">
	<header class="flex items-baseline justify-between">
		<div>
			<h1 class="text-xl font-semibold tracking-tight text-slate-900">Download HUD &amp; Census data</h1>
			<p class="mt-1 text-sm text-slate-500">
				Pulls FMR + SAFMR from HUD's public XLSX files and rental vacancy from
				Census HVS. No API key required.
			</p>
		</div>
		<a href="/admin" class="text-sm text-slate-500 hover:underline">← Dashboard</a>
	</header>

	<div class="card space-y-4 p-6">
		<div class="grid grid-cols-1 gap-4 sm:grid-cols-[2fr_1fr]">
			<label class="block text-sm">
				<span class="mb-1 block text-xs font-medium tracking-wide text-slate-500 uppercase">
					City (top 50 by 2020 population)
				</span>
				<select bind:value={selectedSlug} class="field-input w-full">
					{#each data.cities as city (city.slug)}
						<option value={city.slug}>
							#{city.rank} · {city.name}, {city.state}
						</option>
					{/each}
				</select>
			</label>

			<label class="block text-sm">
				<span class="mb-1 block text-xs font-medium tracking-wide text-slate-500 uppercase">
					Year (HUD FY / Census year)
				</span>
				<select bind:value={selectedYear} class="field-input w-full">
					{#each data.availableYears as y (y)}
						<option value={y}>{y}</option>
					{/each}
				</select>
			</label>
		</div>

		{#if selectedCity}
			<div class="space-y-3 rounded-md border border-slate-100 bg-slate-50 p-4 text-sm">
				<div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
					<div>
						<div class="text-xs font-medium tracking-wide text-slate-500 uppercase">CBSA</div>
						<div class="font-mono text-slate-900">{selectedCity.cbsaCode}</div>
					</div>
					<div>
						<div class="text-xs font-medium tracking-wide text-slate-500 uppercase">
							County FIPS ({selectedCity.countyFips.length})
						</div>
						<div class="font-mono text-slate-900">
							{selectedCity.countyFips.join(', ')}
						</div>
					</div>
					<div>
						<div class="text-xs font-medium tracking-wide text-slate-500 uppercase">
							ZIPs shown ({selectedCity.zips.length})
						</div>
						<div class="text-xs text-slate-400">Representative, not exhaustive.</div>
					</div>
				</div>
				<div class="flex flex-wrap gap-1.5">
					{#each selectedCity.zips as z (z)}
						<span class="inline-flex rounded bg-white px-2 py-0.5 font-mono text-xs text-slate-700 ring-1 ring-slate-200">
							{z}
						</span>
					{/each}
				</div>
			</div>
		{/if}

		<div class="space-y-4">
			<div>
				<p class="mb-2 text-xs font-medium tracking-wide text-slate-500 uppercase">
					HUD (Fair Market Rent — annual FY)
				</p>
				<div class="flex flex-wrap gap-3">
					<a
						href={fmrHref}
						class="btn-primary"
						class:pointer-events-none={downloadsDisabled}
						class:opacity-50={downloadsDisabled}
						aria-disabled={downloadsDisabled}
						download
					>
						Download county FMR ({selectedYear})
					</a>
					<a
						href={safmrHref}
						class="btn-secondary"
						class:pointer-events-none={downloadsDisabled}
						class:opacity-50={downloadsDisabled}
						aria-disabled={downloadsDisabled}
						download
					>
						Download SAFMR ({selectedYear})
					</a>
				</div>
				<p class="mt-1 text-xs text-slate-500">
					SAFMR is only published for select metros. If automated download
					fails, grab the file directly:
					<a
						href="https://www.huduser.gov/portal/datasets/fmr.html"
						target="_blank"
						rel="noreferrer"
						class="underline hover:text-brand-700"
					>FMR source ↗</a>
					·
					<a
						href="https://www.huduser.gov/portal/datasets/fmr/smallarea/index.html"
						target="_blank"
						rel="noreferrer"
						class="underline hover:text-brand-700"
					>SAFMR source ↗</a>
				</p>
			</div>

			<div>
				<p class="mb-2 text-xs font-medium tracking-wide text-slate-500 uppercase">
					Census (Housing Vacancy Survey — quarterly)
				</p>
				<div class="flex flex-wrap gap-3">
					<a
						href={vacancyHref}
						class="btn-primary"
						class:pointer-events-none={downloadsDisabled}
						class:opacity-50={downloadsDisabled}
						aria-disabled={downloadsDisabled}
						download
					>
						Download vacancy ({selectedYear})
					</a>
					<a
						href={vacancyAllHref}
						class="btn-secondary"
						class:pointer-events-none={downloadsDisabled}
						class:opacity-50={downloadsDisabled}
						aria-disabled={downloadsDisabled}
						download
					>
						Download vacancy (all years)
					</a>
				</div>
				<p class="mt-1 text-xs text-slate-500">
					HVS covers the ~75 largest US metros. If automated download fails,
					grab the file directly:
					<a
						href="https://www.census.gov/housing/hvs/data/rates.html"
						target="_blank"
						rel="noreferrer"
						class="underline hover:text-brand-700"
					>HVS source ↗</a>
				</p>
			</div>

			<div class="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
				<p class="mb-1 font-semibold text-slate-700">Every click saves a <code>.csv</code> file.</p>
				<p>
					On success: the expected data, with headers that match
					<code>/admin/upload/fmr</code> or <code>/admin/upload/vacancy</code>.
					On failure: a tiny CSV containing one or more <code>#</code>-prefixed
					comment lines explaining what went wrong — open it in a text editor
					to see every URL tried.
				</p>
			</div>
		</div>
	</div>
</section>
