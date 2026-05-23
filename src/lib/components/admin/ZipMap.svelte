<script lang="ts">
	// Leaflet map for the admin ZIP explorer.
	// - Imports Leaflet dynamically in onMount so SSR doesn't touch window/document.
	// - Uses free OSM tiles (include attribution).
	// - Parent passes in a list of markers; when it changes, the map fits bounds.

	import { onMount, onDestroy } from 'svelte';

	export interface Marker {
		zip: string;
		lat: number;
		lng: number;
		label: string; // plain text; rendered inside the popup
	}

	interface Props {
		markers: Marker[];
	}

	const { markers }: Props = $props();
	const instructionsId = 'zip-map-keyboard-instructions';
	const markerSummaryId = 'zip-map-marker-summary';

	let container: HTMLDivElement | undefined = $state();
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let map: any = null;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let layerGroup: any = null;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let L: any = null;

	onMount(async () => {
		if (!container) return;
		// Dynamic import so this module never executes on the server.
		const mod = await import('leaflet');
		L = mod.default ?? mod;
		// Leaflet ships a default icon that expects image URLs served from a
		// relative path. The Vite-packaged version has asset fingerprinting;
		// point the default icon at the CDN assets to avoid missing markers.
		delete (L.Icon.Default.prototype as { _getIconUrl?: unknown })._getIconUrl;
		L.Icon.Default.mergeOptions({
			iconRetinaUrl:
				'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
			iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
			shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png'
		});

		map = L.map(container, { keyboard: true, scrollWheelZoom: true }).setView([39.5, -98.35], 4);
		L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
			maxZoom: 18,
			attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
		}).addTo(map);
		layerGroup = L.layerGroup().addTo(map);
		renderMarkers();
	});

	onDestroy(() => {
		if (map) {
			map.remove();
			map = null;
		}
	});

	function renderMarkers() {
		if (!map || !layerGroup || !L) return;
		layerGroup.clearLayers();
		if (markers.length === 0) return;
		const latLngs = markers.map((m) => {
			const marker = L.marker([m.lat, m.lng]).bindPopup(
				`<strong>${escapeHtml(m.zip)}</strong><br/>${escapeHtml(m.label)}`
			);
			marker.addTo(layerGroup);
			return [m.lat, m.lng] as [number, number];
		});
		if (latLngs.length === 1) {
			map.setView(latLngs[0], 11);
		} else {
			map.fitBounds(L.latLngBounds(latLngs).pad(0.3));
		}
	}

	function escapeHtml(s: string): string {
		return s.replace(
			/[&<>"']/g,
			(c) =>
				(
					({
						'&': '&amp;',
						'<': '&lt;',
						'>': '&gt;',
						'"': '&quot;',
						"'": '&#39;'
					}) as Record<string, string>
				)[c] ?? c
		);
	}

	// Re-render whenever the markers array identity changes.
	$effect(() => {
		// Touch length so the effect re-runs when the array is replaced.
		void markers.length;
		renderMarkers();
	});
</script>

<div class="space-y-3">
	<div
		bind:this={container}
		class="rounded-lg border border-slate-200 bg-slate-50"
		style="height: 420px; width: 100%;"
		aria-label="ZIP code marker map"
		aria-describedby={instructionsId}
	></div>

	<section aria-labelledby={markerSummaryId} class="rounded-lg border border-slate-200 bg-white p-4">
		<div class="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
			<h2 id={markerSummaryId} class="text-sm font-semibold text-slate-900">ZIP markers</h2>
			<p id={instructionsId} class="text-sm text-slate-500">
				Use Tab to focus the map, arrow keys to pan, and plus or minus to zoom. Marker
				details are also listed below.
			</p>
		</div>

		{#if markers.length > 0}
			<div class="mt-3 overflow-x-auto">
				<table class="w-full text-sm">
					<caption class="sr-only">
						ZIP code markers plotted on the map
					</caption>
					<thead>
						<tr class="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
							<th scope="col" class="py-2 pr-4 font-medium">ZIP</th>
							<th scope="col" class="py-2 pr-4 font-medium">Details</th>
							<th scope="col" class="py-2 pr-4 font-medium text-right">Latitude</th>
							<th scope="col" class="py-2 font-medium text-right">Longitude</th>
						</tr>
					</thead>
					<tbody>
						{#each markers as marker (marker.zip)}
							<tr class="border-b border-slate-100 last:border-0">
								<th scope="row" class="py-2 pr-4 text-left font-medium text-slate-900">
									{marker.zip}
								</th>
								<td class="py-2 pr-4 text-slate-700">{marker.label}</td>
								<td class="py-2 pr-4 text-right font-mono text-xs text-slate-600">
									{marker.lat.toFixed(3)}
								</td>
								<td class="py-2 text-right font-mono text-xs text-slate-600">
									{marker.lng.toFixed(3)}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{:else}
			<p class="mt-3 text-sm text-slate-600">No ZIP markers plotted yet.</p>
		{/if}
	</section>
</div>
