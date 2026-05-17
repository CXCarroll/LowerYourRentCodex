<script lang="ts">
	import RentForm from '$lib/components/RentForm.svelte';
</script>

<section class="lyr-enter flex flex-col gap-5">
	<!-- Hero — italic accent line. Brand row now lives in +layout.svelte so it
	     persists across the Negotiate / Learn / Search tabs. No inner left
	     padding so the title aligns flush with the brand mark above. -->
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
			<em style="font-style: italic; color: var(--accent-deep);">It takes 2 minutes.</em>
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
			Enter a few details and we'll draft a data-backed negotiation email for your landlord.
		</p>
	</div>

	<RentForm />
</section>
