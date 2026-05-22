<script lang="ts">
	import { page } from '$app/state';
	let { form } = $props();
	let next = $derived(page.url.searchParams.get('next') ?? '');
</script>

<section class="mx-auto mt-10 max-w-sm">
	<h1 class="text-xl font-semibold tracking-tight text-slate-900" tabindex="-1">Admin sign-in</h1>
	<p class="mt-1 text-sm text-slate-500">Enter the admin password to continue.</p>

	<form method="POST" class="card mt-6 space-y-4 p-6" autocomplete="off">
		<input type="hidden" name="next" value={next} />
		<div>
			<label class="field-label" for="password">Password</label>
			<input
				id="password"
				name="password"
				type="password"
				autocomplete="current-password"
				required
				class="field-input mt-1"
			/>
		</div>
		{#if form?.message}
			<p class="rounded-md bg-red-50 p-3 text-sm text-red-800">{form.message}</p>
		{/if}
		<button type="submit" class="btn-primary w-full">Sign in</button>
	</form>
</section>
