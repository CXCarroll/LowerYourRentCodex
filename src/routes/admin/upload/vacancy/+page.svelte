<script lang="ts">
	interface PreviewForm {
		stagedId: string;
		filename: string;
		fileSha256: string;
		rowCount: number;
		insertCount: number;
		updateCount: number;
		errors: Array<{ line: number; message: string }>;
		totalErrors: number;
		warnings: Array<{ line: number; message: string }>;
		totalWarnings: number;
		sample: Array<{ year: number; quarter: number; cbsaCode: string; rentalVacancyPct: number }>;
		canCommit: boolean;
	}
	interface CommittedForm {
		committed: true;
		upserted: number;
		insertCount: number;
		updateCount: number;
		filename: string;
	}

	let { form } = $props();

	let preview = $derived(
		form && typeof form === 'object' && 'stagedId' in form ? (form as PreviewForm) : null
	);
	let committed = $derived(
		form && typeof form === 'object' && 'committed' in form ? (form as CommittedForm) : null
	);
	let errorMsg = $derived(
		form && 'message' in form && typeof form.message === 'string' ? form.message : null
	);
	let topErrors = $derived(
		form && 'errors' in form && Array.isArray(form.errors)
			? (form.errors as Array<{ line: number; message: string }>)
			: []
	);

	let confirmed = $state(false);
	let filename = $state('');

	function onFileChange(e: Event) {
		const input = e.target as HTMLInputElement;
		filename = input.files?.[0]?.name ?? '';
	}
</script>

<section class="space-y-6">
	<header class="flex items-baseline justify-between">
		<div>
			<h1 class="text-xl font-semibold tracking-tight text-slate-900">Upload vacancy data</h1>
			<p class="mt-1 text-sm text-slate-500">
				CSV with columns: <code>year, quarter, cbsa_code, rental_vacancy_pct</code>. Max 5 MB /
				50,000 rows.
			</p>
		</div>
		<a href="/admin" class="text-sm text-slate-500 hover:underline">← Dashboard</a>
	</header>

	{#if committed}
		<div class="card border-brand-200 bg-brand-50 p-6">
			<p class="text-sm font-semibold text-brand-700">Upload committed ✓</p>
			<p class="mt-2 text-sm text-slate-700">
				<span class="font-medium">{committed.upserted}</span> rows written from
				<span class="font-mono text-xs">{committed.filename}</span>
				— {committed.insertCount} inserts, {committed.updateCount} updates.
			</p>
			<div class="mt-4 flex gap-3 text-sm">
				<a href="/admin" class="btn-secondary">Back to dashboard</a>
				<a href="/admin/upload/vacancy" class="btn-primary">Upload another</a>
			</div>
		</div>
	{:else}
		<form
			method="POST"
			action="?/dryRun"
			enctype="multipart/form-data"
			class="card space-y-4 p-6"
		>
			<label
				class="block cursor-pointer rounded-lg border-2 border-dashed border-slate-300 bg-white px-6 py-10 text-center hover:border-brand-500 hover:bg-brand-50"
			>
				<input
					type="file"
					name="file"
					accept=".csv,text/csv,application/vnd.ms-excel,text/plain"
					required
					class="sr-only"
					onchange={onFileChange}
				/>
				{#if filename}
					<p class="text-sm font-medium text-slate-900">{filename}</p>
					<p class="mt-1 text-xs text-slate-500">Click to choose a different file.</p>
				{:else}
					<p class="text-sm font-medium text-slate-700">Choose a CSV file</p>
					<p class="mt-1 text-xs text-slate-500">Or drag-and-drop onto this area.</p>
				{/if}
			</label>

			{#if errorMsg && !preview}
				<p class="rounded-md bg-red-50 p-3 text-sm text-red-800">{errorMsg}</p>
			{/if}

			{#if topErrors.length > 0}
				<div class="rounded-md border border-red-100 bg-red-50 p-3">
					<p class="text-sm font-semibold text-red-800">
						Parse errors (first {topErrors.length}):
					</p>
					<ul class="mt-2 space-y-0.5 text-xs text-red-700">
						{#each topErrors as e (e.line + e.message)}
							<li>Line {e.line}: {e.message}</li>
						{/each}
					</ul>
				</div>
			{/if}

			<button type="submit" class="btn-primary">Upload &amp; preview</button>
		</form>
	{/if}

	{#if preview}
		<div class="card overflow-hidden">
			<div class="border-b border-slate-100 px-6 py-3">
				<p class="text-sm font-semibold text-slate-900">Preview</p>
				<p class="text-xs text-slate-500">
					<span class="font-mono">{preview.filename}</span>
					— sha256 <span class="font-mono text-[10px]">{preview.fileSha256.slice(0, 16)}…</span>
				</p>
			</div>

			<div class="grid grid-cols-2 gap-0 border-b border-slate-100 sm:grid-cols-4">
				<div class="border-r border-slate-100 px-6 py-3">
					<p class="text-xs font-medium tracking-wide text-slate-500 uppercase">Valid rows</p>
					<p class="mt-1 text-xl font-semibold tabular-nums text-slate-900">{preview.rowCount}</p>
				</div>
				<div class="border-r border-slate-100 px-6 py-3">
					<p class="text-xs font-medium tracking-wide text-brand-700 uppercase">Inserts</p>
					<p class="mt-1 text-xl font-semibold tabular-nums text-brand-700">
						{preview.insertCount}
					</p>
				</div>
				<div class="border-r border-slate-100 px-6 py-3">
					<p class="text-xs font-medium tracking-wide text-slate-500 uppercase">Updates</p>
					<p class="mt-1 text-xl font-semibold tabular-nums text-slate-900">
						{preview.updateCount}
					</p>
				</div>
				<div class="px-6 py-3">
					<p class="text-xs font-medium tracking-wide text-slate-500 uppercase">
						Errors / warnings
					</p>
					<p class="mt-1 text-xl font-semibold tabular-nums text-slate-900">
						{preview.totalErrors} <span class="text-slate-400">/ {preview.totalWarnings}</span>
					</p>
				</div>
			</div>

			{#if preview.errors.length > 0}
				<div class="border-b border-slate-100 bg-red-50 px-6 py-3">
					<p class="text-sm font-semibold text-red-800">
						Errors (showing {preview.errors.length} of {preview.totalErrors}):
					</p>
					<ul class="mt-2 space-y-0.5 text-xs text-red-700">
						{#each preview.errors as e (e.line + e.message)}
							<li>Line {e.line}: {e.message}</li>
						{/each}
					</ul>
				</div>
			{/if}

			{#if preview.warnings.length > 0}
				<div class="border-b border-slate-100 bg-amber-50 px-6 py-3">
					<p class="text-sm font-semibold text-amber-800">
						Warnings (showing {preview.warnings.length} of {preview.totalWarnings}):
					</p>
					<ul class="mt-2 space-y-0.5 text-xs text-amber-800">
						{#each preview.warnings as w (w.line + w.message)}
							<li>Line {w.line}: {w.message}</li>
						{/each}
					</ul>
				</div>
			{/if}

			{#if preview.sample.length > 0}
				<div class="border-b border-slate-100">
					<p class="px-6 pt-3 pb-2 text-xs font-medium tracking-wide text-slate-500 uppercase">
						Sample (first {preview.sample.length})
					</p>
					<table class="w-full text-sm">
						<thead class="bg-slate-50 text-xs text-slate-500 uppercase">
							<tr>
								<th class="px-6 py-2 text-left font-medium">Year</th>
								<th class="px-6 py-2 text-left font-medium">Quarter</th>
								<th class="px-6 py-2 text-left font-medium">CBSA</th>
								<th class="px-6 py-2 text-right font-medium">Vacancy %</th>
							</tr>
						</thead>
						<tbody>
							{#each preview.sample as r (r.year + '|' + r.quarter + '|' + r.cbsaCode)}
								<tr class="border-t border-slate-100">
									<td class="px-6 py-2 tabular-nums text-slate-900">{r.year}</td>
									<td class="px-6 py-2 tabular-nums text-slate-900">Q{r.quarter}</td>
									<td class="px-6 py-2 font-mono text-slate-700">{r.cbsaCode}</td>
									<td class="px-6 py-2 text-right tabular-nums text-slate-900"
										>{r.rentalVacancyPct.toFixed(2)}</td
									>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}

			{#if preview.canCommit}
				<form method="POST" action="?/commit" class="flex items-center justify-between gap-4 px-6 py-4">
					<input type="hidden" name="stagedId" value={preview.stagedId} />
					<label class="flex items-center gap-2 text-sm text-slate-700">
						<input type="checkbox" bind:checked={confirmed} />
						I've reviewed the preview above.
					</label>
					<button type="submit" class="btn-primary" disabled={!confirmed}>
						Commit {preview.rowCount} rows
					</button>
				</form>
			{:else}
				<div class="bg-slate-50 px-6 py-4 text-sm text-slate-600">
					Fix the errors above and re-upload to commit.
				</div>
			{/if}
		</div>
	{/if}
</section>
