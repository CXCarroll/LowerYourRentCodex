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

		map = L.map(container, { scrollWheelZoom: true }).setView([39.5, -98.35], 4);
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

<div
	bind:this={container}
	class="rounded-lg border border-slate-200 bg-slate-50"
	style="height: 420px; width: 100%;"
></div>
